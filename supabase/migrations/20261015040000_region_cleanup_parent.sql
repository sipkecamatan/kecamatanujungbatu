-- ============================================================================
-- Pembersihan sisa rancangan induk-anak.
--
-- Wilayah adalah penanda cakupan sekolah, bukan komando (lihat dokumen SSoT).
-- Rancangan induk-anak (regions.parent_region_id) diganti tiga isian per sekolah
-- pada migrasi 20261015010000 dan tidak lagi dipakai oleh fungsi mana pun.
-- Migrasi ini membuang kolom, pemicu, indeks, batasan, dan fungsi bantunya.
--
-- Aman: fn_region_overview dan fn_region_school_trend sudah tidak memanggil
-- fn_region_scope_ids sejak 20261015010000, dan fungsi edge tidak memakai
-- parent_region_id.
-- ============================================================================

SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_regions_no_cycle ON public.regions;
DROP FUNCTION IF EXISTS public.fn_regions_no_cycle();
DROP FUNCTION IF EXISTS public.fn_region_scope_ids();

DROP INDEX IF EXISTS public.idx_regions_parent;
ALTER TABLE public.regions DROP CONSTRAINT IF EXISTS regions_no_self_parent;
ALTER TABLE public.regions DROP COLUMN IF EXISTS parent_region_id;
