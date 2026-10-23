-- A-01: tambah validasi penugasan mengajar pada INSERT/UPDATE learning_objectives dan assessments.
-- Sebelumnya RLS hanya memeriksa school_id + teacher_id; guru bisa membuat TP/asesmen
-- di kelas-mapel yang tidak ia ampu bila mengetahui UUID-nya.
-- Pola diambil dari trg_grade_final_validate (migrasi 20261017140000).

-- ── learning_objectives ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_lo_validate_penugasan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
    IF NOT (
        EXISTS (
            SELECT 1 FROM public.teaching_assignments ta
            WHERE ta.user_id      = NEW.teacher_id
              AND ta.class_id     = NEW.class_id
              AND ta.subject_id   = NEW.subject_id
              AND ta.academic_year = NEW.academic_year
              AND ta.semester::text = NEW.semester::text
              AND ta.is_active IS TRUE
        ) OR EXISTS (
            SELECT 1 FROM public.teaching_schedules ts
            WHERE ts.scheduled_teacher_id = NEW.teacher_id
              AND ts.class_id     = NEW.class_id
              AND ts.subject_id   = NEW.subject_id
              AND ts.academic_year = NEW.academic_year
              AND ts.semester::text = NEW.semester::text
        )
    ) THEN
        RAISE EXCEPTION 'teacher_not_teaching: guru tidak mengajar mata pelajaran ini di kelas ini pada periodenya'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$f$;

DROP TRIGGER IF EXISTS trg_lo_validate_penugasan ON public.learning_objectives;
CREATE TRIGGER trg_lo_validate_penugasan
    BEFORE INSERT OR UPDATE ON public.learning_objectives
    FOR EACH ROW EXECUTE FUNCTION public.fn_lo_validate_penugasan();

-- ── assessments ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_assessments_validate_penugasan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
    IF NOT (
        EXISTS (
            SELECT 1 FROM public.teaching_assignments ta
            WHERE ta.user_id      = NEW.teacher_id
              AND ta.class_id     = NEW.class_id
              AND ta.subject_id   = NEW.subject_id
              AND ta.academic_year = NEW.academic_year
              AND ta.semester::text = NEW.semester::text
              AND ta.is_active IS TRUE
        ) OR EXISTS (
            SELECT 1 FROM public.teaching_schedules ts
            WHERE ts.scheduled_teacher_id = NEW.teacher_id
              AND ts.class_id     = NEW.class_id
              AND ts.subject_id   = NEW.subject_id
              AND ts.academic_year = NEW.academic_year
              AND ts.semester::text = NEW.semester::text
        )
    ) THEN
        RAISE EXCEPTION 'teacher_not_teaching: guru tidak mengajar mata pelajaran ini di kelas ini pada periodenya'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$f$;

DROP TRIGGER IF EXISTS trg_assessments_validate_penugasan ON public.assessments;
CREATE TRIGGER trg_assessments_validate_penugasan
    BEFORE INSERT OR UPDATE ON public.assessments
    FOR EACH ROW EXECUTE FUNCTION public.fn_assessments_validate_penugasan();
