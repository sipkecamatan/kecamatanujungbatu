-- ============================================================================
-- Pegawai wilayah wajib mengganti kata sandi sementara.
--
-- Akun yang baru didaftarkan atau baru direset oleh superadmin diberi penanda
-- user_metadata.must_change_password = true (diatur oleh fungsi edge manage-region).
-- Selama penanda itu ada pada token, fn_region_staff_region() mengembalikan NULL,
-- sehingga fungsi agregat menolak pemanggil (42501) seperti akun yang bukan pegawai.
-- Dasbor memaksa dialog ganti kata sandi; setelah diganti, penanda dihapus dan token
-- disegarkan.
--
-- Hanya fn_region_staff_region yang diubah; fungsi lain memanggilnya.
-- ============================================================================

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.fn_region_staff_region()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rs.region_id
  FROM public.region_staff rs
  WHERE rs.auth_user_id = auth.uid()
    AND COALESCE(auth.jwt() -> 'user_metadata' ->> 'must_change_password', 'false') <> 'true'
  LIMIT 1
$$;
GRANT  EXECUTE ON FUNCTION public.fn_region_staff_region() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_staff_region() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_staff_region() FROM PUBLIC;
