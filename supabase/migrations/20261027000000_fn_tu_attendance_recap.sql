-- TU-ATT-01: ganti query PostgREST nested (timeout) dengan RPC function
-- agar filter session_date bisa memanfaatkan index pada teaching_schedules.

CREATE OR REPLACE FUNCTION public.fn_tu_attendance_recap(
    p_date_start  date   DEFAULT NULL,
    p_date_end    date   DEFAULT NULL,
    p_statuses    text[] DEFAULT ARRAY['ALPA','IZIN','SAKIT'],
    p_program_id  uuid   DEFAULT NULL,
    p_class_id    uuid   DEFAULT NULL
)
RETURNS TABLE(
    block_group_id uuid,
    session_date   date,
    class_name     text,
    student_name   text,
    nis            text,
    status         text,
    notes          text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $f$
BEGIN
    IF public.fn_current_user_role() <> 'TU'::role_type THEN
        RAISE EXCEPTION 'Tidak berwenang' USING ERRCODE = '42501';
    END IF;

    -- Dedup per (tanggal, siswa, status): satu baris per siswa per hari per status
    RETURN QUERY
    SELECT DISTINCT ON (ts.session_date, a.student_id, a.status)
        ts.block_group_id,
        ts.session_date,
        c.name::text,
        s.full_name::text,
        s.nis::text,
        a.status::text,
        a.notes::text
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    JOIN public.classes c             ON c.class_id     = ts.class_id
    JOIN public.students s            ON s.student_id   = a.student_id
    WHERE a.is_void = false
      AND ts.school_id = public.fn_current_school_id()
      AND a.status::text = ANY(p_statuses)
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
      AND (p_class_id   IS NULL OR ts.class_id = p_class_id)
      AND (p_program_id IS NULL OR c.program_id = p_program_id)
    ORDER BY ts.session_date DESC, a.student_id, a.status;
END;
$f$;
