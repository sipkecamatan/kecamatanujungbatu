-- fn_buka_tahun_ajaran: penugasan guru wali berlanjut ke tahun ajaran baru.
--
-- Rancangan (Romo, 17 Okt 2026): guru wali mendampingi siswa sejak awal sekolah sampai lulus. Sebelumnya penugasan
-- guru wali disimpan per tahun ajaran dan TIDAK ikut dibawa saat tahun ajaran dibuka, sehingga admin harus mengimpor
-- ulang tiap tahun. Kini penugasan aktif tahun lama disalin otomatis ke tahun baru untuk siswa AKTIF/PKL dan guru yang
-- masih aktif; siswa LULUS/KELUAR dan guru nonaktif tidak ikut. Selebihnya fungsi identik dengan versi sebelumnya.

CREATE OR REPLACE FUNCTION public.fn_buka_tahun_ajaran(p_config_id uuid, p_academic_year text, p_semester integer, p_start_date date, p_end_date date, p_old_academic_year text, p_promotion_mapping jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_current_year    TEXT;
    v_period_id       UUID;
    v_enrolled_count  INTEGER := 0;
    v_item            JSONB;
    v_target_class    UUID;
    v_student_ids     UUID[];
    v_target_name     TEXT;
    v_class_exists    BOOLEAN;
    v_rows_inserted   INTEGER;
    v_slots_copied    INTEGER := 0;
    v_gw_copied       INTEGER := 0;
BEGIN
    SELECT school_id, current_academic_year
      INTO v_school_id, v_current_year
    FROM school_config
    WHERE config_id = p_config_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- Direct authenticated calls must stay inside the caller's tenant.
    -- The Edge Function also validates this before using service_role.
    IF auth.uid() IS NOT NULL AND (
        v_school_id IS DISTINCT FROM fn_current_school_id()
        OR fn_current_user_role() <> 'ADMINISTRATIVE'
    ) THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin sekolah terkait'
            USING ERRCODE = '42501';
    END IF;

    IF p_old_academic_year IS DISTINCT FROM v_current_year THEN
        RAISE EXCEPTION 'tahun ajaran lama tidak sesuai konfigurasi sekolah';
    END IF;

    IF EXISTS (
        SELECT 1 FROM academic_periods
        WHERE academic_year = p_academic_year
          AND semester = p_semester::text::semester
          AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'Periode % Semester % sudah ada di database',
            p_academic_year, p_semester;
    END IF;

    UPDATE school_config
    SET current_academic_year = p_academic_year,
        current_semester      = p_semester::text::semester,
        updated_at            = NOW()
    WHERE config_id = p_config_id
      AND school_id = v_school_id;

    UPDATE classes
    SET academic_year = p_academic_year,
        updated_at    = NOW()
    WHERE school_id = v_school_id
      AND academic_year = p_old_academic_year;

    INSERT INTO academic_periods
        (academic_year, semester, start_date, end_date, status, school_id)
    VALUES
        (p_academic_year, p_semester::text::semester, p_start_date, p_end_date, 'ACTIVE', v_school_id)
    RETURNING id INTO v_period_id;

    INSERT INTO schedule_time_slots
        (academic_year, semester, day_of_week, slot_number,
         start_time, end_time, is_break, break_label, school_id)
    SELECT
        p_academic_year, p_semester::text::semester, day_of_week, slot_number,
        start_time, end_time, is_break, break_label, school_id
    FROM schedule_time_slots
    WHERE school_id = v_school_id
      AND academic_year = p_old_academic_year
      AND semester = p_semester::text::semester
    ON CONFLICT (school_id, academic_year, semester, day_of_week, slot_number) DO NOTHING;

    GET DIAGNOSTICS v_slots_copied = ROW_COUNT;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_promotion_mapping, '[]'::jsonb))
    LOOP
        v_target_class := (v_item->>'targetClassId')::UUID;
        v_target_name  := v_item->>'targetName';
        v_student_ids  := ARRAY(
            SELECT (el::text)::UUID
            FROM jsonb_array_elements_text(COALESCE(v_item->'studentIds', '[]'::jsonb)) el
        );

        SELECT EXISTS(
            SELECT 1 FROM classes
            WHERE class_id = v_target_class
              AND school_id = v_school_id
        ) INTO v_class_exists;

        IF NOT v_class_exists THEN
            RAISE EXCEPTION 'Kelas "%" (id: %) tidak ditemukan di sekolah ini',
                v_target_name, v_target_class;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(v_item->'studentIds', '[]'::jsonb)) el
            LEFT JOIN students s ON s.student_id = (el::text)::UUID
            WHERE s.student_id IS NULL OR s.school_id IS DISTINCT FROM v_school_id
        ) THEN
            RAISE EXCEPTION 'Mapping berisi siswa dari sekolah lain atau siswa yang tidak ditemukan'
                USING ERRCODE = '42501';
        END IF;

        IF v_student_ids IS NULL OR array_length(v_student_ids, 1) IS NULL THEN
            CONTINUE;
        END IF;

        UPDATE class_enrollments
        SET withdrawn_at = NOW(), updated_at = NOW()
        WHERE school_id = v_school_id
          AND student_id = ANY(v_student_ids)
          AND academic_year = p_old_academic_year
          AND withdrawn_at IS NULL;

        INSERT INTO class_enrollments
            (student_id, class_id, academic_year, semester)
        SELECT unnest(v_student_ids), v_target_class,
               p_academic_year, p_semester::text::semester
        ON CONFLICT (student_id, academic_year, semester) DO NOTHING;

        GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
        v_enrolled_count := v_enrolled_count + v_rows_inserted;
    END LOOP;

    -- Guru wali mendampingi siswa dari awal sekolah sampai lulus: penugasan aktif tahun lama dibawa ke tahun baru
    -- untuk siswa yang masih AKTIF/PKL dan guru yang masih aktif. Penugasan yang sudah ada di tahun baru tidak ditimpa.
    INSERT INTO guru_wali_assignments
        (school_id, guru_user_id, student_id, academic_year, is_active, assigned_by_user_id)
    SELECT g.school_id, g.guru_user_id, g.student_id, p_academic_year, TRUE, g.assigned_by_user_id
    FROM guru_wali_assignments g
    JOIN students s ON s.student_id = g.student_id AND s.school_id = v_school_id
    JOIN users u    ON u.user_id = g.guru_user_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
    WHERE g.school_id     = v_school_id
      AND g.academic_year = p_old_academic_year
      AND g.is_active     = TRUE
      AND s.student_status IN ('AKTIF', 'PKL')
    ON CONFLICT (school_id, student_id, academic_year) DO NOTHING;
    GET DIAGNOSTICS v_gw_copied = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true, 'period_id', v_period_id,
        'enrolled_count', v_enrolled_count, 'slots_copied', v_slots_copied,
        'guru_wali_dibawa', v_gw_copied
    );
END;
$function$
;
