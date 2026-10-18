-- Pemeriksaan kebocoran Catatan Siswa 18 Okt 2026 (aturan Romo: catatan hanya terhubung dengan penulis, siswa, dan orang tua; penulis harus mengajar siswanya).
-- L1: jalur Edge (fn_sync_observation, service_role) menerima SEMUA nilai visibilitas, termasuk RESTRICTED yang dapat dibaca Waka Humas (dan Kaprodi); formulir guru
--     dan kebijakan tulis langsung hanya mengizinkan SISWA_SAJA / ORTU_SAJA / SISWA_DAN_ORTU / PRIVATE.
-- L2: kebijakan UPDATE oleh penulis tidak memeriksa "guru mengajar siswa itu"; penulis dapat mengubah student_id catatannya ke siswa yang tidak diajar sehingga
--     catatan terbaca siswa dan orang tua siswa tersebut (tanpa notifikasi).
-- Perbaikan: (1) daftar putih visibilitas pada fn_sync_observation; (2) student_id tidak boleh berubah setelah catatan dibuat (catatan milik satu siswa).
-- Data nyata dibaca sebelum migrasi: tidak ada catatan guru berstatus RESTRICTED; tidak ada kode yang mengubah student_id.

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

    -- Daftar putih: sama dengan formulir guru dan kebijakan tulis rls_observations_insert. RESTRICTED hanya milik jalur DUDI, bukan guru.
    IF p_visibility IS NULL OR p_visibility NOT IN ('PRIVATE', 'SISWA_SAJA', 'ORTU_SAJA', 'SISWA_DAN_ORTU') THEN
        RAISE EXCEPTION 'visibilitas tidak diizinkan untuk catatan guru: %', coalesce(p_visibility, 'NULL')
            USING ERRCODE = '22023';
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

-- student_id tidak boleh berubah setelah catatan dibuat (sama seperti visibilitas yang tidak boleh berubah).
CREATE OR REPLACE FUNCTION public.fn_observation_student_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
        RAISE EXCEPTION 'catatan tidak dapat dipindahkan ke siswa lain: observation_id=%', OLD.observation_id
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_observation_student_immutable ON public.observations;
CREATE TRIGGER trg_observation_student_immutable BEFORE UPDATE ON public.observations
    FOR EACH ROW EXECUTE FUNCTION public.fn_observation_student_immutable();
