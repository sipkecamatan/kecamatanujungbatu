-- ============================================================================
-- Kendali persetujuan berbagi data ke wilayah (kecamatan) oleh KEPALA SEKOLAH.
--
--   fn_region_sharing_status()      : KEPSEK atau ADMINISTRATIVE membaca status.
--   fn_set_region_sharing(boolean)  : HANYA KEPSEK yang dapat mengubah; tercatat.
--
-- Hanya mengubah schools.share_with_region milik sekolah pemanggil.
-- Setiap perubahan dicatat di region_sharing_log (siapa, kapan, nilai).
-- ============================================================================

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.region_sharing_log (
  log_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.schools(school_id) ON DELETE CASCADE,
  changed_by uuid NOT NULL,                 -- auth.uid() pelaku
  share      boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_region_sharing_log_school
  ON public.region_sharing_log (school_id, changed_at DESC);
ALTER TABLE public.region_sharing_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.region_sharing_log FROM anon, authenticated;

-- Status (dibaca KEPSEK atau ADMINISTRATIVE sekolah)
CREATE OR REPLACE FUNCTION public.fn_region_sharing_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_school uuid := public.fn_current_school_id();
  v_is_kepsek boolean := public.fn_is_kepsek();
  r record;
BEGIN
  IF v_school IS NULL OR NOT (v_is_kepsek OR public.fn_current_user_role() = 'ADMINISTRATIVE') THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;

  SELECT s.name, s.jenjang, s.share_with_region, s.region_id,
         (SELECT g.name FROM public.regions g WHERE g.region_id = s.region_id) AS wilayah,
         (SELECT l.changed_at FROM public.region_sharing_log l
           WHERE l.school_id = s.school_id ORDER BY l.changed_at DESC LIMIT 1) AS terakhir_diubah
    INTO r
  FROM public.schools s WHERE s.school_id = v_school;

  RETURN jsonb_build_object(
    'nama_sekolah',        r.name,
    'jenjang',             r.jenjang,
    'wilayah',             r.wilayah,
    'terdaftar_di_wilayah', r.region_id IS NOT NULL,
    'dibagikan',           COALESCE(r.share_with_region, false),
    'dapat_mengubah',      v_is_kepsek AND r.region_id IS NOT NULL,
    'terakhir_diubah',     r.terakhir_diubah
  );
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_sharing_status() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_sharing_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_sharing_status() FROM PUBLIC;

-- Ubah persetujuan (hanya KEPSEK)
CREATE OR REPLACE FUNCTION public.fn_set_region_sharing(p_share boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_school uuid := public.fn_current_school_id();
  v_region uuid;
BEGIN
  IF v_school IS NULL OR NOT public.fn_is_kepsek() THEN
    RAISE EXCEPTION 'hanya kepala sekolah yang dapat mengubah pengaturan ini'
      USING ERRCODE = '42501';
  END IF;
  IF p_share IS NULL THEN
    RAISE EXCEPTION 'nilai tidak valid' USING ERRCODE = '22023';
  END IF;

  SELECT region_id INTO v_region FROM public.schools WHERE school_id = v_school;
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'sekolah belum terdaftar di wilayah mana pun' USING ERRCODE = '22023';
  END IF;

  UPDATE public.schools SET share_with_region = p_share WHERE school_id = v_school;
  INSERT INTO public.region_sharing_log (school_id, changed_by, share)
  VALUES (v_school, auth.uid(), p_share);

  RETURN public.fn_region_sharing_status();
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_set_region_sharing(boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_region_sharing(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_set_region_sharing(boolean) FROM PUBLIC;
