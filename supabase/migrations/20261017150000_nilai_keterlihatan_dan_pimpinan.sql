-- Keterlihatan nilai (jawaban Romo 17 Okt 2026):
--  1. Seorang guru hampir pasti memegang peran tambahan (wali kelas, waka, kaprodi, guru wali, ...). Kebijakan penilaian tidak boleh bergantung pada
--     peran tunggal 'GURU': 24 kebijakan guru pada tabel penilaian (TP, CP, rubrik, KKTP, hasil, rekap) kini memeriksa "staf pengajar" (fn_is_teaching_staff:
--     berperan GURU ATAU memiliki teacher_code) di samping kepemilikan baris. Sebelumnya 17 akun non-GURU yang mengajar tidak dapat membuat TP/CP/rubrik.
--  2. Nilai yang diinput guru harus dapat dilihat siswa dan orang tua atas izin guru: penilaian sudah punya is_visible_siswa/is_visible_ortu;
--     nilai rapor (grade_final) kini mendapat dua tanda yang sama (bawaan tidak terlihat) dan tampil di portal lewat fn_get_all_grades_summary.
--  3. Waka Kurikulum dan Kepala Sekolah otomatis melihat nilai setiap TP sebagai dasar kebijakan: fn_nilai_per_tp dan fn_nilai_per_tp_siswa dihitung langsung dari
--     hasil penilaian sumatif (tanpa menunggu guru menyimpan rekap), hanya untuk keduanya, dikenali lewat peran ATAU tanda (fn_is_kepsek, fn_is_waka_kurikulum).

CREATE OR REPLACE FUNCTION public.fn_is_teaching_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.user_id = public.fn_current_user_id()
          AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND u.role_type NOT IN ('SISWA'::role_type, 'ORTU'::role_type)
          AND (u.role_type = 'GURU'::role_type OR NULLIF(btrim(u.teacher_code::text), '') IS NOT NULL)
    );
$function$;
REVOKE ALL ON FUNCTION public.fn_is_teaching_staff() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_teaching_staff() TO authenticated, service_role;

DO $$
DECLARE
    p record;
    v_q  text;
    v_wc text;
    v_n  integer := 0;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('assessments', 'assessment_results', 'assessment_criteria', 'assessment_rubric_criteria', 'assessment_rubric_results',
                            'grade_recap', 'learning_objectives', 'teaching_cp', 'teaching_cp_elements')
          AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%(fn_current_user_role() = ''GURU''::role_type)%'
    LOOP
        v_q  := replace(p.qual,       '(fn_current_user_role() = ''GURU''::role_type)', 'fn_is_teaching_staff()');
        v_wc := replace(p.with_check, '(fn_current_user_role() = ''GURU''::role_type)', 'fn_is_teaching_staff()');
        EXECUTE format('ALTER POLICY %I ON %I.%I %s %s', p.policyname, p.schemaname, p.tablename,
            CASE WHEN p.qual       IS NOT NULL THEN format('USING (%s)', v_q) ELSE '' END,
            CASE WHEN p.with_check IS NOT NULL THEN format('WITH CHECK (%s)', v_wc) ELSE '' END);
        v_n := v_n + 1;
    END LOOP;
    RAISE NOTICE 'kebijakan guru diperbarui: %', v_n;
END $$;

-- ── Nilai rapor: izin tampil untuk siswa dan orang tua (bawaan tidak terlihat) ──
ALTER TABLE public.grade_final ADD COLUMN IF NOT EXISTS is_visible_siswa boolean NOT NULL DEFAULT false;
ALTER TABLE public.grade_final ADD COLUMN IF NOT EXISTS is_visible_ortu  boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS rls_grade_final_select_siswa ON public.grade_final;
CREATE POLICY rls_grade_final_select_siswa ON public.grade_final FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND public.fn_current_user_role() = 'SISWA'::role_type
           AND student_id = public.fn_current_student_id() AND is_visible_siswa IS TRUE);

DROP POLICY IF EXISTS rls_grade_final_select_ortu ON public.grade_final;
CREATE POLICY rls_grade_final_select_ortu ON public.grade_final FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND public.fn_current_user_role() = 'ORTU'::role_type
           AND public.fn_portal_can_read_student(student_id) AND is_visible_ortu IS TRUE);

-- ── Waka Kurikulum dan Kepala Sekolah: nilai setiap TP, dihitung otomatis dari penilaian sumatif ──
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
        JOIN public.assessments a ON a.learning_objective_id = lo.id AND a.jenis = 'SUMATIF' AND a.school_id = lo.school_id
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
        JOIN public.assessments a ON a.learning_objective_id = lo.id AND a.jenis = 'SUMATIF' AND a.school_id = lo.school_id
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

-- Nilai rapor tampil di portal siswa/orang tua sebagai baris jenis RAPOR (hanya bila guru mengizinkan).
CREATE OR REPLACE FUNCTION public.fn_get_all_grades_summary(p_student_id uuid DEFAULT NULL::uuid, p_academic_year character varying DEFAULT NULL::character varying, p_semester integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_id uuid;
    v_school_id uuid := fn_current_school_id();
    v_grades jsonb;
BEGIN
    v_student_id := CASE WHEN fn_current_user_role() = 'SISWA' THEN fn_current_student_id() ELSE p_student_id END;
    IF NOT fn_portal_can_read_student(v_student_id)
       OR (p_student_id IS NOT NULL AND p_student_id IS DISTINCT FROM v_student_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Akses tidak diizinkan');
    END IF;
    SELECT COALESCE(jsonb_agg(g.row_data ORDER BY g.academic_year DESC, g.semester DESC, g.subject_name, g.kind, g.id), '[]'::jsonb)
    INTO v_grades FROM (
        SELECT a.academic_year, a.semester, sub.name AS subject_name, 'ASESMEN' AS kind, ar.id,
            jsonb_build_object('grade_summary_id', ar.id, 'subject_id', a.subject_id,
                'subject_name', sub.name, 'academic_year', a.academic_year, 'semester', a.semester,
                'nilai_akhir', ar.nilai, 'predikat', ar.status, 'deskripsi_naratif', ar.umpan_balik,
                'published_at', ar.updated_at, 'kind', 'ASESMEN',
                'label', concat_ws(' - ', a.jenis, a.instrumen, a.tanggal::text)) AS row_data
        FROM assessment_results ar
        JOIN assessments a ON a.id = ar.assessment_id AND a.school_id = ar.school_id AND a.class_id = ar.class_id
        JOIN subjects sub ON sub.subject_id = a.subject_id AND sub.school_id = a.school_id
        WHERE ar.school_id = v_school_id AND ar.student_id = v_student_id
          AND fn_portal_assessment_visible(a.id)
          AND (p_academic_year IS NULL OR a.academic_year = p_academic_year)
          AND (p_semester IS NULL OR a.semester = p_semester)
        UNION ALL
        SELECT gr.academic_year, gr.semester, sub.name, 'REKAP', gr.id,
            jsonb_build_object('grade_summary_id', gr.id, 'subject_id', lo.subject_id,
                'subject_name', sub.name, 'academic_year', gr.academic_year, 'semester', gr.semester,
                'nilai_akhir', gr.nilai_akhir, 'predikat', NULL, 'deskripsi_naratif', gr.deskripsi_capaian,
                'published_at', gr.updated_at, 'kind', 'REKAP', 'label', 'Rekap tersimpan')
        FROM grade_recap gr
        JOIN learning_objectives lo ON lo.id = gr.learning_objective_id AND lo.school_id = gr.school_id
            AND lo.class_id = gr.class_id AND lo.academic_year = gr.academic_year AND lo.semester = gr.semester
        JOIN subjects sub ON sub.subject_id = lo.subject_id AND sub.school_id = lo.school_id
        WHERE gr.school_id = v_school_id AND gr.student_id = v_student_id
          AND fn_portal_recap_visible(lo.id)
          AND (p_academic_year IS NULL OR gr.academic_year = p_academic_year)
          AND (p_semester IS NULL OR gr.semester = p_semester)
        UNION ALL
        SELECT gf.academic_year, gf.semester, sub.name, 'RAPOR', gf.id,
            jsonb_build_object('grade_summary_id', gf.id, 'subject_id', gf.subject_id,
                'subject_name', sub.name, 'academic_year', gf.academic_year, 'semester', gf.semester,
                'nilai_akhir', gf.nilai_rapor, 'predikat', NULL,
                'deskripsi_naratif', NULLIF(concat_ws(' ', gf.deskripsi_tertinggi, gf.deskripsi_terendah), ''),
                'published_at', gf.updated_at, 'kind', 'RAPOR', 'label', 'Nilai rapor')
        FROM grade_final gf
        JOIN subjects sub ON sub.subject_id = gf.subject_id AND sub.school_id = gf.school_id
        WHERE gf.school_id = v_school_id AND gf.student_id = v_student_id
          AND ((fn_current_user_role() = 'SISWA' AND gf.is_visible_siswa IS TRUE)
            OR (fn_current_user_role() = 'ORTU' AND gf.is_visible_ortu IS TRUE))
          AND (p_academic_year IS NULL OR gf.academic_year = p_academic_year)
          AND (p_semester IS NULL OR gf.semester = p_semester)
    ) g;
    RETURN jsonb_build_object('success', true, 'student_id', v_student_id, 'grades', v_grades);
END;
$function$;
