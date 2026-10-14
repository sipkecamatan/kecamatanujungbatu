-- ============================================================================
-- Hierarki wilayah + agregat piket (keterlambatan siswa, izin keluar).
--
-- Mengikuti dokumen definisi SIP (docs/SIP-sumber-kebenaran-tunggal.md):
--   * regions.parent_region_id: kecamatan di bawah kabupaten, kabupaten di bawah
--     provinsi. schools.region_id TIDAK berubah (tetap tingkat terbawah).
--   * Pegawai wilayah melihat sekolah di wilayahnya dan SEMUA turunannya. Hanya
--     ke bawah: tidak ke atas, tidak ke samping.
--   * fn_region_overview menambah hitungan keterlambatan (late_arrivals) dan izin
--     keluar (student_exits) per sekolah, per jenjang, dan total. Hanya hitungan;
--     tidak ada student_id maupun reason.
--   * Ambang piket (bawaan): hitungan 1..4 disembunyikan (NULL). 0 dan >= 5 tampil.
--
-- Bentuk keluaran fn_region_overview hanya DITAMBAH; kunci lama tidak berubah.
-- Tanpa baris parent_region_id, perilakunya identik dengan satu tingkat.
-- ============================================================================

SET search_path = public, extensions;

-- 1. Hierarki ---------------------------------------------------------------
ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS parent_region_id uuid
  REFERENCES public.regions(region_id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.regions ADD CONSTRAINT regions_no_self_parent
    CHECK (parent_region_id IS NULL OR parent_region_id <> region_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_regions_parent ON public.regions (parent_region_id);

-- Tolak rantai melingkar (A di bawah B di bawah A).
CREATE OR REPLACE FUNCTION public.fn_regions_no_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_region_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE up AS (
      SELECT r.region_id, r.parent_region_id
      FROM public.regions r WHERE r.region_id = NEW.parent_region_id
      UNION
      SELECT r.region_id, r.parent_region_id
      FROM public.regions r JOIN up ON r.region_id = up.parent_region_id
    )
    SELECT 1 FROM up WHERE up.region_id = NEW.region_id
  ) THEN
    RAISE EXCEPTION 'hirarki wilayah tidak boleh melingkar' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_regions_no_cycle ON public.regions;
CREATE TRIGGER trg_regions_no_cycle
  BEFORE INSERT OR UPDATE OF parent_region_id ON public.regions
  FOR EACH ROW EXECUTE FUNCTION public.fn_regions_no_cycle();

REVOKE EXECUTE ON FUNCTION public.fn_regions_no_cycle() FROM PUBLIC, anon, authenticated;

-- 2. Cakupan pegawai: wilayahnya + semua turunan ----------------------------
CREATE OR REPLACE FUNCTION public.fn_region_scope_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE down AS (
    SELECT r.region_id FROM public.regions r
    WHERE r.region_id = public.fn_region_staff_region()
    UNION
    SELECT c.region_id FROM public.regions c JOIN down d ON c.parent_region_id = d.region_id
  )
  SELECT COALESCE(array_agg(down.region_id), ARRAY[]::uuid[]) FROM down
$$;
GRANT  EXECUTE ON FUNCTION public.fn_region_scope_ids() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_scope_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_scope_ids() FROM PUBLIC;

-- 3. Ringkasan wilayah (cakupan bertingkat + agregat piket) ------------------
-- Definisi angka lama tidak berubah (lihat migrasi 20261014000000). Tambahan:
--   terlambat    = jumlah baris late_arrivals pada jendela (late_date).
--   izin_keluar  = jumlah baris student_exits pada jendela (exit_date).
--   Nilai 1..4 dikembalikan NULL (ambang_piket = 5); 0 dan >= 5 apa adanya.
CREATE OR REPLACE FUNCTION public.fn_region_overview(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region     uuid := public.fn_region_staff_region();
  v_scope      uuid[] := public.fn_region_scope_ids();
  v_days       integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
  v_from       date;
  v_min_cov    constant integer := 80;
  v_min_piket  constant integer := 5;
  v_result     jsonb;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  v_from := CURRENT_DATE - (v_days - 1);

  WITH sch AS (
    SELECT s.school_id, s.name, s.jenjang
    FROM public.schools s
    WHERE s.region_id = ANY (v_scope) AND s.share_with_region AND s.is_active
  ),
  sesi AS (
    SELECT ts.school_id,
           count(*)::int AS terjadwal,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.attendance a
             WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void))::int AS tercatat
    FROM public.teaching_schedules ts
    WHERE ts.school_id IN (SELECT school_id FROM sch)
      AND ts.session_date BETWEEN v_from AND CURRENT_DATE
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
      AND ts.session_date BETWEEN v_from AND CURRENT_DATE
    GROUP BY a.school_id
  ),
  siswa AS (
    SELECT st.school_id, count(*)::int AS n
    FROM public.students st
    WHERE st.school_id IN (SELECT school_id FROM sch) AND st.student_status IN ('AKTIF','PKL')
    GROUP BY st.school_id
  ),
  telat AS (
    SELECT la.school_id, count(*)::int AS n
    FROM public.late_arrivals la
    WHERE la.school_id IN (SELECT school_id FROM sch)
      AND la.late_date BETWEEN v_from AND CURRENT_DATE
    GROUP BY la.school_id
  ),
  keluar AS (
    SELECT se.school_id, count(*)::int AS n
    FROM public.student_exits se
    WHERE se.school_id IN (SELECT school_id FROM sch)
      AND se.exit_date BETWEEN v_from AND CURRENT_DATE
    GROUP BY se.school_id
  ),
  per AS (
    SELECT sch.school_id, sch.name, sch.jenjang,
           COALESCE(siswa.n, 0) AS siswa_aktif,
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
    'sampai',        CURRENT_DATE,
    'ambang_cakupan_pct', v_min_cov,
    'ambang_piket',  v_min_piket,
    'jumlah_sekolah_dibagikan', (SELECT n_sekolah FROM tot),
    'jumlah_sekolah_terdaftar', (SELECT count(*) FROM public.schools s WHERE s.region_id = ANY (v_scope)),
    'total', (SELECT CASE WHEN n_sekolah >= 3 THEN jsonb_build_object(
                'siswa_aktif', siswa,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
              END FROM tot),
    'per_jenjang', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'jenjang', COALESCE(jenjang, 'TIDAK_DIKETAHUI'),
                'jumlah_sekolah', n_sekolah,
                'siswa_aktif', siswa,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
                ORDER BY jenjang)
              FROM jen WHERE n_sekolah >= 2), '[]'::jsonb),
    'sekolah', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'school_id', school_id, 'nama', name, 'jenjang', jenjang,
                'siswa_aktif', siswa_aktif,
                'sesi_terjadwal', sesi_terjadwal, 'sesi_tercatat', sesi_tercatat,
                'cakupan_pct', cakupan_pct, 'kehadiran_pct', kehadiran_pct, 'status', status,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
                ORDER BY jenjang, name) FROM nilai), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM PUBLIC;

-- 4. Tren mingguan satu sekolah: hanya cakupan diubah ke bertingkat ----------
-- Sekolah di luar cakupan, tanpa opt-in, atau tak dikenal: hasil KOSONG yang sama.
CREATE OR REPLACE FUNCTION public.fn_region_school_trend(p_school_id uuid, p_weeks integer DEFAULT 6)
RETURNS TABLE (minggu_mulai date, sesi_terjadwal integer, sesi_tercatat integer,
               cakupan_pct integer, kehadiran_pct integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region  uuid := public.fn_region_staff_region();
  v_scope   uuid[] := public.fn_region_scope_ids();
  v_weeks   integer := LEAST(GREATEST(COALESCE(p_weeks, 6), 1), 26);
  v_from    date;
  v_min_cov constant integer := 80;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s
                 WHERE s.school_id = p_school_id AND s.region_id = ANY (v_scope)
                   AND s.share_with_region AND s.is_active) THEN
    RETURN;
  END IF;
  v_from := date_trunc('week', CURRENT_DATE - ((v_weeks - 1) * 7))::date;

  RETURN QUERY
  WITH sesi AS (
    SELECT date_trunc('week', ts.session_date)::date AS minggu,
           count(*)::int AS terjadwal,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.attendance a
             WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void))::int AS tercatat
    FROM public.teaching_schedules ts
    WHERE ts.school_id = p_school_id AND ts.meeting_status = 'NORMAL'
      AND ts.session_date BETWEEN v_from AND CURRENT_DATE
    GROUP BY 1
  ),
  hadir AS (
    SELECT date_trunc('week', ts.session_date)::date AS minggu,
           count(*)::int AS baris,
           count(*) FILTER (WHERE a.status = 'HADIR')::int AS hadir
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    WHERE a.school_id = p_school_id AND NOT a.is_void
      AND ts.session_date BETWEEN v_from AND CURRENT_DATE
    GROUP BY 1
  )
  SELECT sesi.minggu,
         sesi.terjadwal,
         sesi.tercatat,
         round(100.0 * sesi.tercatat / NULLIF(sesi.terjadwal, 0))::int,
         CASE WHEN round(100.0 * sesi.tercatat / NULLIF(sesi.terjadwal, 0)) >= v_min_cov AND hadir.baris > 0
              THEN round(100.0 * hadir.hadir / hadir.baris)::int END
  FROM sesi LEFT JOIN hadir ON hadir.minggu = sesi.minggu
  ORDER BY sesi.minggu;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_school_trend(uuid, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_school_trend(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_school_trend(uuid, integer) FROM PUBLIC;
