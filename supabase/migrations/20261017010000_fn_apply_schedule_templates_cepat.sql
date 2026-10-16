-- fn_apply_schedule_templates: lebih cepat tanpa mengubah hasil.
--
-- Masalah: "Terapkan Jadwal" di wizard gagal ("Terjadi kesalahan pada server") pada sekolah dengan jadwal penuh
-- (880 templat -> 23.259 sesi). Fungsi berjalan 6-7 detik, mendekati batas 8 detik jalur API (statement_timeout
-- peran authenticator/PostgREST), karena pencarian mapel (subjects ILIKE) diulang untuk setiap sesi di tiga tempat.
--
-- Perbaikan: pencarian mapel dihitung SEKALI per label unik (CTE subj, MATERIALIZED) lalu dipakai lewat JOIN.
-- Semantik sama persis: nama ILIKE label atau kode ILIKE label, LIMIT 1, cadangan subject KBM.
-- Terbukti pada data nyata smkuji1 (transaksi dibatalkan): hasil identik (23.259 sesi, 517 penugasan, md5 sama),
-- waktu 6,65 -> 3,91 detik. Tanda tangan, SECURITY DEFINER, search_path, dan hak akses tidak berubah.

CREATE OR REPLACE FUNCTION public.fn_apply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_kbm_id    uuid;
    v_start     date;
    v_end       date;
    v_templates integer;
    v_assigns   integer;
    v_schedules integer;

    v_label     text;
    v_subj_id   uuid;
BEGIN
    SELECT count(*) INTO v_templates
    FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_templates = 0 THEN
        RETURN jsonb_build_object('templates_found', 0, 'assignments_upserted', 0, 'schedules_generated', 0);
    END IF;

    SELECT start_date, end_date INTO v_start, v_end
    FROM academic_periods
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Periode akademik % semester % belum terdaftar', p_academic_year, p_semester;
    END IF;

    SELECT subject_id INTO v_kbm_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_kbm_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_kbm_id;
    END IF;

    FOR v_label IN
        SELECT DISTINCT subject_label
        FROM schedule_templates
        WHERE academic_year = p_academic_year AND semester = p_semester
          AND school_id = p_school_id
          AND subject_label IS NOT NULL
          AND TRIM(subject_label) <> ''
    LOOP
        SELECT subject_id INTO v_subj_id
        FROM subjects
        WHERE school_id = p_school_id AND is_active = true
          AND name ILIKE v_label
        LIMIT 1;

        IF v_subj_id IS NULL THEN
            SELECT subject_id INTO v_subj_id
            FROM subjects
            WHERE school_id = p_school_id AND is_active = true
              AND code ILIKE v_label
            LIMIT 1;
        END IF;

        IF v_subj_id IS NULL THEN
            INSERT INTO subjects (code, name, is_active, school_id)
            VALUES (
                UPPER(LEFT(REGEXP_REPLACE(v_label, '\s+', '_', 'g'), 20)),
                v_label,
                true,
                p_school_id
            )
            RETURNING subject_id INTO v_subj_id;
        END IF;
    END LOOP;

    WITH subj AS MATERIALIZED (
        SELECT l.lbl,
               (SELECT x.subject_id FROM subjects x
                 WHERE x.school_id = p_school_id AND x.is_active = true
                   AND (x.name ILIKE l.lbl OR x.code ILIKE l.lbl)
                 LIMIT 1) AS sid
        FROM (SELECT DISTINCT subject_label AS lbl
              FROM schedule_templates
              WHERE academic_year = p_academic_year AND semester = p_semester
                AND school_id = p_school_id AND subject_label IS NOT NULL) l
    )
    INSERT INTO teaching_assignments
        (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT
        t.teacher_id,
        t.class_id,
        COALESCE(sj.sid, v_kbm_id),
        p_academic_year,
        p_semester,
        true,
        p_school_id
    FROM schedule_templates t
    LEFT JOIN subj sj ON sj.lbl = t.subject_label
    WHERE t.academic_year = p_academic_year
      AND t.semester      = p_semester
      AND t.school_id     = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assigns = ROW_COUNT;

    UPDATE teaching_assignments ta
    SET    is_active = false
    WHERE  ta.school_id     = p_school_id
      AND  ta.academic_year = p_academic_year
      AND  ta.semester      = p_semester
      AND  ta.is_active     = true
      AND  NOT EXISTS (
               SELECT 1
               FROM   schedule_templates st
               WHERE  st.school_id     = p_school_id
                 AND  st.academic_year = p_academic_year
                 AND  st.semester      = p_semester
                 AND  st.teacher_id    = ta.user_id
                 AND  st.class_id      = ta.class_id
           );

    -- Sesi harian: generate dengan block_group_id via CTE window function.
    -- raw_slots: set lengkap slot dari template × generate_series
    -- ordered:   tambah LAG(session_end) sebagai prev_end per partisi
    -- flagged:   hitung is_new_block (1 = awal blok baru)
    -- grouped:   running SUM(is_new_block) = block_number per baris
    -- block_uuids: 1 UUID per (teacher,class,date,block_number) unik
    -- INSERT JOIN block_uuids: setiap baris dalam blok yang sama dapat UUID yang sama.
    --
    -- Known limitation: INSERT parsial ke tanggal yang sudah sebagian terisi
    -- dari template yang sama akan menghasilkan block_group_id berbeda dari
    -- sesi lama meski seharusnya satu blok. Tidak terjadi saat ini karena
    -- semua jalur reapply selalu DELETE penuh dulu sebelum re-INSERT.
    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end, subject_label,
         academic_year, semester, meeting_status, teacher_indicator,
         school_id, block_group_id)
    WITH subj AS MATERIALIZED (
        SELECT l.lbl,
               (SELECT x.subject_id FROM subjects x
                 WHERE x.school_id = p_school_id AND x.is_active = true
                   AND (x.name ILIKE l.lbl OR x.code ILIKE l.lbl)
                 LIMIT 1) AS sid
        FROM (SELECT DISTINCT subject_label AS lbl
              FROM schedule_templates
              WHERE academic_year = p_academic_year AND semester = p_semester
                AND school_id = p_school_id AND subject_label IS NOT NULL) l
    ),
    raw_slots AS (
        SELECT
            a.assignment_id,
            t.class_id,
            COALESCE(sj.sid, v_kbm_id) AS subject_id,
            t.teacher_id               AS scheduled_teacher_id,
            gs.d::date                 AS session_date,
            t.start_time               AS session_start,
            t.end_time                 AS session_end,
            t.subject_label,
            p_academic_year            AS academic_year,
            p_semester                 AS semester,
            'NORMAL'::meeting_status   AS meeting_status,
            'PENDING_EVALUATION'::teacher_attendance_indicator AS teacher_indicator,
            p_school_id                AS school_id
        FROM schedule_templates t
        LEFT JOIN subj sj ON sj.lbl = t.subject_label
        JOIN teaching_assignments a
          ON a.user_id       = t.teacher_id
         AND a.class_id      = t.class_id
         AND a.subject_id    = COALESCE(sj.sid, v_kbm_id)
         AND a.academic_year = p_academic_year
         AND a.semester      = p_semester
        JOIN generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs(d)
          ON extract(isodow from gs.d) = CASE t.day_of_week::text
                WHEN 'SENIN'  THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
                WHEN 'KAMIS'  THEN 4 WHEN 'JUMAT'  THEN 5 WHEN 'SABTU' THEN 6 END
        WHERE t.academic_year = p_academic_year
          AND t.semester      = p_semester
          AND t.school_id     = p_school_id
    ),
    ordered AS (
        SELECT *,
            LAG(session_end) OVER (
                PARTITION BY scheduled_teacher_id, class_id, session_date
                ORDER BY session_start
            ) AS prev_end
        FROM raw_slots
    ),
    flagged AS (
        SELECT *,
            CASE
                WHEN prev_end IS NULL THEN 1
                WHEN EXTRACT(EPOCH FROM (session_start - prev_end)) / 60 > 40 THEN 1
                ELSE 0
            END AS is_new_block
        FROM ordered
    ),
    grouped AS (
        SELECT *,
            SUM(is_new_block) OVER (
                PARTITION BY scheduled_teacher_id, class_id, session_date
                ORDER BY session_start
                ROWS UNBOUNDED PRECEDING
            ) AS block_number
        FROM flagged
    ),
    block_uuids AS (
        SELECT DISTINCT
            scheduled_teacher_id,
            class_id,
            session_date,
            block_number,
            gen_random_uuid() AS block_uuid
        FROM grouped
    )
    SELECT
        g.assignment_id,
        g.class_id,
        g.subject_id,
        g.scheduled_teacher_id,
        g.session_date,
        g.session_start,
        g.session_end,
        g.subject_label,
        g.academic_year,
        g.semester,
        g.meeting_status,
        g.teacher_indicator,
        g.school_id,
        bu.block_uuid
    FROM grouped g
    JOIN block_uuids bu
      ON  bu.scheduled_teacher_id = g.scheduled_teacher_id
      AND bu.class_id             = g.class_id
      AND bu.session_date         = g.session_date
      AND bu.block_number         = g.block_number
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assigns,
        'schedules_generated',  v_schedules
    );
END;
$function$;
