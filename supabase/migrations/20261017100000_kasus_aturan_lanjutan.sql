-- Aturan kasus pembinaan lanjutan (disetujui Romo 17 Okt 2026), ditegakkan di server:
--  1. Eskalasi hanya ke kandidat terkait kasus (fn_get_escalation_candidates), bukan sembarang staf.
--  2. Status: maju bebas; mundur hanya SATU langkah dan wajib bercatatan; membuka kembali kasus CLOSED
--     (ke MONITORING, bercatatan) hanya oleh Waka Kesiswaan atau Kepala Sekolah.
--  3. Hanya event NOTE_ADDED yang boleh terlihat oleh siswa/orang tua; event lain dipaksa tidak terlihat.
--  4. Tabel student_updates tidak dipakai klien mana pun; kebijakan baca stafnya dicabut (tertutup).
CREATE OR REPLACE FUNCTION public.fn_coaching_event_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old   case_status;
    v_new   case_status;
    v_ro    integer;
    v_rn    integer;
    v_to    uuid;
    v_note  text;
    v_order CONSTANT text[] := ARRAY['OPEN','UNDER_REVIEW','INTERVENTION','MONITORING','CLOSED'];
BEGIN
    IF NEW.event_type <> 'NOTE_ADDED' THEN
        NEW.is_visible_to_student := FALSE;
    END IF;

    IF NEW.event_type = 'ESCALATED' AND auth.uid() IS NOT NULL THEN
        v_to := (NEW.payload->>'new_handler_user_id')::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.fn_get_escalation_candidates(NEW.case_id) c WHERE c.user_id = v_to) THEN
            RAISE EXCEPTION 'escalation_guard: penerima bukan kandidat terkait kasus ini. case_id=%', NEW.case_id
                USING ERRCODE = 'P0001';
        END IF;
    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        SELECT status INTO v_old FROM public.coaching_cases WHERE case_id = NEW.case_id;
        v_new  := (NEW.payload->>'new_status')::case_status;
        v_note := btrim(coalesce(NEW.payload->>'note', ''));
        v_ro := array_position(v_order, v_old::text);
        v_rn := array_position(v_order, v_new::text);
        IF v_new = v_old THEN
            RAISE EXCEPTION 'status_guard: status tidak berubah' USING ERRCODE = 'P0001';
        ELSIF v_new = 'CLOSED' THEN
            RAISE EXCEPTION 'status_guard: gunakan penutupan kasus (event CLOSED)' USING ERRCODE = 'P0001';
        ELSIF v_old = 'CLOSED' THEN
            IF NOT (public.fn_is_kepsek() OR public.fn_is_waka_kesiswaan()) THEN
                RAISE EXCEPTION 'status_guard: hanya Waka Kesiswaan atau Kepala Sekolah yang dapat membuka kembali kasus' USING ERRCODE = '42501';
            END IF;
            IF v_new <> 'MONITORING' OR char_length(v_note) < 5 THEN
                RAISE EXCEPTION 'status_guard: kasus dibuka kembali ke Pemantauan dan wajib bercatatan (min. 5 karakter)' USING ERRCODE = 'P0001';
            END IF;
        ELSIF v_rn < v_ro THEN
            IF v_rn <> v_ro - 1 OR char_length(v_note) < 5 THEN
                RAISE EXCEPTION 'status_guard: mundur hanya satu langkah dan wajib bercatatan (min. 5 karakter)' USING ERRCODE = 'P0001';
            END IF;
        END IF;
    ELSIF NEW.event_type = 'CLOSED' THEN
        IF (SELECT status FROM public.coaching_cases WHERE case_id = NEW.case_id) = 'CLOSED' THEN
            RAISE EXCEPTION 'status_guard: kasus sudah ditutup' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cce_rules ON public.coaching_case_events;
CREATE TRIGGER trg_cce_rules BEFORE INSERT ON public.coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_coaching_event_rules();

-- Waka Kesiswaan boleh menambah event STATUS_CHANGED untuk membuka kembali kasus CLOSED (aturan isinya di trigger).
DROP POLICY IF EXISTS rls_cce_insert ON public.coaching_case_events;
CREATE POLICY rls_cce_insert ON public.coaching_case_events FOR INSERT TO PUBLIC
    WITH CHECK (
        school_id = public.fn_current_school_id()
        AND author_user_id = public.fn_current_user_id()
        AND (
            current_setting('app.coaching_sync_active', true) = 'true'
            OR public.fn_is_kepsek()
            OR EXISTS (SELECT 1 FROM public.coaching_cases c
                       WHERE c.case_id = coaching_case_events.case_id
                         AND c.current_handler_user_id = public.fn_current_user_id()
                         AND c.status <> 'CLOSED'::case_status)
            OR (public.fn_is_waka_kesiswaan() AND event_type = 'STATUS_CHANGED'
                AND EXISTS (SELECT 1 FROM public.coaching_cases c
                            WHERE c.case_id = coaching_case_events.case_id AND c.status = 'CLOSED'::case_status))
        )
    );

DROP POLICY IF EXISTS rls_student_updates_read_staff ON public.student_updates;

CREATE OR REPLACE FUNCTION public.fn_coaching_case_sync_handler()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_handler_user_id UUID;
    v_new_status          case_status;
BEGIN
    -- OPENED dan NOTE_ADDED tidak mengubah state coaching_cases
    IF NEW.event_type IN ('NOTE_ADDED', 'OPENED') THEN
        RETURN NEW;
    END IF;

    PERFORM set_config('app.coaching_sync_active', 'true', true);

    IF NEW.event_type = 'ESCALATED' THEN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;

        -- Tutup handler aktif sekarang
        UPDATE coaching_case_handlers
        SET handover_at = NOW()
        WHERE case_id   = NEW.case_id
          AND handover_at IS NULL;

        -- Buka handler baru
        INSERT INTO coaching_case_handlers (
            case_id, school_id, handler_user_id, assigned_by_user_id
        ) VALUES (
            NEW.case_id, NEW.school_id, v_new_handler_user_id, NEW.author_user_id
        );

        -- Update denormalized field di coaching_cases
        UPDATE coaching_cases
        SET current_handler_user_id = v_new_handler_user_id,
            updated_at              = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        v_new_status := (NEW.payload->>'new_status')::case_status;
        UPDATE coaching_cases
        SET status            = v_new_status,
            -- Dibuka kembali dari CLOSED: kosongkan penutupan.
            closed_at         = CASE WHEN v_new_status = 'CLOSED' THEN closed_at ELSE NULL END,
            closed_by_user_id = CASE WHEN v_new_status = 'CLOSED' THEN closed_by_user_id ELSE NULL END,
            updated_at        = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'CASE_EDITED' THEN
        UPDATE coaching_cases
        SET title       = COALESCE(NULLIF(NEW.payload->>'new_title', ''),       title),
            description = COALESCE(NULLIF(NEW.payload->>'new_description', ''), description),
            updated_at  = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'SHARED_TO_STUDENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_student = TRUE,
            updated_at           = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_STUDENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_student = FALSE,
            updated_at           = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'SHARED_TO_PARENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_parent = TRUE,
            updated_at          = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_PARENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_parent = FALSE,
            updated_at          = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'CLOSED' THEN
        UPDATE coaching_cases
        SET status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id,
            updated_at        = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    END IF;

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$function$;

-- Kasus CLOSED menolak event baru, kecuali STATUS_CHANGED (pembukaan kembali), yang syaratnya dijaga
-- fn_coaching_event_rules (hanya Waka Kesiswaan/Kepala Sekolah, ke Pemantauan, bercatatan).
CREATE OR REPLACE FUNCTION public.fn_coaching_case_events_no_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.event_type <> 'STATUS_CHANGED' AND EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = NEW.case_id AND status = 'CLOSED'
    ) THEN
        RAISE EXCEPTION 'case_closed: tidak bisa menambah event ke kasus yang sudah ditutup. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
