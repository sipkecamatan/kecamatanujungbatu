-- Hapus akses waka_humas dari WAKASEK.
-- WAKASEK SMP hanya merangkap kesiswaan + kurikulum, BUKAN humas.
-- Humas = PKL/DUDI — tidak relevan untuk SMP.
-- Keputusan Romo 31 Okt 2026.

CREATE OR REPLACE FUNCTION public.fn_is_waka_humas()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active IS TRUE
          AND u.deleted_at IS NULL
          AND (u.role_type = 'WAKA_HUMAS' OR u.is_waka_humas)
    );
$function$;
