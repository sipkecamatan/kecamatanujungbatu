-- TU-ATT-02: ganti dedup per (session_date, student_id, status) menjadi
-- per (block_group_id, student_id) dengan status terburuk.
--
-- Masalah lama: DISTINCT ON session_date membuat dua pertemuan berbeda dalam
-- satu hari (block_group_id berbeda) yang keduanya ALPA hanya tampil sekali.
-- TU tidak tahu ada dua ketidakhadiran.
--
-- Perbaikan: CTE student_block ambil status terburuk per (block_group_id, siswa),
-- konsisten dengan fn_attendance_recap_per_class (migrasi 20261028000000) dan
-- seluruh pivot Excel di portal guru.
-- Prioritas: ALPA(1) > SAKIT(2) > IZIN(3) > HADIR(4)

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

    RETURN QUERY
    WITH student_block AS (
        -- Satu baris per (block_group_id, siswa): ambil status terburuk dan
        -- catatan dari sesi dengan status terburuk itu.
        SELECT DISTINCT ON (ts.block_group_id, a.student_id)
            ts.block_group_id,
            ts.session_date,
            ts.class_id,
            a.student_id,
            a.status,
            a.notes
        FROM public.attendance a
        JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
        WHERE a.is_void = false
          AND ts.school_id = public.fn_current_school_id()
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
          AND (p_class_id   IS NULL OR ts.class_id = p_class_id)
        ORDER BY ts.block_group_id, a.student_id,
                 -- status terburuk: ALPA < SAKIT < IZIN < HADIR
                 CASE a.status
                     WHEN 'ALPA'  THEN 1
                     WHEN 'SAKIT' THEN 2
                     WHEN 'IZIN'  THEN 3
                     WHEN 'HADIR' THEN 4
                     ELSE 5
                 END
    )
    SELECT
        sb.block_group_id,
        sb.session_date,
        c.name::text,
        s.full_name::text,
        s.nis::text,
        sb.status::text,
        sb.notes::text
    FROM student_block sb
    JOIN public.classes  c ON c.class_id   = sb.class_id
    JOIN public.students s ON s.student_id = sb.student_id
    WHERE sb.status::text = ANY(p_statuses)
      AND (p_program_id IS NULL OR c.program_id = p_program_id)
    ORDER BY sb.session_date DESC, s.full_name;
END;
$f$;
