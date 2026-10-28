-- Perbaiki guru_mengajar_hari_ini: hapus filter meeting_status = NORMAL.
-- Tujuan = guru yang PUNYA JADWAL hari ini, bukan yang sudah menjalankan
-- pertemuan. Semua status diikutsertakan (NORMAL, GURU_TIDAK_HADIR, dll).

CREATE OR REPLACE FUNCTION public.fn_stakeholder_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
    v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE auth_user_id = auth.uid()
      AND is_active IS TRUE
      AND deleted_at IS NULL
      AND (role_type IN ('KEPSEK', 'STAKEHOLDER') OR is_kepsek IS TRUE)
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya kepsek/stakeholder aktif'
            USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'total_siswa',
                (SELECT count(*) FROM students
                 WHERE student_status = 'AKTIF' AND school_id = v_school_id),
            'total_pkl',
                (SELECT count(*) FROM students
                 WHERE student_status = 'PKL' AND school_id = v_school_id),
            'total_staf',
                (SELECT count(*) FROM users
                 WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')
                   AND is_active IS TRUE AND deleted_at IS NULL
                   AND school_id = v_school_id),
            'total_program',
                (SELECT count(*) FROM programs
                 WHERE is_active IS TRUE AND school_id = v_school_id),
            'total_kelas',
                (SELECT count(*) FROM classes
                 WHERE is_active IS TRUE AND school_id = v_school_id),
            'pertemuan_hari_ini',
                (SELECT COUNT(DISTINCT block_group_id) FROM teaching_schedules
                 WHERE session_date = v_today
                   AND school_id = v_school_id
                   AND meeting_status = 'NORMAL'),
            'guru_mengajar_hari_ini',
                (SELECT COUNT(DISTINCT scheduled_teacher_id) FROM teaching_schedules
                 WHERE session_date = v_today
                   AND school_id = v_school_id),
            'kehadiran_bulan_pct',
                (SELECT CASE WHEN count(*) = 0 THEN NULL
                        ELSE round(100.0 * count(*) FILTER (WHERE a.status = 'HADIR') / count(*), 1)
                        END
                 FROM attendance a
                 JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                 WHERE a.is_void = FALSE
                   AND ts.session_date >= date_trunc('month', v_today)
                   AND a.school_id = v_school_id),
            'updated_at', now()
        )
    );
END;
$function$;
