-- ============================================================================
-- Kode wilayah resmi (Kemendagri/BPS) pada regions.
--
-- Superadmin memilih provinsi, kabupaten/kota, dan kecamatan dari daftar (dropdown);
-- baris regions dibuat otomatis dengan kodenya, sehingga tidak perlu mengetik nama
-- dan kabupaten serta provinsi sebuah kecamatan dapat diturunkan dari kodenya
-- (kecamatan 1407022 -> kabupaten 1407 -> provinsi 14).
--
-- Kolom opsional: wilayah lama (mis. "Kecamatan Uji") tidak berkode.
-- ============================================================================

SET search_path = public, extensions;

ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS kode text;

DO $$ BEGIN
  ALTER TABLE public.regions ADD CONSTRAINT regions_kode_format
    CHECK (kode IS NULL OR kode ~ '^[0-9]{2,10}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_regions_kode ON public.regions (kode) WHERE kode IS NOT NULL;
