-- Audit Catatan Siswa B-05 dan B-04.
-- B-05: fn_observation_period_lock sudah ada tetapi tidak pernah dipasang sebagai trigger, sehingga catatan masih bisa
--       ditulis pada periode akademik yang sudah ditutup (absensi sudah dikunci dengan pola yang sama).
-- B-04: penulis dapat membatalkan catatannya sendiri (disembunyikan dari siswa/orang tua) lewat fungsi khusus,
--       dengan alasan wajib; catatan tidak dihapus.
DROP TRIGGER IF EXISTS trg_observation_period_lock ON public.observations;
CREATE TRIGGER trg_observation_period_lock
    BEFORE INSERT OR UPDATE OF observed_at, content ON public.observations
    FOR EACH ROW EXECUTE FUNCTION public.fn_observation_period_lock();

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
    RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_void_observation(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_void_observation(uuid, text) TO authenticated, service_role;
