-- Audit Catatan Siswa A-05: trigger notifikasi hanya mengenali visibilitas lama 'STUDENT_VISIBLE', padahal form guru
-- memakai SISWA_SAJA / ORTU_SAJA / SISWA_DAN_ORTU. Akibatnya siswa dan orang tua tidak pernah diberi tahu.
CREATE OR REPLACE FUNCTION public.fn_notify_on_observation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_user_id UUID;
    v_ke_siswa BOOLEAN := NEW.visibility::text IN ('STUDENT_VISIBLE', 'SISWA_SAJA', 'SISWA_DAN_ORTU');
    v_ke_ortu  BOOLEAN := NEW.visibility::text IN ('STUDENT_VISIBLE', 'ORTU_SAJA', 'SISWA_DAN_ORTU');
BEGIN
    IF NOT (v_ke_siswa OR v_ke_ortu) THEN
        RETURN NEW;
    END IF;

    IF v_ke_siswa THEN
        SELECT user_id INTO v_student_user_id
        FROM   students
        WHERE  student_id = NEW.student_id;

        IF v_student_user_id IS NOT NULL
           AND v_student_user_id <> NEW.author_user_id THEN
            INSERT INTO notifications
                (school_id, recipient_user_id, case_id, type, title, body)
            VALUES (
                NEW.school_id, v_student_user_id, NULL,
                'OBSERVATION_NEW',
                'Catatan guru baru',
                'Guru menambahkan catatan baru untuk Anda.'
            );
        END IF;
    END IF;

    IF v_ke_ortu THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT
            NEW.school_id, sp.parent_user_id, NULL,
            'OBSERVATION_NEW',
            'Catatan guru baru tentang anak Anda',
            'Guru menambahkan catatan baru tentang anak Anda.'
        FROM   student_parents sp
        WHERE  sp.student_id     = NEW.student_id
          AND  sp.parent_user_id <> NEW.author_user_id;
    END IF;

    RETURN NEW;
END;
$function$;
