-- Audit Catatan Siswa A-01/A-03: jalur Edge (service_role) hanya memeriksa bahwa siswa satu sekolah dengan penulis,
-- sehingga guru ber-teacher_code dapat menulis catatan tentang siswa mana pun di sekolahnya, dan akun yang sudah
-- dihapus lunak tetap dapat menulis. Aturan RLS insert (guru harus mengajar siswa itu) kini ditegakkan juga di sini,
-- dan upsert tidak boleh menimpa catatan milik penulis lain.
CREATE OR REPLACE FUNCTION public.fn_sync_observation(p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid, p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text, p_content text, p_observed_at timestamp with time zone, p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_author_user_id THEN
        RAISE EXCEPTION 'akses ditolak: penulis harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_author_user_id
      AND is_active IS TRUE
      AND deleted_at IS NULL;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_author_user_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM students
        WHERE student_id = p_student_id AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'student_not_in_school: student_id = %', p_student_id
            USING ERRCODE = 'P0005';
    END IF;

    -- Penulis harus mengajar siswa ini (jadwal mengajar atau penugasan mengajar aktif pada kelas siswa).
    IF NOT EXISTS (
        SELECT 1
        FROM class_enrollments ce
        WHERE ce.student_id = p_student_id
          AND ce.school_id = v_school_id
          AND ce.withdrawn_at IS NULL
          AND (
              EXISTS (SELECT 1 FROM teaching_schedules ts
                      WHERE ts.class_id = ce.class_id AND ts.academic_year = ce.academic_year
                        AND ts.school_id = v_school_id AND ts.scheduled_teacher_id = p_author_user_id)
              OR EXISTS (SELECT 1 FROM teaching_assignments ta
                         WHERE ta.class_id = ce.class_id AND ta.school_id = v_school_id
                           AND ta.user_id = p_author_user_id AND ta.is_active IS TRUE)
          )
    ) THEN
        RAISE EXCEPTION 'student_not_taught: penulis tidak mengajar siswa %', p_student_id
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
        updated_at  = NOW()
    WHERE observations.author_user_id = EXCLUDED.author_user_id;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-observation',
            jsonb_build_object('observation_id', p_observation_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('observation_id', p_observation_id);
END;
$function$;
