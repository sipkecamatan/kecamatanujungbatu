-- B-05: kunci TP dan KKTP saat semester ditutup.
-- learning_objectives punya class_id/academic_year/semester langsung -> fn_guard_grade_period bisa dipakai.
-- assessment_criteria hanya punya learning_objective_id -> perlu fungsi khusus yang join ke learning_objectives.

DROP TRIGGER IF EXISTS trg_guard_period_learning_objectives ON public.learning_objectives;
CREATE TRIGGER trg_guard_period_learning_objectives
    BEFORE INSERT OR UPDATE OR DELETE ON public.learning_objectives
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();

CREATE OR REPLACE FUNCTION public.fn_guard_grade_period_criteria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
    v_lo  record;
BEGIN
    IF auth.uid() IS NULL OR public.fn_current_user_role() IS DISTINCT FROM 'GURU'::role_type THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    -- Periksa baris lama (UPDATE/DELETE)
    IF TG_OP <> 'INSERT' THEN
        SELECT school_id, class_id, academic_year, semester INTO v_lo FROM public.learning_objectives WHERE id = OLD.learning_objective_id;
        IF FOUND AND public.fn_grade_period_locked(v_lo.school_id, v_lo.class_id, v_lo.academic_year::text, v_lo.semester) THEN
            RAISE EXCEPTION 'periode_terkunci: semester % tahun ajaran % sudah ditutup; KKTP tidak dapat diubah.', v_lo.semester, v_lo.academic_year
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    -- Periksa baris baru (INSERT/UPDATE)
    IF TG_OP <> 'DELETE' THEN
        SELECT school_id, class_id, academic_year, semester INTO v_lo FROM public.learning_objectives WHERE id = NEW.learning_objective_id;
        IF FOUND AND public.fn_grade_period_locked(v_lo.school_id, v_lo.class_id, v_lo.academic_year::text, v_lo.semester) THEN
            RAISE EXCEPTION 'periode_terkunci: semester % tahun ajaran % sudah ditutup; KKTP tidak dapat diubah.', v_lo.semester, v_lo.academic_year
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_guard_grade_period_criteria() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_period_assessment_criteria ON public.assessment_criteria;
CREATE TRIGGER trg_guard_period_assessment_criteria
    BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_criteria
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period_criteria();