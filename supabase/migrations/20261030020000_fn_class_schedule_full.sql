-- EXCEL-03: fn_class_schedule_full
-- Mengembalikan SEMUA sesi terjadwal × semua siswa aktif untuk satu kelas.
-- Berbeda dari fn_class_attendance_detail yang hanya mengembalikan sesi yang SUDAH diinput.
--
-- status = NULL  → sesi belum diinput guru (tampil "—" di Excel)
-- status = text  → status terburuk per (block, siswa) dari attendance non-void
--                  jika sesi sudah diinput tapi siswa tidak punya record → 'HADIR' (auto-detected)
--
-- Dipakai oleh tab-wali Excel agar wali kelas bisa melihat kolom abu-abu
-- untuk sesi yang belum diinput dan tahu nama guru yang belum menginput.

CREATE OR REPLACE FUNCTION public.fn_class_schedule_full(
    p_class_id      uuid,
    p_academic_year text,
    p_date_start    date DEFAULT NULL,
    p_date_end      date DEFAULT NULL
)
RETURNS TABLE(
    block_group_id uuid,
    session_date   date,
    subject_label  text,
    teacher_name   text,
    student_id     uuid,
    status         text    -- NULL = belum diinput
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
    RETURN QUERY
    WITH blocks AS (
        -- Semua block terjadwal untuk kelas ini (1 baris per block_group_id)
        SELECT DISTINCT ON (ts.block_group_id)
            ts.block_group_id,
            ts.session_date,
            ts.subject_label::text  AS subject_label,
            u.full_name::text       AS teacher_name
        FROM public.teaching_schedules ts
        JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
        WHERE ts.school_id     = public.fn_current_school_id()
          AND ts.class_id      = p_class_id
          AND ts.academic_year = p_academic_year
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
        ORDER BY ts.block_group_id, ts.session_date
    ),
    enrolled AS (
        -- Semua siswa aktif di kelas ini
        SELECT ce.student_id
        FROM public.class_enrollments ce
        WHERE ce.class_id  = p_class_id
          AND ce.school_id = public.fn_current_school_id()
          AND ce.withdrawn_at IS NULL
    ),
    input_blocks AS (
        -- Block yang sudah punya minimal 1 record absensi non-void
        SELECT DISTINCT ts.block_group_id
        FROM public.attendance a
        JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
        WHERE a.is_void       = false
          AND ts.school_id    = public.fn_current_school_id()
          AND ts.class_id     = p_class_id
          AND ts.academic_year = p_academic_year
    ),
    att AS (
        -- Status terburuk per (block, siswa) dari record non-void
        SELECT DISTINCT ON (ts.block_group_id, a.student_id)
            ts.block_group_id,
            a.student_id,
            a.status::text AS status
        FROM public.attendance a
        JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
        WHERE a.is_void       = false
          AND ts.school_id    = public.fn_current_school_id()
          AND ts.class_id     = p_class_id
          AND ts.academic_year = p_academic_year
        ORDER BY ts.block_group_id, a.student_id,
                 CASE a.status
                     WHEN 'ALPA'  THEN 1
                     WHEN 'SAKIT' THEN 2
                     WHEN 'IZIN'  THEN 3
                     WHEN 'HADIR' THEN 4
                     ELSE 5
                 END
    )
    SELECT
        b.block_group_id,
        b.session_date,
        b.subject_label,
        b.teacher_name,
        e.student_id,
        CASE
            WHEN ib.block_group_id IS NOT NULL
                -- Sudah diinput: pakai status aktual, atau HADIR jika tidak ada record (auto-detected)
                THEN COALESCE(a.status, 'HADIR')
            ELSE
                -- Belum diinput sama sekali → NULL
                NULL
        END AS status
    FROM blocks b
    CROSS JOIN enrolled e
    LEFT JOIN input_blocks ib ON ib.block_group_id  IS NOT DISTINCT FROM b.block_group_id
    LEFT JOIN att            a  ON a.block_group_id  = b.block_group_id
                                AND a.student_id     = e.student_id
    ORDER BY b.session_date, b.block_group_id, e.student_id;
END;
$f$;

REVOKE ALL ON FUNCTION public.fn_class_schedule_full(uuid, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_class_schedule_full(uuid, text, date, date)
    TO authenticated;
