-- Keputusan Romo 18 Okt 2026: Rekap Penilaian hanyalah wadah tampilan hasil pelaksanaan penilaian (semua jenis). Nilai rapor hanya dari penilaian SUMATIF dengan
-- rumus persentase yang ditentukan guru. Agar guru tidak mengisi rumus dua kali (dulu: bobot di Rekap lalu bobot lagi di Nilai Rapor, dan keduanya hilang saat
-- halaman dimuat ulang), rumus kini disimpan SEKALI bersama nilai rapor: { metode: 'RATA'|'BOBOT'|'PERSEN', bobot: { <id penilaian>: persen } }.
-- Kolom yang sama berlaku untuk semua baris satu kelas + mapel + semester (diisi ulang setiap Simpan Nilai Rapor). Kolom `metode` yang lama tetap dipakai
-- sebagai penanda per siswa ('MANUAL' bila guru mengubah angka saran).

ALTER TABLE public.grade_final ADD COLUMN IF NOT EXISTS rumus jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grade_final_rumus_objek' AND conrelid = 'public.grade_final'::regclass) THEN
        ALTER TABLE public.grade_final
            ADD CONSTRAINT grade_final_rumus_objek CHECK (rumus IS NULL OR jsonb_typeof(rumus) = 'object');
    END IF;
END $$;

COMMENT ON COLUMN public.grade_final.rumus IS 'Rumus nilai rapor yang ditetapkan guru: {metode, bobot{id penilaian: persen}}; sama untuk seluruh baris satu kelas+mapel+semester.';
