-- Temuan uji nyata Pembinaan Siswa 18 Okt 2026: label pembaca kasus berubah dari "(Wali Kelas)" menjadi "(Guru)" setelah halaman dimuat ulang, karena label hubungan hanya
-- diingat klien selama sesi (fn_case_tag_candidates tidak mengembalikan orang yang sudah ditandai) dan, bila hilang, klien menebak dari peran akun (wali kelas berperan GURU).
-- Perbaikan: fn_case_list_viewers kini mengembalikan relation_label dari server, dengan urutan prioritas yang sama seperti fn_case_tag_candidates
-- (Wali Kelas, Guru Wali, Guru BK, Kaprodi, Orang tua, Siswa, Staf lain). Hak akses tidak berubah (authenticated dan service_role).

DROP FUNCTION IF EXISTS public.fn_case_list_viewers(uuid);

CREATE FUNCTION public.fn_case_list_viewers(p_case_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role_type role_type, added_at timestamp with time zone, added_by_name text, relation_label text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_case    public.coaching_cases%ROWTYPE;
    v_year    varchar(9);
    v_sem     public.semester;
    v_class   uuid;
    v_program uuid;
BEGIN
    IF NOT (public.fn_case_is_creator_or_handler(p_case_id) OR public.fn_is_kepsek() OR public.fn_is_waka_kesiswaan()) THEN
        RAISE EXCEPTION 'permission_denied: tidak berwenang melihat daftar pembaca' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_case FROM public.coaching_cases WHERE case_id = p_case_id AND school_id = public.fn_current_school_id();
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT sc.current_academic_year, sc.current_semester INTO v_year, v_sem
    FROM public.school_config sc WHERE sc.school_id = v_case.school_id LIMIT 1;
    SELECT ce.class_id INTO v_class FROM public.class_enrollments ce
    WHERE ce.student_id = v_case.student_id AND ce.academic_year = v_year AND ce.semester = v_sem
      AND ce.withdrawn_at IS NULL LIMIT 1;
    SELECT s.program_id INTO v_program FROM public.students s WHERE s.student_id = v_case.student_id;

    RETURN QUERY
    SELECT v.user_id, u.full_name::text, u.role_type, v.added_at, a.full_name::text,
           (CASE
              WHEN v_class IS NOT NULL AND u.wali_kelas_class_id = v_class THEN 'Wali Kelas'
              WHEN EXISTS (SELECT 1 FROM public.guru_wali_assignments gwa
                            WHERE gwa.school_id = v_case.school_id AND gwa.student_id = v_case.student_id AND gwa.is_active IS TRUE
                              AND gwa.academic_year = v_year AND gwa.guru_user_id = v.user_id) THEN 'Guru Wali'
              WHEN v_class IS NOT NULL AND EXISTS (SELECT 1 FROM public.bk_class_assignments b
                            WHERE b.school_id = v_case.school_id AND b.class_id = v_class AND b.is_active IS TRUE
                              AND b.academic_year = v_year AND b.bk_user_id = v.user_id) THEN 'Guru BK'
              WHEN v_program IS NOT NULL AND u.kaprodi_program_id = v_program THEN 'Kaprodi'
              WHEN EXISTS (SELECT 1 FROM public.student_parents sp
                            WHERE sp.student_id = v_case.student_id AND sp.parent_user_id = v.user_id) THEN 'Orang tua'
              WHEN EXISTS (SELECT 1 FROM public.students s2
                            WHERE s2.student_id = v_case.student_id AND s2.user_id = v.user_id) THEN 'Siswa'
              ELSE 'Staf lain'
            END)::text
    FROM public.coaching_case_viewers v
    JOIN public.users u ON u.user_id = v.user_id
    JOIN public.users a ON a.user_id = v.added_by_user_id
    WHERE v.case_id = p_case_id AND v.removed_at IS NULL AND v.school_id = public.fn_current_school_id()
    ORDER BY v.added_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_case_list_viewers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_case_list_viewers(uuid) TO authenticated, service_role;
