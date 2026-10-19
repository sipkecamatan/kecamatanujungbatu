-- Keputusan Romo 19 Okt 2026: tidak ada kolom "Saran". Nilai rapor dihitung OTOMATIS dari rumus guru; guru dapat menimpa satu siswa (ditandai MANUAL).
-- Kolom saran_saat_simpan (migrasi 210000, dipakai sebentar untuk penanda "saran berubah") tidak lagi diperlukan: dua angka yang dulu bisa berbeda kini satu angka.
ALTER TABLE public.grade_final DROP CONSTRAINT IF EXISTS grade_final_saran_rentang;
ALTER TABLE public.grade_final DROP COLUMN IF EXISTS saran_saat_simpan;
