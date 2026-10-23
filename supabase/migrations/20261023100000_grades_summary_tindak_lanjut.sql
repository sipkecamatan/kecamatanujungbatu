-- Tambahkan tindak_lanjut ke fn_get_all_grades_summary (baris ASESMEN).
-- Portal siswa/ortu kini menampilkan kolom Tindak Lanjut (PENGAYAAN/PENGUATAN/PENDAMPINGAN)
-- menggantikan kolom Deskripsi yang selalu kosong untuk baris asesmen.

CREATE OR REPLACE FUNCTION public.fn_get_all_grades_summary(
    p_student_id uuid DEFAULT NULL,
    p_academic_year text DEFAULT NULL,
    p_semester integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
                'tindak_lanjut', ar.tindak_lanjut,
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
                'tindak_lanjut', NULL,
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
                'tindak_lanjut', NULL,
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
