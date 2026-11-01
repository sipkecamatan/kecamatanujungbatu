-- WAKASEK (SMP) perlu akses fn_waka_kur_stats untuk Tab Wakasek
-- (monitoring sesi belum diisi, identik Waka Kurikulum via DOM-move).
-- Baseline hanya izinkan WAKA_KURIKULUM, KEPSEK, ADMINISTRATIVE.
-- Tambahkan 'WAKASEK' ke daftar role yang diizinkan.

CREATE OR REPLACE FUNCTION public.fn_waka_kur_stats(
    p_date_start date DEFAULT NULL::date,
    p_date_end   date DEFAULT NULL::date
)
RETURNS TABLE(guru_hadir bigint, guru_total bigint, guru_belum bigint, pct_hadir numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'WAKASEK', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    WITH sessions AS (
        SELECT ts.scheduled_teacher_id,
            EXISTS (
                SELECT 1 FROM public.attendance a
                WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
            ) AS filled
        FROM public.teaching_schedules ts
        WHERE ts.school_id = v_school_id
          AND ts.meeting_status = 'NORMAL'
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    ), teachers AS (
        SELECT s.scheduled_teacher_id, bool_or(s.filled) AS started,
            bool_or(NOT s.filled) AS pending
        FROM sessions s
        WHERE s.scheduled_teacher_id IS NOT NULL
        GROUP BY s.scheduled_teacher_id
    )
    SELECT count(*) FILTER (WHERE t.started), count(*),
        count(*) FILTER (WHERE t.pending),
        round(100.0 * count(*) FILTER (WHERE t.started) / nullif(count(*), 0), 1)
    FROM teachers t;
END;
$function$;
