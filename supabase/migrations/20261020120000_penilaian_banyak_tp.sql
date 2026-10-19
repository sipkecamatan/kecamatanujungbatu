-- Satu penilaian dapat ditautkan ke SATU ATAU BEBERAPA TP (permintaan Romo 20 Okt 2026).
-- Sumbernya dipindah ke tabel tautan assessment_tps (satu-satunya kebenaran); kolom lama assessments.learning_objective_id dibuang setelah datanya disalin.
-- Aturan hitung: nilai satu penilaian berlaku untuk SETIAP TP yang ditautkannya (rata-rata per TP, ketercapaian per TP, dan Persentase TP mengikuti).

CREATE TABLE IF NOT EXISTS public.assessment_tps (
    assessment_id         uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id) ON DELETE CASCADE,
    school_id             uuid NOT NULL REFERENCES public.schools(school_id) ON DELETE CASCADE,
    created_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (assessment_id, learning_objective_id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_tps_lo ON public.assessment_tps (learning_objective_id);

-- Salin tautan lama (satu TP) lalu buang kolomnya.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assessments' AND column_name = 'learning_objective_id') THEN
        INSERT INTO public.assessment_tps (assessment_id, learning_objective_id, school_id)
        SELECT id, learning_objective_id, school_id FROM public.assessments WHERE learning_objective_id IS NOT NULL
        ON CONFLICT DO NOTHING;
        ALTER TABLE public.assessments DROP COLUMN learning_objective_id;
    END IF;
END $$;

-- TP yang ditautkan harus milik kelas, mapel, tahun ajaran, dan semester penilaian yang sama.
CREATE OR REPLACE FUNCTION public.fn_assessment_tps_validasi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.assessments a JOIN public.learning_objectives lo ON lo.id = NEW.learning_objective_id
        WHERE a.id = NEW.assessment_id AND a.school_id = NEW.school_id AND lo.school_id = NEW.school_id
          AND lo.class_id = a.class_id AND lo.subject_id = a.subject_id
          AND lo.academic_year::text = a.academic_year::text AND lo.semester::text = a.semester::text
    ) THEN
        RAISE EXCEPTION 'TP tidak sesuai dengan kelas, mata pelajaran, tahun ajaran, atau semester penilaian' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_assessment_tps_validasi() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_assessment_tps_validasi ON public.assessment_tps;
CREATE TRIGGER trg_assessment_tps_validasi BEFORE INSERT OR UPDATE ON public.assessment_tps FOR EACH ROW EXECUTE FUNCTION public.fn_assessment_tps_validasi();

ALTER TABLE public.assessment_tps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_assessment_tps_select ON public.assessment_tps;
CREATE POLICY rls_assessment_tps_select ON public.assessment_tps AS PERMISSIVE FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = assessment_id));   -- mewarisi aturan baca assessments
DROP POLICY IF EXISTS rls_assessment_tps_insert_owner ON public.assessment_tps;
CREATE POLICY rls_assessment_tps_insert_owner ON public.assessment_tps AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (school_id = public.fn_current_school_id() AND public.fn_owns_learning_objective(learning_objective_id)
                AND EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = assessment_id AND a.teacher_id = public.fn_current_user_id()));
DROP POLICY IF EXISTS rls_assessment_tps_delete_owner ON public.assessment_tps;
CREATE POLICY rls_assessment_tps_delete_owner ON public.assessment_tps AS PERMISSIVE FOR DELETE TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = assessment_id AND a.teacher_id = public.fn_current_user_id()));
REVOKE ALL ON TABLE public.assessment_tps FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.assessment_tps TO authenticated;
GRANT ALL ON TABLE public.assessment_tps TO service_role;

-- Kunci periode (semester ditutup) juga berlaku untuk tautan TP.
CREATE OR REPLACE FUNCTION public.fn_guard_grade_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row   jsonb;
    v_asm   record;
    v_class uuid; v_year text; v_sem integer; v_school uuid;
    v_i     integer;
BEGIN
    IF auth.uid() IS NULL OR public.fn_current_user_role() IS DISTINCT FROM 'GURU'::role_type THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    FOR v_i IN 1..2 LOOP
        IF v_i = 1 THEN
            IF TG_OP = 'INSERT' THEN CONTINUE; END IF;
            v_row := to_jsonb(OLD);
        ELSE
            IF TG_OP = 'DELETE' THEN CONTINUE; END IF;
            v_row := to_jsonb(NEW);
        END IF;
        IF TG_TABLE_NAME IN ('assessment_results', 'assessment_rubric_results', 'assessment_tps') THEN
            SELECT a.school_id, a.class_id, a.academic_year::text AS y, a.semester INTO v_asm FROM public.assessments a WHERE a.id = (v_row->>'assessment_id')::uuid;
            IF NOT FOUND THEN CONTINUE; END IF;
            v_school := v_asm.school_id; v_class := v_asm.class_id; v_year := v_asm.y; v_sem := v_asm.semester;
        ELSE
            v_school := (v_row->>'school_id')::uuid; v_class := (v_row->>'class_id')::uuid; v_year := v_row->>'academic_year'; v_sem := (v_row->>'semester')::integer;
        END IF;
        IF public.fn_grade_period_locked(v_school, v_class, v_year, v_sem) THEN
            RAISE EXCEPTION 'periode_terkunci: semester % tahun ajaran % sudah ditutup; nilai kelas ini tidak dapat diubah. Hubungi Waka Kurikulum atau Kepala Sekolah untuk membuka kunci.', v_sem, v_year
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_grade_period() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_period_assessment_tps ON public.assessment_tps;
CREATE TRIGGER trg_guard_period_assessment_tps BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_tps FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();

-- Nilai per TP untuk Waka Kurikulum/Kepsek kini membaca tautan banyak-TP.
CREATE OR REPLACE FUNCTION public.fn_nilai_per_tp(p_year varchar DEFAULT NULL, p_semester integer DEFAULT NULL)
 RETURNS TABLE(tp_id uuid, kode_tp text, deskripsi_tp text, class_id uuid, class_name text, subject_id uuid, subject_name text,
               teacher_id uuid, teacher_name text, academic_year varchar, semester integer,
               jumlah_siswa integer, rata_rata numeric, nilai_min numeric, nilai_maks numeric, tercapai integer, belum_tercapai integer, ada_kktp boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()) THEN
        RAISE EXCEPTION 'permission_denied: khusus Kepala Sekolah dan Waka Kurikulum' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH hasil AS (
        SELECT lo.id AS lo_id, ar.student_id, avg(ar.nilai) AS nilai
        FROM public.learning_objectives lo
        JOIN public.assessment_tps atp ON atp.learning_objective_id = lo.id
        JOIN public.assessments a ON a.id = atp.assessment_id AND a.jenis = 'SUMATIF' AND a.school_id = lo.school_id
        JOIN public.assessment_results ar ON ar.assessment_id = a.id AND ar.nilai IS NOT NULL AND ar.school_id = lo.school_id
        WHERE lo.school_id = public.fn_current_school_id()
          AND (p_year IS NULL OR lo.academic_year = p_year)
          AND (p_semester IS NULL OR lo.semester = p_semester)
        GROUP BY lo.id, ar.student_id
    ), batas AS (
        SELECT DISTINCT ON (ac.learning_objective_id) ac.learning_objective_id AS lo_id,
               LEAST((ac.rentang->'BSH'->>0)::numeric, (ac.rentang->'SB'->>0)::numeric) AS batas
        FROM public.assessment_criteria ac
        WHERE ac.school_id = public.fn_current_school_id() AND ac.rentang IS NOT NULL
        ORDER BY ac.learning_objective_id, ac.urutan
    )
    SELECT lo.id, lo.kode_tp::text, lo.deskripsi_tp::text, c.class_id, c.name::text, lo.subject_id, s.name::text, lo.teacher_id, u.full_name::text,
           lo.academic_year, lo.semester,
           count(h.student_id)::integer, round(avg(h.nilai), 1), round(min(h.nilai), 1), round(max(h.nilai), 1),
           (count(*) FILTER (WHERE b.batas IS NOT NULL AND h.nilai >= b.batas))::integer,
           (count(*) FILTER (WHERE b.batas IS NOT NULL AND h.nilai <  b.batas))::integer,
           (b.batas IS NOT NULL)
    FROM public.learning_objectives lo
    JOIN public.classes c  ON c.class_id = lo.class_id
    JOIN public.subjects s ON s.subject_id = lo.subject_id
    JOIN public.users u    ON u.user_id = lo.teacher_id
    LEFT JOIN hasil h  ON h.lo_id = lo.id
    LEFT JOIN batas b  ON b.lo_id = lo.id
    WHERE lo.school_id = public.fn_current_school_id()
      AND (p_year IS NULL OR lo.academic_year = p_year)
      AND (p_semester IS NULL OR lo.semester = p_semester)
    GROUP BY lo.id, c.class_id, c.name, s.name, u.full_name, b.batas
    ORDER BY c.name, s.name, lo.urutan, lo.kode_tp;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_nilai_per_tp(varchar, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nilai_per_tp(varchar, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nilai_per_tp_siswa(p_tp_id uuid)
 RETURNS TABLE(student_id uuid, nama text, nis text, nilai numeric, tercapai boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()) THEN
        RAISE EXCEPTION 'permission_denied: khusus Kepala Sekolah dan Waka Kurikulum' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH lo AS (
        SELECT l.id, l.school_id FROM public.learning_objectives l
        WHERE l.id = p_tp_id AND l.school_id = public.fn_current_school_id()
    ), batas AS (
        SELECT LEAST((ac.rentang->'BSH'->>0)::numeric, (ac.rentang->'SB'->>0)::numeric) AS batas
        FROM public.assessment_criteria ac JOIN lo ON lo.id = ac.learning_objective_id
        WHERE ac.rentang IS NOT NULL ORDER BY ac.urutan LIMIT 1
    ), hasil AS (
        SELECT ar.student_id AS sid, avg(ar.nilai) AS nilai
        FROM lo
        JOIN public.assessment_tps atp ON atp.learning_objective_id = lo.id
        JOIN public.assessments a ON a.id = atp.assessment_id AND a.jenis = 'SUMATIF' AND a.school_id = lo.school_id
        JOIN public.assessment_results ar ON ar.assessment_id = a.id AND ar.nilai IS NOT NULL AND ar.school_id = lo.school_id
        GROUP BY ar.student_id
    )
    SELECT s.student_id, s.full_name::text, s.nis::text, round(h.nilai, 1),
           CASE WHEN (SELECT batas FROM batas) IS NULL THEN NULL ELSE h.nilai >= (SELECT batas FROM batas) END
    FROM hasil h JOIN public.students s ON s.student_id = h.sid AND s.school_id = public.fn_current_school_id()
    ORDER BY s.full_name;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_nilai_per_tp_siswa(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nilai_per_tp_siswa(uuid) TO authenticated, service_role;
