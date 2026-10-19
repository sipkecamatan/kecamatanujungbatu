-- Temuan uji nyata Penilaian 19 Okt 2026, diperbaiki di akarnya (bukan ditambal per layar):
-- (1) Penilaian tidak punya IDENTITAS: label dirakit dari teknik + instrumen, sehingga dua tes berbeda tampak kembar di Pelaksanaan, Rekap, dan bobot Nilai Rapor.
--     Kini setiap penilaian dapat diberi JUDUL (opsional, maks 120 karakter); tanpa judul, label turunan satu pintu (kode TP + tanggal + teknik) dipakai semua layar.
-- (2) Nilai rapor adalah SALINAN hasil hitung, tetapi sistem tidak tahu kapan salinan itu usang. Kini `saran_saat_simpan` mencatat saran hitung pada saat disimpan;
--     layar membandingkannya dengan saran terbaru lewat SATU fungsi (statusNilaiRapor) untuk menandai nilai yang perlu ditinjau ulang.

ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS judul text;
ALTER TABLE public.grade_final ADD COLUMN IF NOT EXISTS saran_saat_simpan numeric(5,2);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessments_judul_panjang' AND conrelid = 'public.assessments'::regclass) THEN
        ALTER TABLE public.assessments ADD CONSTRAINT assessments_judul_panjang CHECK (judul IS NULL OR char_length(judul) BETWEEN 1 AND 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grade_final_saran_rentang' AND conrelid = 'public.grade_final'::regclass) THEN
        ALTER TABLE public.grade_final ADD CONSTRAINT grade_final_saran_rentang CHECK (saran_saat_simpan IS NULL OR saran_saat_simpan BETWEEN 0 AND 100);
    END IF;
END $$;

COMMENT ON COLUMN public.assessments.judul IS 'Judul penilaian yang dibaca guru (opsional); kosong = label turunan dari TP + tanggal + teknik.';
COMMENT ON COLUMN public.grade_final.saran_saat_simpan IS 'Saran hitung nilai rapor saat baris ini disimpan; dipakai menandai nilai yang tertinggal dari penilaian terbaru. NULL = data lama (tidak diketahui).';
