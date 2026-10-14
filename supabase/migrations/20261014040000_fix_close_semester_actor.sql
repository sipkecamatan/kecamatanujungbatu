-- fn_close_semester menulis auth.uid() ke academic_periods.closed_by_user_id, padahal kolom itu
-- berkunci asing ke users(user_id), bukan auth_user_id. Akibatnya penutupan semester gagal (FK) bila user_id != auth id.
-- Perbaikan: pakai fn_current_user_id(). Izin eksekusi tidak berubah (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.fn_close_semester(p_period_id uuid, p_config_id uuid, p_semester text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menutup semester'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM academic_periods
        WHERE id = p_period_id
          AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: period tidak ditemukan di sekolah ini';
    END IF;

    UPDATE academic_periods
    SET status            = 'CLOSED',
        closed_at         = now(),
        closed_by_user_id = public.fn_current_user_id()
    WHERE id = p_period_id
      AND school_id = fn_current_school_id();

    IF p_semester = '1' THEN
        UPDATE school_config
        SET current_semester = '2'
        WHERE config_id = p_config_id
          AND school_id = fn_current_school_id();
    END IF;
END;
$function$;
