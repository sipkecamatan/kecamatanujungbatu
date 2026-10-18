-- Temuan uji nyata 18 Okt 2026: saat guru membatalkan Catatan Siswa, catatan hilang dari siswa dan orang tua, tetapi notifikasi "Catatan guru baru"
-- yang sudah terkirim tetap ada dan menunjuk ke catatan yang tidak lagi dapat dibaca.
-- Perbaikan: notifikasi catatan kini tersambung ke catatannya (notifications.observation_id, hapus berantai); pembatalan menghapus notifikasi itu.
-- Notifikasi lama (sebelum migrasi ini) tidak punya sambungan dan dibiarkan.

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS observation_id uuid REFERENCES public.observations(observation_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_observation ON public.notifications (observation_id) WHERE observation_id IS NOT NULL;

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
                (school_id, recipient_user_id, case_id, observation_id, type, title, body)
            VALUES (
                NEW.school_id, v_student_user_id, NULL, NEW.observation_id,
                'OBSERVATION_NEW',
                'Catatan guru baru',
                'Guru menambahkan catatan baru untuk Anda.'
            );
        END IF;
    END IF;

    IF v_ke_ortu THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, observation_id, type, title, body)
        SELECT
            NEW.school_id, sp.parent_user_id, NULL, NEW.observation_id,
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

CREATE OR REPLACE FUNCTION public.fn_void_observation(p_observation_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_me     uuid := public.fn_current_user_id();
    v_reason text := btrim(coalesce(p_reason, ''));
    v_rows   integer;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_reason) < 5 THEN
        RAISE EXCEPTION 'alasan pembatalan minimal 5 karakter' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.observations o
       SET is_void = TRUE, void_reason = left(v_reason, 500), voided_by = v_me, voided_at = now()
     WHERE o.observation_id = p_observation_id
       AND o.school_id = public.fn_current_school_id()
       AND o.is_void IS FALSE
       AND o.author_user_id = v_me;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'catatan tidak ditemukan, sudah dibatalkan, atau bukan milik Anda' USING ERRCODE = '42501';
    END IF;
    -- Catatan yang dibatalkan tidak lagi terbaca siswa/orang tua; cabut pemberitahuannya agar tidak menunjuk ke catatan yang tidak ada.
    DELETE FROM public.notifications WHERE observation_id = p_observation_id AND type = 'OBSERVATION_NEW';
    RETURN jsonb_build_object('ok', true);
END;
$function$;
