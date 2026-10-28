-- Perbaiki fn_attendance_recap_per_class: hitung pasangan (siswa × block_group)
-- per status, bukan sesi dengan ≥1 siswa berstatus X.
--
-- Metrik lama: COUNT(DISTINCT block_group_id WHERE status = X)
--   → satu block_group bisa masuk H, I, S, A sekaligus (siswa berbeda)
--   → %H selalu mendekati 100% karena hampir setiap sesi ada yang hadir
--
-- Metrik baru: COUNT(student × pertemuan pairs WHERE status = X)
--   → setiap (siswa, block_group_id/pertemuan) dihitung satu kali dengan status terburuk
--   → hadir/total = rata-rata kehadiran siswa per pertemuan (bukan per hari)

CREATE OR REPLACE FUNCTION public.fn_attendance_recap_per_class(
    p_date_start date DEFAULT NULL,
    p_date_end   date DEFAULT NULL
)
RETURNS TABLE(
    class_id uuid, name text,
    hadir bigint, alpa bigint, izin bigint, sakit bigint, total bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH
current_year AS (
    SELECT sc.current_academic_year AS yr
    FROM   public.school_config sc
    WHERE  sc.school_id = public.fn_current_school_id()
    LIMIT  1
),
eligible_classes AS (
    SELECT c.class_id, c.name
    FROM   public.classes c
    WHERE  c.school_id = public.fn_current_school_id()
      AND  c.is_active = TRUE
      AND (
            public.fn_current_user_role() = 'ADMINISTRATIVE'
            OR public.fn_is_schoolwide_observer()
            OR (
                public.fn_kaprodi_program_id() IS NOT NULL
                AND c.program_id = public.fn_kaprodi_program_id()
            )
          )
),
-- Satu baris per (siswa, kelas, pertemuan/block_group): ambil status terburuk
-- Prioritas: ALPA(1) > SAKIT(2) > IZIN(3) > HADIR(4)
student_block AS (
    SELECT
        ce.class_id,
        ce.student_id,
        ts.block_group_id,
        MIN(CASE a.status
                WHEN 'ALPA'  THEN 1
                WHEN 'SAKIT' THEN 2
                WHEN 'IZIN'  THEN 3
                WHEN 'HADIR' THEN 4
            END
        ) AS status_rank
    FROM        eligible_classes ec
    JOIN        public.class_enrollments ce
                    ON  ce.class_id      = ec.class_id
                    AND ce.school_id     = public.fn_current_school_id()
                    AND ce.academic_year = (SELECT yr FROM current_year)
                    AND ce.withdrawn_at  IS NULL
    JOIN        public.students s
                    ON  s.student_id     = ce.student_id
                    AND s.student_status = 'AKTIF'
    JOIN        public.teaching_schedules ts
                    ON  ts.class_id      = ce.class_id
                    AND ts.school_id     = public.fn_current_school_id()
                    AND ts.academic_year = (SELECT yr FROM current_year)
                    AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
                    AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    JOIN        public.attendance a
                    ON  a.schedule_id    = ts.schedule_id
                    AND a.student_id     = ce.student_id
                    AND a.school_id      = public.fn_current_school_id()
                    AND NOT a.is_void
    GROUP BY ce.class_id, ce.student_id, ts.block_group_id
)
SELECT
    ec.class_id,
    ec.name,
    COUNT(CASE sb.status_rank WHEN 4 THEN 1 END) AS hadir,
    COUNT(CASE sb.status_rank WHEN 1 THEN 1 END) AS alpa,
    COUNT(CASE sb.status_rank WHEN 3 THEN 1 END) AS izin,
    COUNT(CASE sb.status_rank WHEN 2 THEN 1 END) AS sakit,
    COUNT(sb.status_rank)                         AS total
FROM      eligible_classes ec
LEFT JOIN student_block sb ON sb.class_id = ec.class_id
GROUP BY  ec.class_id, ec.name
ORDER BY  ec.name;
$function$;
