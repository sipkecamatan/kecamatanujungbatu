-- A-08: urutan TP negatif dapat lolos validasi UI.
-- Input memiliki min=1 tetapi modal tidak menjalankan constraint form; parseInt(-1) tetap -1.
-- Solusi: validasi di klien (penilaian.js) + check constraint server.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_lo_urutan_positif'
          AND conrelid = 'public.learning_objectives'::regclass
    ) THEN
        ALTER TABLE public.learning_objectives
            ADD CONSTRAINT chk_lo_urutan_positif
            CHECK (urutan >= 1);
    END IF;
END $$;
