-- Temuan uji nyata Pembinaan Siswa 18 Okt 2026 (keputusan Romo: opsi a): siswa dan orang tua yang ditandai/dibagikan melihat JUDUL dan DESKRIPSI kasus lengkap, padahal
-- teks panel "Pembaca Kasus" berkata mereka hanya melihat komentar yang ditandai terlihat. Deskripsi ditulis untuk staf dan dapat memuat penilaian yang tidak
-- dimaksudkan untuk dibaca anak. Sejak migrasi ini siswa dan orang tua melihat HANYA: status, tanggal dibuka, nama penangan, dan komentar yang ditandai terlihat.
-- Penegakan di server: kebijakan baca SISWA/ORTU pada tabel coaching_cases dicabut (tidak ada lagi jalur membaca judul/deskripsi); portal membaca lewat fn_portal_cases
-- yang hanya mengembalikan kolom aman. Staf tidak berubah (rls_cc_read_staff / rls_cc_read_dudi). Kebijakan baca peristiwa siswa/ortu dibiarkan (hanya yang ditandai terlihat).

DROP POLICY IF EXISTS rls_cc_read_parent         ON public.coaching_cases;
DROP POLICY IF EXISTS rls_cc_read_student        ON public.coaching_cases;
DROP POLICY IF EXISTS rls_cc_read_viewer_nonstaff ON public.coaching_cases;

CREATE OR REPLACE FUNCTION public.fn_portal_cases(p_student_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role    public.role_type := public.fn_current_user_role();
    v_me      uuid := public.fn_current_user_id();
    v_school  uuid := public.fn_current_school_id();
    v_student uuid;
    v_hasil   jsonb;
BEGIN
    IF v_role = 'SISWA'::public.role_type THEN
        SELECT s.student_id INTO v_student FROM public.students s WHERE s.user_id = v_me AND s.school_id = v_school LIMIT 1;
        IF v_student IS NULL OR (p_student_id IS NOT NULL AND p_student_id <> v_student) THEN
            RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
        END IF;
    ELSIF v_role = 'ORTU'::public.role_type THEN
        IF p_student_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.student_parents sp WHERE sp.student_id = p_student_id AND sp.parent_user_id = v_me) THEN
            RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
        END IF;
        v_student := p_student_id;
    ELSE
        RAISE EXCEPTION 'akses ditolak: khusus siswa dan orang tua' USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'case_id', c.case_id,
               'status', c.status,
               'created_at', c.created_at,
               'current_handler_user_id', c.current_handler_user_id,
               'events', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                        'event_id', e.event_id, 'event_type', e.event_type, 'payload', e.payload,
                                        'created_at', e.created_at, 'is_visible_to_student', e.is_visible_to_student,
                                        'author_user_id', e.author_user_id) ORDER BY e.created_at)
                                   FROM public.coaching_case_events e
                                  WHERE e.case_id = c.case_id AND e.is_visible_to_student = true AND e.event_type = 'NOTE_ADDED'), '[]'::jsonb)
           ) ORDER BY c.created_at DESC), '[]'::jsonb)
      INTO v_hasil
      FROM public.coaching_cases c
     WHERE c.student_id = v_student
       AND c.school_id  = v_school
       AND (   (v_role = 'SISWA'::public.role_type AND c.is_shared_to_student)
            OR (v_role = 'ORTU'::public.role_type  AND c.is_shared_to_parent)
            OR EXISTS (SELECT 1 FROM public.coaching_case_viewers v
                        WHERE v.case_id = c.case_id AND v.user_id = v_me AND v.removed_at IS NULL));
    RETURN v_hasil;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_portal_cases(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_portal_cases(uuid) TO authenticated, service_role;
