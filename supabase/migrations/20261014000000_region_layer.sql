-- ============================================================================
-- Lapisan wilayah (kecamatan): agregat lintas sekolah, lintas jenjang, READ-ONLY.
--
-- Prinsip:
--   * Pegawai kecamatan adalah akun Supabase Auth TANPA baris di public.users.
--     fn_current_school_id() mengembalikan NULL untuk mereka, sehingga seluruh RLS
--     tabel sekolah menolak akses langsung. Satu-satunya jalan data adalah fungsi
--     agregat di bawah ini.
--   * Hanya sekolah dengan share_with_region = true yang tampil.
--   * Tidak ada nama, ID siswa, atau kasus BK yang keluar dari fungsi.
--   * Persentase kehadiran hanya tampil bila cakupan input >= 80%.
--   * Total wilayah hanya tampil bila >= 3 sekolah dibagikan; subtotal jenjang
--     hanya tampil bila jenjang itu punya >= 2 sekolah (anti-diferensial).
-- ============================================================================

SET search_path = public, extensions;

-- 1. Wilayah ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.regions (
  region_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.regions FROM anon, authenticated;

ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS region_id uuid
  REFERENCES public.regions(region_id) ON DELETE SET NULL;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS jenjang text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS share_with_region boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.schools ADD CONSTRAINT schools_jenjang_check
    CHECK (jenjang IS NULL OR jenjang IN ('SMP','SMA','SMK'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Pegawai wilayah ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.region_staff (
  auth_user_id uuid PRIMARY KEY,
  region_id    uuid NOT NULL REFERENCES public.regions(region_id) ON DELETE CASCADE,
  full_name    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.region_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.region_staff FROM anon, authenticated;

-- Satu identitas tidak boleh sekaligus pegawai wilayah dan pengguna sekolah.
CREATE OR REPLACE FUNCTION public.fn_region_staff_no_dual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = NEW.auth_user_id) THEN
    RAISE EXCEPTION 'akun ini sudah menjadi pengguna sekolah'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_users_not_region_staff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.region_staff r WHERE r.auth_user_id = NEW.auth_user_id) THEN
    RAISE EXCEPTION 'akun ini sudah menjadi pegawai wilayah'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_region_staff_no_dual ON public.region_staff;
CREATE TRIGGER trg_region_staff_no_dual
  BEFORE INSERT OR UPDATE OF auth_user_id ON public.region_staff
  FOR EACH ROW EXECUTE FUNCTION public.fn_region_staff_no_dual();

DROP TRIGGER IF EXISTS trg_users_not_region_staff ON public.users;
CREATE TRIGGER trg_users_not_region_staff
  BEFORE INSERT OR UPDATE OF auth_user_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_users_not_region_staff();

REVOKE EXECUTE ON FUNCTION public.fn_region_staff_no_dual()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_users_not_region_staff() FROM PUBLIC, anon, authenticated;

-- 3. Pembantu: wilayah milik pemanggil --------------------------------------
CREATE OR REPLACE FUNCTION public.fn_region_staff_region()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rs.region_id FROM public.region_staff rs WHERE rs.auth_user_id = auth.uid() LIMIT 1
$$;
GRANT  EXECUTE ON FUNCTION public.fn_region_staff_region() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_staff_region() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_staff_region() FROM PUBLIC;

-- 4. Ringkasan wilayah ------------------------------------------------------
-- Definisi (tertulis di sini agar tidak berubah diam-diam):
--   cakupan_pct   = sesi (NORMAL) yang punya >= 1 baris absensi tidak-void
--                   / sesi (NORMAL) terjadwal pada jendela, dibulatkan.
--   kehadiran_pct = baris HADIR / seluruh baris absensi tidak-void pada jendela,
--                   dibulatkan; NULL bila cakupan < 80%.
CREATE OR REPLACE FUNCTION public.fn_region_overview(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region   uuid := public.fn_region_staff_region();
  v_days     integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
  v_from     date;
  v_min_cov  constant integer := 80;
  v_result   jsonb;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  v_from := CURRENT_DATE - (v_days - 1);

  WITH sch AS (
    SELECT s.school_id, s.name, s.jenjang
    FROM public.schools s
    WHERE s.region_id = v_region AND s.share_with_region AND s.is_active
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
  per AS (
    SELECT sch.school_id, sch.name, sch.jenjang,
           COALESCE(siswa.n, 0) AS siswa_aktif,
           COALESCE(sesi.terjadwal, 0) AS sesi_terjadwal,
           COALESCE(sesi.tercatat, 0) AS sesi_tercatat,
           COALESCE(hadir.baris, 0) AS baris,
           COALESCE(hadir.hadir, 0) AS hadir,
           CASE WHEN COALESCE(sesi.terjadwal,0) = 0 THEN NULL
                ELSE round(100.0 * sesi.tercatat / sesi.terjadwal)::int END AS cakupan_pct
    FROM sch
    LEFT JOIN siswa ON siswa.school_id = sch.school_id
    LEFT JOIN sesi  ON sesi.school_id  = sch.school_id
    LEFT JOIN hadir ON hadir.school_id = sch.school_id
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
           sum(baris) FILTER (WHERE status = 'MEMADAI')::int AS baris_ok
    FROM nilai
  ),
  jen AS (
    SELECT jenjang,
           count(*)::int AS n_sekolah,
           sum(siswa_aktif)::int AS siswa,
           sum(sesi_terjadwal)::int AS terjadwal,
           sum(sesi_tercatat)::int AS tercatat,
           sum(hadir) FILTER (WHERE status = 'MEMADAI')::int AS hadir_ok,
           sum(baris) FILTER (WHERE status = 'MEMADAI')::int AS baris_ok
    FROM nilai GROUP BY jenjang
  )
  SELECT jsonb_build_object(
    'wilayah',       (SELECT r.name FROM public.regions r WHERE r.region_id = v_region),
    'jendela_hari',  v_days,
    'dari',          v_from,
    'sampai',        CURRENT_DATE,
    'ambang_cakupan_pct', v_min_cov,
    'jumlah_sekolah_dibagikan', (SELECT n_sekolah FROM tot),
    'jumlah_sekolah_terdaftar', (SELECT count(*) FROM public.schools s WHERE s.region_id = v_region),
    'total', (SELECT CASE WHEN n_sekolah >= 3 THEN jsonb_build_object(
                'siswa_aktif', siswa,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END)
              END FROM tot),
    'per_jenjang', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'jenjang', COALESCE(jenjang, 'TIDAK_DIKETAHUI'),
                'jumlah_sekolah', n_sekolah,
                'siswa_aktif', siswa,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END)
                ORDER BY jenjang)
              FROM jen WHERE n_sekolah >= 2), '[]'::jsonb),
    'sekolah', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'school_id', school_id, 'nama', name, 'jenjang', jenjang,
                'siswa_aktif', siswa_aktif,
                'sesi_terjadwal', sesi_terjadwal, 'sesi_tercatat', sesi_tercatat,
                'cakupan_pct', cakupan_pct, 'kehadiran_pct', kehadiran_pct, 'status', status)
                ORDER BY jenjang, name) FROM nilai), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM PUBLIC;

-- 5. Tren mingguan satu sekolah ----------------------------------------------
-- Sekolah di luar wilayah, tanpa opt-in, atau tak dikenal: hasil KOSONG yang sama
-- (tidak membedakan "tidak ada" dari "tidak dibagikan").
CREATE OR REPLACE FUNCTION public.fn_region_school_trend(p_school_id uuid, p_weeks integer DEFAULT 6)
RETURNS TABLE (minggu_mulai date, sesi_terjadwal integer, sesi_tercatat integer,
               cakupan_pct integer, kehadiran_pct integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region  uuid := public.fn_region_staff_region();
  v_weeks   integer := LEAST(GREATEST(COALESCE(p_weeks, 6), 1), 26);
  v_from    date;
  v_min_cov constant integer := 80;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s
                 WHERE s.school_id = p_school_id AND s.region_id = v_region
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
