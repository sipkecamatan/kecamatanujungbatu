-- ============================================================================
-- Rentang waktu bebas pada dasbor pegawai wilayah.
--
-- Sebelumnya hanya "N hari terakhir" (7 sampai 90). Kini:
--   * fn_region_overview_range(p_from, p_to): isi yang sama dengan
--     fn_region_overview, tetapi untuk rentang tanggal bebas (maksimum 366 hari;
--     tanggal akhir dibatasi sampai hari ini; bila kosong: 30 hari terakhir).
--   * fn_region_overview(p_days) tetap ada dengan perilaku dan bentuk keluaran
--     lama (7 sampai 90 hari) dan kini hanya memanggil fungsi rentang.
--   * fn_region_school_trend_range(p_school_id, p_from, p_to, p_granularitas):
--     tren per MINGGU atau BULAN pada rentang itu.
-- Aturan privasi tidak berubah: hanya sekolah aktif yang disetujui pada tingkat
-- pegawai itu; total >= 3 sekolah; subtotal jenjang >= 2 sekolah; hitungan
-- piket 1 sampai 4 disembunyikan; kehadiran hanya bila cakupan >= 80%.
-- ============================================================================

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.fn_region_overview_range(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region     uuid := public.fn_region_staff_region();
  v_from       date;
  v_to         date;
  v_days       integer;
  v_min_cov    constant integer := 80;
  v_min_piket  constant integer := 5;
  v_result     jsonb;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  v_to   := LEAST(COALESCE(p_to, CURRENT_DATE), CURRENT_DATE);
  v_from := COALESCE(p_from, v_to - 29);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'tanggal awal setelah tanggal akhir' USING ERRCODE = '22023';
  END IF;
  IF v_to - v_from > 365 THEN
    RAISE EXCEPTION 'rentang maksimum 366 hari' USING ERRCODE = '22023';
  END IF;
  v_days := v_to - v_from + 1;

  WITH sch AS (
    SELECT s.school_id, s.name, s.jenjang
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
    SELECT sch.school_id, sch.name, sch.jenjang,
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
  )
  SELECT jsonb_build_object(
    'wilayah',       (SELECT r.name FROM public.regions r WHERE r.region_id = v_region),
    'jendela_hari',  v_days,
    'dari',          v_from,
    'sampai',        v_to,
    'ambang_cakupan_pct', v_min_cov,
    'ambang_piket',  v_min_piket,
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
                ORDER BY jenjang, name) FROM nilai), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview_range(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview_range(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview_range(date, date) FROM PUBLIC;

-- Fungsi lama: bentuk keluaran sama, kini lewat fungsi rentang -----------------
CREATE OR REPLACE FUNCTION public.fn_region_overview(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
BEGIN
  RETURN public.fn_region_overview_range(CURRENT_DATE - (v_days - 1), CURRENT_DATE);
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM PUBLIC;

-- Tren satu sekolah pada rentang, per minggu atau per bulan ---------------------
CREATE OR REPLACE FUNCTION public.fn_region_school_trend_range(
  p_school_id uuid, p_from date, p_to date, p_granularitas text DEFAULT 'MINGGU')
RETURNS TABLE (periode_mulai date, sesi_terjadwal integer, sesi_tercatat integer,
               cakupan_pct integer, kehadiran_pct integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region  uuid := public.fn_region_staff_region();
  v_unit    text := CASE WHEN upper(COALESCE(p_granularitas, 'MINGGU')) = 'BULAN' THEN 'month' ELSE 'week' END;
  v_to      date;
  v_from    date;
  v_min_cov constant integer := 80;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  v_to   := LEAST(COALESCE(p_to, CURRENT_DATE), CURRENT_DATE);
  v_from := COALESCE(p_from, v_to - 41);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'tanggal awal setelah tanggal akhir' USING ERRCODE = '22023';
  END IF;
  IF v_to - v_from > 365 THEN
    RAISE EXCEPTION 'rentang maksimum 366 hari' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s
                 WHERE s.school_id = p_school_id AND s.is_active
                   AND ((s.region_id = v_region AND s.share_with_region)
                     OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                     OR (s.provinsi_id = v_region AND s.share_provinsi))) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH sesi AS (
    SELECT date_trunc(v_unit, ts.session_date)::date AS periode,
           count(*)::int AS terjadwal,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.attendance a
             WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void))::int AS tercatat
    FROM public.teaching_schedules ts
    WHERE ts.school_id = p_school_id AND ts.meeting_status = 'NORMAL'
      AND ts.session_date BETWEEN v_from AND v_to
    GROUP BY 1
  ),
  hadir AS (
    SELECT date_trunc(v_unit, ts.session_date)::date AS periode,
           count(*)::int AS baris,
           count(*) FILTER (WHERE a.status = 'HADIR')::int AS hadir
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    WHERE a.school_id = p_school_id AND NOT a.is_void
      AND ts.session_date BETWEEN v_from AND v_to
    GROUP BY 1
  )
  SELECT sesi.periode,
         sesi.terjadwal,
         sesi.tercatat,
         round(100.0 * sesi.tercatat / NULLIF(sesi.terjadwal, 0))::int,
         CASE WHEN round(100.0 * sesi.tercatat / NULLIF(sesi.terjadwal, 0)) >= v_min_cov AND hadir.baris > 0
              THEN round(100.0 * hadir.hadir / hadir.baris)::int END
  FROM sesi LEFT JOIN hadir ON hadir.periode = sesi.periode
  ORDER BY sesi.periode;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_school_trend_range(uuid, date, date, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_school_trend_range(uuid, date, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_school_trend_range(uuid, date, date, text) FROM PUBLIC;
