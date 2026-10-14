-- Jenjang SMP memakai tingkat 7-9. Batas lama (10-12) hanya cocok untuk SMA/SMK.
-- Hanya melonggarkan batas: semua baris lama (10-12) tetap valid.
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_grade_level_check;
ALTER TABLE public.classes
    ADD CONSTRAINT classes_grade_level_check CHECK (grade_level >= 7 AND grade_level <= 12);
