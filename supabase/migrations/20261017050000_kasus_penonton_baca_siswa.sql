-- Penonton kasus (yang ditandai pembuat/penangan) harus dapat membaca nama dan NIS siswa pada kasus yang
-- ditandainya; tanpa ini detail kasus menampilkan "Siswa tidak dapat ditampilkan" bagi staf yang bukan
-- wali kelas/guru siswa itu. Hanya siswa pada kasus yang ditandai, hanya selama penandaan aktif.
CREATE OR REPLACE FUNCTION public.fn_is_case_viewer_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.coaching_case_viewers v
        JOIN public.coaching_cases c ON c.case_id = v.case_id
        WHERE v.user_id = public.fn_current_user_id()
          AND v.removed_at IS NULL
          AND c.student_id = p_student_id
          AND c.school_id = public.fn_current_school_id()
    );
$function$;

REVOKE ALL ON FUNCTION public.fn_is_case_viewer_of_student(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_case_viewer_of_student(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS rls_students_read_case_viewer ON public.students;
CREATE POLICY rls_students_read_case_viewer ON public.students
    FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND public.fn_is_case_viewer_of_student(student_id));
