-- WALI-S-01: roster kasus wali (getWaliCoachingStudents) membaca class_enrollments
-- dengan classId dari client; rls_enrollments_read_staff berbasis fn_can_see_student
-- sehingga wali yang juga mengajar kelas lain bisa ganti classId.
-- Perbaikan: pisahkan WALI_KELAS dari rls_enrollments_read_staff dan tambah policy
-- khusus yang mengikat ke class_id = fn_wali_kelas_class_id().

DROP POLICY IF EXISTS "rls_enrollments_read_staff" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_staff" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (
        school_id = fn_current_school_id()
        AND fn_can_see_student(student_id)
        -- WALI_KELAS ditangani policy terpisah di bawah; jangan beri akses via policy ini.
        AND fn_current_user_role() <> 'WALI_KELAS'::role_type
    );

DROP POLICY IF EXISTS "rls_enrollments_read_wali" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_wali" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND class_id = fn_wali_kelas_class_id()
    );