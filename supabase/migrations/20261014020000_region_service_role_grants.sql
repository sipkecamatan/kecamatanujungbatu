-- Edge function manage-region berjalan sebagai service_role. Migrasi wilayah
-- mencabut hak dari anon/authenticated, tetapi service_role ikut kehilangan
-- SELECT/INSERT/UPDATE/DELETE pada tabel baru. Pulihkan HANYA untuk service_role.
-- anon dan authenticated tetap tanpa akses langsung (RLS aktif, tanpa policy).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.regions            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.region_staff       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.region_sharing_log TO service_role;
