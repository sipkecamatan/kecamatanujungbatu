-- Metode keempat nilai rapor (permintaan Romo 20 Okt 2026): "TP terakhir" = nilai TP terakhir (urutan TP terbesar yang punya penilaian sumatif).
-- Hanya mengizinkan nilai metode baru pada grade_final; rumus (jsonb) tidak berubah bentuk.
DO $$
DECLARE v_nama text;
BEGIN
    FOR v_nama IN SELECT conname FROM pg_constraint
                  WHERE conrelid = 'public.grade_final'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%metode%' AND pg_get_constraintdef(oid) ILIKE '%PERSEN%'
    LOOP
        EXECUTE format('ALTER TABLE public.grade_final DROP CONSTRAINT %I', v_nama);
    END LOOP;
    ALTER TABLE public.grade_final ADD CONSTRAINT grade_final_metode_check CHECK (metode IN ('RATA', 'BOBOT', 'PERSEN', 'TERAKHIR', 'MANUAL'));
END $$;
