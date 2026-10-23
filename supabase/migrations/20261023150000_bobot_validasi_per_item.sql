-- A-04: validasi tiap item bobot dalam grade_final.rumus harus 0–100.
-- Sebelumnya hanya total 100% yang dicek; bobot -20% + 120% dapat lolos.
-- Solusi: fungsi helper yang memeriksa tiap nilai, dipanggil dari trigger grade_final.

CREATE OR REPLACE FUNCTION public.fn_grade_final_validate_bobot(p_rumus jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $f$
    SELECT CASE
        WHEN p_rumus IS NULL THEN true
        WHEN jsonb_typeof(p_rumus) <> 'object' THEN false
        WHEN p_rumus->>'metode' <> 'BOBOT' THEN true
        WHEN jsonb_typeof(p_rumus->'bobot') <> 'object' THEN true   -- tidak ada bobot: OK, totalBobot akan menolak saat hitung
        ELSE (
            SELECT bool_and(
                jsonb_typeof(val) = 'number'
                AND (val::text)::numeric >= 0
                AND (val::text)::numeric <= 100
            )
            FROM jsonb_each(p_rumus->'bobot') AS kv(key, val)
        )
    END
$f$;

-- Tambahkan constraint pada grade_final menggunakan fungsi di atas.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'grade_final_rumus_bobot_range'
          AND conrelid = 'public.grade_final'::regclass
    ) THEN
        ALTER TABLE public.grade_final
            ADD CONSTRAINT grade_final_rumus_bobot_range
            CHECK (fn_grade_final_validate_bobot(rumus));
    END IF;
END $$;
