-- WALI-H-01: fn_class_attendance_summary tidak memvalidasi bahwa classId milik wali kelas.
-- Perbaikan: bila pemanggil adalah WALI_KELAS, p_class_id harus sama dengan wali_kelas_class_id.
CREATE OR REPLACE FUNCTION public.fn_class_attendance_summary(
    p_class_id uuid, p_academic_year text,
    p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date,
    p_teacher_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(student_id uuid, full_name text, nis text, hadir bigint, alpa bigint, izin bigint, sakit bigint, total bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $f$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active
          AND u.role_type IN ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
                              'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS')
    ) THEN
        RAISE EXCEPTION 'Tidak berwenang membaca rekap absensi' USING ERRCODE = '42501';
    END IF;

    -- Wali kelas hanya boleh membaca rekap kelas waliannya sendiri.
    IF public.fn_current_user_role() = 'WALI_KELAS'::role_type
       AND p_class_id IS DISTINCT FROM public.fn_wali_kelas_class_id() THEN
        RAISE EXCEPTION 'wali_kelas: hanya dapat membaca rekap kelas walian sendiri' USING ERRCODE = '42501';
    END IF;

    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        s.student_id, s.full_name::text, s.nis::text,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END)
    FROM public.class_enrollments ce
    JOIN public.students s ON s.student_id = ce.student_id
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = p_class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = p_academic_year
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
          AND (p_teacher_id IS NULL OR ts.scheduled_teacher_id = p_teacher_id)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND a.student_id = s.student_id
          AND a.school_id = public.fn_current_school_id()
          AND NOT a.is_void
    WHERE ce.class_id = p_class_id
      AND ce.school_id = public.fn_current_school_id()
      AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL
      AND s.student_status = 'AKTIF'
      AND s.school_id = public.fn_current_school_id()
      AND public.fn_can_see_student(s.student_id)
    GROUP BY s.student_id, s.full_name, s.nis
    ORDER BY s.full_name;
END;
$f$;

-- WALI-H-02: rls_cc_insert tidak membatasi wali kelas ke siswa kelasnya.
-- Perbaikan: tambah cek bila role WALI_KELAS, student_id harus ada di kelas waliannya.
DROP POLICY IF EXISTS "rls_cc_insert" ON public.coaching_cases;
CREATE POLICY "rls_cc_insert" ON public.coaching_cases AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (
        school_id = fn_current_school_id()
        AND created_by_user_id = fn_current_user_id()
        AND current_handler_user_id = fn_current_user_id()
        AND fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type])
        AND fn_student_in_current_school(student_id)
        AND NOT (
            fn_current_user_role() = 'DUDI'::role_type
            AND (track <> 'PKL'::case_track OR NOT fn_dudi_supervises_student(student_id))
        )
        -- Wali kelas hanya boleh membuat kasus untuk siswa di kelas waliannya.
        AND NOT (
            fn_current_user_role() = 'WALI_KELAS'::role_type
            AND NOT EXISTS (
                SELECT 1 FROM public.class_enrollments ce
                WHERE ce.student_id = student_id
                  AND ce.class_id = fn_wali_kelas_class_id()
                  AND ce.withdrawn_at IS NULL
            )
        )
    );

-- WALI-H-03: rls_grade_final_select_wali tidak mengikat ke class_id dan periode.
-- Wali hanya boleh melihat nilai rapor semester di mana siswa memang terdaftar di kelas wali itu.
DROP POLICY IF EXISTS rls_grade_final_select_wali ON public.grade_final;
CREATE POLICY rls_grade_final_select_wali ON public.grade_final FOR SELECT TO authenticated
    USING (
        school_id = public.fn_current_school_id()
        AND class_id = public.fn_wali_kelas_class_id()
        AND public.fn_wali_of_student(student_id)
        AND EXISTS (
            SELECT 1 FROM public.class_enrollments ce
            WHERE ce.student_id = grade_final.student_id
              AND ce.class_id   = grade_final.class_id
              AND ce.academic_year = grade_final.academic_year
              AND ce.withdrawn_at IS NULL
        )
    );