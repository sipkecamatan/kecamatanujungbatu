-- KP-05: eskalasi kasus ke KAPRODI tidak diikat ke program siswa.
-- Perbaikan: tambah cek di fn_validate_escalation — bila target KAPRODI,
-- kaprodi_program_id target harus cocok dengan program_id siswa kasus.

CREATE OR REPLACE FUNCTION public.fn_validate_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
    v_new_handler_user_id uuid;
    v_target_role         role_type;
    v_actor_role          role_type;
    v_valid_targets CONSTANT role_type[] := ARRAY[
        'GURU'::role_type,
        'BK'::role_type,
        'WALI_KELAS'::role_type,
        'WAKA_KESISWAAN'::role_type,
        'WAKA_KURIKULUM'::role_type,
        'WAKA_HUMAS'::role_type,
        'KAPRODI'::role_type
    ];
    v_student_id          uuid;
    v_kaprodi_program_id  uuid;
    v_student_program_id  uuid;
BEGIN
    IF NEW.event_type <> 'ESCALATED' THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'escalation_guard: payload.new_handler_user_id bukan UUID valid. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END;

    IF v_new_handler_user_id IS NULL THEN
        RAISE EXCEPTION 'escalation_guard: payload ESCALATED wajib menyertakan new_handler_user_id. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    SELECT u.role_type INTO v_target_role
    FROM users u
    WHERE u.user_id   = v_new_handler_user_id
      AND u.school_id = NEW.school_id
      AND u.is_active = true
      AND u.deleted_at IS NULL;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'escalation_guard: new_handler_user_id "%" tidak ditemukan sebagai user aktif di sekolah yang sama. case_id=%',
            v_new_handler_user_id, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT (v_target_role = ANY(v_valid_targets)) THEN
        RAISE EXCEPTION 'escalation_guard: peran target "%" bukan peran internal yang valid untuk eskalasi. case_id=%',
            v_target_role, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Bila target KAPRODI: pastikan program siswa cocok dengan kaprodi_program_id target.
    IF v_target_role = 'KAPRODI'::role_type THEN
        SELECT c.student_id INTO v_student_id
        FROM coaching_cases c WHERE c.case_id = NEW.case_id;

        SELECT u.kaprodi_program_id INTO v_kaprodi_program_id
        FROM users u WHERE u.user_id = v_new_handler_user_id;

        SELECT s.program_id INTO v_student_program_id
        FROM students s WHERE s.student_id = v_student_id;

        IF v_kaprodi_program_id IS NULL OR v_kaprodi_program_id IS DISTINCT FROM v_student_program_id THEN
            RAISE EXCEPTION 'escalation_guard: Kaprodi yang dituju bukan kaprodi program siswa ini. case_id=%', NEW.case_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    SELECT u.role_type INTO v_actor_role
    FROM users u WHERE u.user_id = NEW.author_user_id;

    IF v_actor_role = 'DUDI'::role_type AND v_target_role <> 'KAPRODI'::role_type THEN
        RAISE EXCEPTION 'escalation_guard: DUDI hanya boleh eskalasi ke KAPRODI, bukan "%". case_id=%',
            v_target_role, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$f$;