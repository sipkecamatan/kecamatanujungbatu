-- ============================================================================
-- Dasbor wilayah dikelompokkan untuk pegawai kabupaten dan provinsi.
--
-- fn_region_overview_range kini menerima:
--   p_kelompok      uuid    : wilayah yang sedang dibuka (kabupaten atau kecamatan);
--                             NULL = tingkat teratas. Nilai nol (00000000-...) = sekolah
--                             tanpa kecamatan (staf kabupaten) atau tanpa kabupaten (staf provinsi).
--   p_daftar_penuh  boolean : true = perilaku lama (satu baris per sekolah, tanpa kelompok);
--                             dipakai fn_region_overview(p_days) agar kompatibel.
-- Perilaku bawaan:
--   * pegawai kecamatan : daftar sekolah (tidak berubah).
--   * pegawai kabupaten : satu baris per kecamatan; membuka satu kecamatan memberi daftar sekolahnya.
--   * pegawai provinsi  : satu baris per kabupaten/kota; membuka satu kabupaten memberi satu baris per
--                         kecamatan; membuka satu kecamatan memberi daftar sekolahnya.
-- Total dan subtotal jenjang tetap dihitung dari seluruh sekolah yang terlihat. Aturan privasi tidak
-- berubah: hanya sekolah aktif yang disetujui pada tingkat itu; piket 1 sampai 4 disembunyikan
-- (digabungkan per kelompok lalu disembunyikan bila 1 sampai 4); kehadiran hanya dari sekolah MEMADAI.
-- Batas rentang (v_maks, hari) berada di satu tempat dan dapat dibedakan per tingkat.
-- ============================================================================

SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.fn_region_overview_range(date, date);

CREATE OR REPLACE FUNCTION public.fn_region_overview_range(p_from date, p_to date, p_kelompok uuid DEFAULT NULL, p_daftar_penuh boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region     uuid := public.fn_region_staff_region();
  v_from       date;
  v_to         date;
  v_days       integer;
  v_level      text;
  v_plevel     text;
  v_mode       text;      -- KAB: kelompok per kabupaten; KEC: kelompok per kecamatan; NULL: daftar sekolah
  v_maks       integer;   -- rentang terpanjang (hari); satu tempat untuk mengubah batas per tingkat
  v_nol        constant uuid := '00000000-0000-0000-0000-000000000000';
  v_min_cov    constant integer := 80;
  v_min_piket  constant integer := 5;
  v_result     jsonb;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(r.level, 'KECAMATAN') INTO v_level FROM public.regions r WHERE r.region_id = v_region;
  v_maks := CASE v_level WHEN 'PROVINSI' THEN 366 WHEN 'KABUPATEN' THEN 366 ELSE 366 END;
  IF p_kelompok IS NOT NULL THEN
    SELECT r.level INTO v_plevel FROM public.regions r WHERE r.region_id = p_kelompok;
  END IF;
  v_mode := CASE
              WHEN p_daftar_penuh THEN NULL
              WHEN v_level = 'PROVINSI' AND p_kelompok IS NULL THEN 'KAB'
              WHEN v_level = 'PROVINSI' AND v_plevel = 'KABUPATEN' THEN 'KEC'
              WHEN v_level = 'KABUPATEN' AND p_kelompok IS NULL THEN 'KEC'
              ELSE NULL
            END;
  v_to   := LEAST(COALESCE(p_to, CURRENT_DATE), CURRENT_DATE);
  v_from := COALESCE(p_from, v_to - 29);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'tanggal awal setelah tanggal akhir' USING ERRCODE = '22023';
  END IF;
  IF v_to - v_from > v_maks - 1 THEN
    RAISE EXCEPTION 'rentang maksimum % hari', v_maks USING ERRCODE = '22023';
  END IF;
  v_days := v_to - v_from + 1;

  WITH sch AS (
    SELECT s.school_id, s.name, s.jenjang, s.region_id, s.kabupaten_id
    FROM public.schools s
    WHERE s.is_active
      AND ((s.region_id = v_region AND s.share_with_region)
        OR (s.kabupaten_id = v_region AND s.share_kabupaten)
        OR (s.provinsi_id = v_region AND s.share_provinsi))
  ),
  sesi AS (
    SELECT ts.school_id,
           count(*)::int AS terjadwal,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.attendance a
             WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void))::int AS tercatat
    FROM public.teaching_schedules ts
    WHERE ts.school_id IN (SELECT school_id FROM sch)
      AND ts.session_date BETWEEN v_from AND v_to
      AND ts.meeting_status = 'NORMAL'
    GROUP BY ts.school_id
  ),
  hadir AS (
    SELECT a.school_id,
           count(*)::int AS baris,
           count(*) FILTER (WHERE a.status = 'HADIR')::int AS hadir
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    WHERE a.school_id IN (SELECT school_id FROM sch)
      AND NOT a.is_void
      AND ts.session_date BETWEEN v_from AND v_to
    GROUP BY a.school_id
  ),
  siswa AS (
    SELECT st.school_id, count(*)::int AS n
    FROM public.students st
    WHERE st.school_id IN (SELECT school_id FROM sch) AND st.student_status IN ('AKTIF','PKL')
    GROUP BY st.school_id
  ),
  ortu AS (
    SELECT u.school_id, count(*)::int AS n
    FROM public.users u
    WHERE u.school_id IN (SELECT school_id FROM sch)
      AND u.role_type = 'ORTU' AND u.is_active AND u.deleted_at IS NULL
    GROUP BY u.school_id
  ),
  telat AS (
    SELECT la.school_id, count(*)::int AS n
    FROM public.late_arrivals la
    WHERE la.school_id IN (SELECT school_id FROM sch)
      AND la.late_date BETWEEN v_from AND v_to
    GROUP BY la.school_id
  ),
  keluar AS (
    SELECT se.school_id, count(*)::int AS n
    FROM public.student_exits se
    WHERE se.school_id IN (SELECT school_id FROM sch)
      AND se.exit_date BETWEEN v_from AND v_to
    GROUP BY se.school_id
  ),
  per AS (
    SELECT sch.school_id, sch.name, sch.jenjang, sch.region_id, sch.kabupaten_id,
           COALESCE(siswa.n, 0) AS siswa_aktif,
           COALESCE(ortu.n, 0) AS orang_tua_aktif,
           COALESCE(sesi.terjadwal, 0) AS sesi_terjadwal,
           COALESCE(sesi.tercatat, 0) AS sesi_tercatat,
           COALESCE(hadir.baris, 0) AS baris,
           COALESCE(hadir.hadir, 0) AS hadir,
           COALESCE(telat.n, 0) AS terlambat,
           COALESCE(keluar.n, 0) AS izin_keluar,
           CASE WHEN COALESCE(sesi.terjadwal,0) = 0 THEN NULL
                ELSE round(100.0 * sesi.tercatat / sesi.terjadwal)::int END AS cakupan_pct
    FROM sch
    LEFT JOIN siswa  ON siswa.school_id  = sch.school_id
    LEFT JOIN ortu   ON ortu.school_id   = sch.school_id
    LEFT JOIN sesi   ON sesi.school_id   = sch.school_id
    LEFT JOIN hadir  ON hadir.school_id  = sch.school_id
    LEFT JOIN telat  ON telat.school_id  = sch.school_id
    LEFT JOIN keluar ON keluar.school_id = sch.school_id
  ),
  nilai AS (
    SELECT per.*,
           CASE WHEN cakupan_pct >= v_min_cov AND baris > 0
                THEN round(100.0 * hadir / baris)::int END AS kehadiran_pct,
           CASE WHEN cakupan_pct IS NULL OR sesi_terjadwal = 0 THEN 'TIDAK_ADA_JADWAL'
                WHEN sesi_tercatat = 0 THEN 'BELUM_ADA_DATA'
                WHEN cakupan_pct >= v_min_cov THEN 'MEMADAI'
                ELSE 'DATA_BELUM_MEMADAI' END AS status
    FROM per
  ),
  tot AS (
    SELECT count(*)::int AS n_sekolah,
           sum(siswa_aktif)::int AS siswa,
           sum(orang_tua_aktif)::int AS ortu,
           sum(sesi_terjadwal)::int AS terjadwal,
           sum(sesi_tercatat)::int AS tercatat,
           sum(hadir) FILTER (WHERE status = 'MEMADAI')::int AS hadir_ok,
           sum(baris) FILTER (WHERE status = 'MEMADAI')::int AS baris_ok,
           sum(terlambat)::int AS terlambat,
           sum(izin_keluar)::int AS izin_keluar
    FROM nilai
  ),
  jen AS (
    SELECT jenjang,
           count(*)::int AS n_sekolah,
           sum(siswa_aktif)::int AS siswa,
           sum(orang_tua_aktif)::int AS ortu,
           sum(sesi_terjadwal)::int AS terjadwal,
           sum(sesi_tercatat)::int AS tercatat,
           sum(hadir) FILTER (WHERE status = 'MEMADAI')::int AS hadir_ok,
           sum(baris) FILTER (WHERE status = 'MEMADAI')::int AS baris_ok,
           sum(terlambat)::int AS terlambat,
           sum(izin_keluar)::int AS izin_keluar
    FROM nilai GROUP BY jenjang
  ),
  grp AS (
    SELECT g.gid,
           count(*)::int AS n_sekolah,
           sum(g.siswa_aktif)::int AS siswa,
           sum(g.orang_tua_aktif)::int AS ortu,
           sum(g.sesi_terjadwal)::int AS terjadwal,
           sum(g.sesi_tercatat)::int AS tercatat,
           sum(g.hadir) FILTER (WHERE g.status = 'MEMADAI')::int AS hadir_ok,
           sum(g.baris) FILTER (WHERE g.status = 'MEMADAI')::int AS baris_ok,
           sum(g.terlambat)::int AS terlambat,
           sum(g.izin_keluar)::int AS izin_keluar
    FROM (SELECT n.*, CASE v_mode WHEN 'KAB' THEN n.kabupaten_id WHEN 'KEC' THEN n.region_id END AS gid
          FROM nilai n
          WHERE v_mode IS NOT NULL AND (p_kelompok IS NULL OR n.region_id = p_kelompok OR n.kabupaten_id = p_kelompok
                 OR (p_kelompok = v_nol AND ((v_level = 'KABUPATEN' AND n.region_id IS NULL)
                                          OR (v_level = 'PROVINSI' AND n.kabupaten_id IS NULL))))) g
    GROUP BY g.gid
  )
  SELECT jsonb_build_object(
    'wilayah',       (SELECT r.name FROM public.regions r WHERE r.region_id = v_region),
    'jendela_hari',  v_days,
    'dari',          v_from,
    'sampai',        v_to,
    'ambang_cakupan_pct', v_min_cov,
    'ambang_piket',  v_min_piket,
    'tingkat',       v_level,
    'maks_hari',     v_maks,
    'mode_kelompok', v_mode,
    'kelompok_nama', CASE WHEN p_kelompok IS NULL THEN NULL
                          WHEN p_kelompok = v_nol THEN CASE WHEN v_level = 'PROVINSI' THEN 'Tanpa kabupaten' ELSE 'Tanpa kecamatan' END
                          ELSE (SELECT r.name FROM public.regions r WHERE r.region_id = p_kelompok) END,
    'kelompok', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'region_id', grp.gid,
                'nama', COALESCE(r.name, CASE WHEN v_mode = 'KAB' THEN 'Tanpa kabupaten' ELSE 'Tanpa kecamatan' END),
                'jumlah_sekolah', grp.n_sekolah,
                'siswa_aktif', grp.siswa,
                'orang_tua_aktif', grp.ortu,
                'cakupan_pct', CASE WHEN grp.terjadwal > 0 THEN round(100.0 * grp.tercatat / grp.terjadwal)::int END,
                'kehadiran_pct', CASE WHEN grp.baris_ok > 0 THEN round(100.0 * grp.hadir_ok / grp.baris_ok)::int END,
                'terlambat', CASE WHEN grp.terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE grp.terlambat END,
                'izin_keluar', CASE WHEN grp.izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE grp.izin_keluar END)
                ORDER BY COALESCE(r.name, 'zzz'))
              FROM grp LEFT JOIN public.regions r ON r.region_id = grp.gid), '[]'::jsonb),
    'jumlah_sekolah_dibagikan', (SELECT n_sekolah FROM tot),
    'jumlah_sekolah_terdaftar', (SELECT count(*) FROM public.schools s
                                  WHERE s.region_id = v_region OR s.kabupaten_id = v_region OR s.provinsi_id = v_region),
    'total', (SELECT CASE WHEN n_sekolah >= 3 THEN jsonb_build_object(
                'siswa_aktif', siswa,
                'orang_tua_aktif', ortu,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
              END FROM tot),
    'per_jenjang', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'jenjang', COALESCE(jenjang, 'TIDAK_DIKETAHUI'),
                'jumlah_sekolah', n_sekolah,
                'siswa_aktif', siswa,
                'orang_tua_aktif', ortu,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
                ORDER BY jenjang)
              FROM jen WHERE n_sekolah >= 2), '[]'::jsonb),
    'sekolah', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'school_id', school_id, 'nama', name, 'jenjang', jenjang,
                'siswa_aktif', siswa_aktif,
                'orang_tua_aktif', orang_tua_aktif,
                'sesi_terjadwal', sesi_terjadwal, 'sesi_tercatat', sesi_tercatat,
                'cakupan_pct', cakupan_pct, 'kehadiran_pct', kehadiran_pct, 'status', status,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
                ORDER BY jenjang, name) FROM nilai WHERE v_mode IS NULL AND (p_kelompok IS NULL OR nilai.region_id = p_kelompok OR nilai.kabupaten_id = p_kelompok
                 OR (p_kelompok = v_nol AND ((v_level = 'KABUPATEN' AND nilai.region_id IS NULL)
                                          OR (v_level = 'PROVINSI' AND nilai.kabupaten_id IS NULL))))), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview_range(date, date, uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview_range(date, date, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview_range(date, date, uuid, boolean) FROM PUBLIC;

-- Fungsi lama: bentuk keluaran sama (daftar sekolah penuh), melalui fungsi rentang ----------
CREATE OR REPLACE FUNCTION public.fn_region_overview(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
BEGIN
  RETURN public.fn_region_overview_range(CURRENT_DATE - (v_days - 1), CURRENT_DATE, NULL, true);
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM PUBLIC;
