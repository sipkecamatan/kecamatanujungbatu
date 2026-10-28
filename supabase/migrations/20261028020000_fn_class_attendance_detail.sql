-- EXCEL-01: getClassAttendanceByDate pakai query langsung ke teaching_schedules
-- yang dibatasi RLS rls_schedules_read_own (hanya jadwal milik guru login).
-- Akibatnya Excel Waka/BK/Wali hanya menampilkan pertemuan yang diajar
-- guru itu sendiri, bukan semua pertemuan di kelas.
--
-- Perbaikan: ganti query langsung dengan fungsi SECURITY DEFINER yang
-- mengembalikan satu baris per (block_group_id, siswa) dengan status terburuk,
-- konsisten dengan fn_tu_attendance_recap dan fn_class_attendance_summary.

CREATE OR REPLACE FUNCTION public.fn_class_attendance_detail(
    p_class_id      uuid,
    p_academic_year text,
    p_date_start    date DEFAULT NULL,
    p_date_end      date DEFAULT NULL
)
RETURNS TABLE(
    student_id     uuid,
    block_group_id uuid,
    session_date   date,
    status         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (ts.block_group_id, a.student_id)
        a.student_id,
        ts.block_group_id,
        ts.session_date,
        a.status::text
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    WHERE a.is_void = false
      AND ts.school_id   = public.fn_current_school_id()
      AND ts.class_id    = p_class_id
      AND ts.academic_year = p_academic_year
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    ORDER BY ts.block_group_id, a.student_id,
             CASE a.status
                 WHEN 'ALPA'  THEN 1
                 WHEN 'SAKIT' THEN 2
                 WHEN 'IZIN'  THEN 3
                 WHEN 'HADIR' THEN 4
                 ELSE 5
             END;
END;
$f$;
