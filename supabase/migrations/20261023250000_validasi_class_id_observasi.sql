-- WALI-S-03: validasi p_class_id di fn_sync_observation terhadap enrollment siswa.
-- Jika p_class_id diberikan, siswa harus terdaftar (enrollment aktif) di kelas tersebut.
-- Ini mencegah metadata class_id observasi tidak konsisten dengan kenyataan.

CREATE OR REPLACE FUNCTION public.fn_sync_observation(
    p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid,
    p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text,
    p_content text, p_observed_at timestamp with time zone,
    p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
    v_school_id uuid;
    v_role      role_type;
    v_berhak    boolean;
BEGIN
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_author_user_id THEN
        RAISE EXCEPTION 'akses ditolak: penulis harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.school_id, u.role_type INTO v_school_id, v_role
    FROM users u WHERE u.user_id = p_author_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_author_user_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM students WHERE student_id = p_student_id AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'student_not_in_school: student_id = %', p_student_id
            USING ERRCODE = 'P0005';
    END IF;

    -- Validasi hak akses penulis atas siswa ini.
    IF v_role = ANY (ARRAY['BK'::role_type, 'KEPSEK'::role_type,
                            'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type,
                            'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type]) THEN
        v_berhak := true;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM class_enrollments ce
            JOIN teaching_assignments ta
              ON ta.class_id = ce.class_id AND ta.school_id = ce.school_id
            WHERE ce.student_id = p_student_id
              AND ce.school_id  = v_school_id
              AND ta.user_id    = p_author_user_id
              AND ta.is_active  = true
              AND ce.withdrawn_at IS NULL
        )
        OR EXISTS (
            SELECT 1
            FROM users u2
            JOIN students s ON s.student_id = p_student_id AND s.school_id = v_school_id
            WHERE u2.user_id = p_author_user_id
              AND u2.kaprodi_program_id IS NOT NULL
              AND u2.kaprodi_program_id = s.program_id
        )
        OR EXISTS (
            SELECT 1
            FROM users u3
            JOIN class_enrollments ce ON ce.student_id = p_student_id AND ce.withdrawn_at IS NULL
            WHERE u3.user_id = p_author_user_id
              AND u3.wali_kelas_class_id = ce.class_id
        )
        INTO v_berhak;
    END IF;

    IF NOT v_berhak THEN
        RAISE EXCEPTION 'student_not_taught: penulis tidak berhak mencatat observasi untuk siswa ini'
            USING ERRCODE = '42501';
    END IF;

    -- Validasi class_id: jika diberikan, siswa harus enrollment aktif di kelas tersebut.
    IF p_class_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM class_enrollments ce
            WHERE ce.student_id   = p_student_id
              AND ce.class_id     = p_class_id
              AND ce.school_id    = v_school_id
              AND ce.withdrawn_at IS NULL
        ) THEN
            RAISE EXCEPTION 'class_id_tidak_valid: siswa tidak terdaftar di kelas tersebut'
                USING ERRCODE = 'P0006';
        END IF;
    END IF;

    INSERT INTO observations (
        observation_id, author_user_id, student_id,
        sentiment, dimension, visibility, content, observed_at,
        schedule_id, class_id, school_id
    ) VALUES (
        p_observation_id, p_author_user_id, p_student_id,
        p_sentiment::observation_sentiment,
        p_dimension::observation_dimension,
        p_visibility::visibility_level,
        p_content, p_observed_at,
        p_schedule_id, p_class_id, v_school_id
    )
    ON CONFLICT (observation_id) DO UPDATE SET
        sentiment   = EXCLUDED.sentiment,
        dimension   = EXCLUDED.dimension,
        visibility  = EXCLUDED.visibility,
        content     = EXCLUDED.content,
        observed_at = EXCLUDED.observed_at,
        updated_at  = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (idempotency_key, function_name, result_json, school_id)
        VALUES (p_idempotency_key, 'sync-observation',
                jsonb_build_object('observation_id', p_observation_id), v_school_id)
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('observation_id', p_observation_id);
END;
$f$;