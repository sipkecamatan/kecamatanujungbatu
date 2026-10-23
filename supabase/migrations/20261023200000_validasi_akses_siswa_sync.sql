-- KP-03: fn_sync_observation tidak memvalidasi bahwa penulis berhak atas siswa.
-- KP-04: fn_sync_coaching_case tidak memvalidasi bahwa pembuat berhak atas siswa.
-- Perbaikan: tambah cek server-side sebelum INSERT:
--   - Kapasitas GURU: punya teaching_assignment aktif ke kelas siswa
--   - Kapasitas KAPRODI: kaprodi_program_id = program_id siswa
--   - Role schoolwide (BK, Kepsek, Waka): boleh semua siswa di sekolah
-- Catatan: fungsi dipanggil via service_role (auth.uid()=NULL), sehingga
-- fn_teaches_student/fn_kaprodi_of_student tidak bisa dipakai langsung;
-- validasi dilakukan inline dengan p_author_user_id/p_created_by_user_id.

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
    -- Role schoolwide (BK, Kepsek, Waka) boleh semua siswa di sekolah.
    IF v_role = ANY (ARRAY['BK'::role_type, 'KEPSEK'::role_type,
                            'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type,
                            'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type]) THEN
        v_berhak := true;
    ELSE
        -- Kapasitas guru: punya teaching_assignment aktif ke kelas siswa
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
        -- Kapasitas kaprodi: kaprodi_program_id cocok dengan program siswa
        OR EXISTS (
            SELECT 1
            FROM users u2
            JOIN students s ON s.student_id = p_student_id AND s.school_id = v_school_id
            WHERE u2.user_id = p_author_user_id
              AND u2.kaprodi_program_id IS NOT NULL
              AND u2.kaprodi_program_id = s.program_id
        )
        -- Wali kelas: wali_kelas_class_id cocok dengan kelas enrollment siswa
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

CREATE OR REPLACE FUNCTION public.fn_sync_coaching_case(
    p_idempotency_key text, p_case_id uuid, p_student_id uuid,
    p_created_by_user_id uuid, p_track text, p_title text, p_description text,
    p_initiated_by_role text DEFAULT NULL::text, p_audience text DEFAULT 'PRIVATE'::text
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
    SELECT u.school_id, u.role_type INTO v_school_id, v_role
    FROM users u WHERE u.user_id = p_created_by_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_created_by_user_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Validasi hak akses pembuat kasus atas siswa ini.
    IF v_role = ANY (ARRAY['BK'::role_type, 'KEPSEK'::role_type,
                            'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type,
                            'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type]) THEN
        v_berhak := true;
    ELSIF v_role = 'DUDI'::role_type THEN
        -- DUDI divalidasi di Edge Function sebelum memanggil RPC; izinkan masuk
        v_berhak := true;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM class_enrollments ce
            JOIN teaching_assignments ta
              ON ta.class_id = ce.class_id AND ta.school_id = ce.school_id
            WHERE ce.student_id  = p_student_id
              AND ce.school_id   = v_school_id
              AND ta.user_id     = p_created_by_user_id
              AND ta.is_active   = true
              AND ce.withdrawn_at IS NULL
        )
        OR EXISTS (
            SELECT 1
            FROM users u2
            JOIN students s ON s.student_id = p_student_id AND s.school_id = v_school_id
            WHERE u2.user_id = p_created_by_user_id
              AND u2.kaprodi_program_id IS NOT NULL
              AND u2.kaprodi_program_id = s.program_id
        )
        OR EXISTS (
            SELECT 1
            FROM users u3
            JOIN class_enrollments ce ON ce.student_id = p_student_id AND ce.withdrawn_at IS NULL
            WHERE u3.user_id = p_created_by_user_id
              AND u3.wali_kelas_class_id = ce.class_id
        )
        INTO v_berhak;
    END IF;

    IF NOT v_berhak THEN
        RAISE EXCEPTION 'student_not_taught: pembuat tidak berhak membuat kasus untuk siswa ini'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO coaching_cases (
        case_id, school_id, student_id,
        created_by_user_id, current_handler_user_id,
        track, title, description
    ) VALUES (
        p_case_id, v_school_id, p_student_id,
        p_created_by_user_id, p_created_by_user_id,
        p_track::case_track, p_title, p_description
    )
    ON CONFLICT (case_id) DO NOTHING;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (idempotency_key, function_name, result_json, school_id)
        VALUES (p_idempotency_key, 'sync-case',
                jsonb_build_object('case_id', p_case_id), v_school_id)
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('case_id', p_case_id);
END;
$f$;