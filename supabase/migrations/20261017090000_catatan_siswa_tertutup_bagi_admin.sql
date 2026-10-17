-- Catatan Siswa hanya berhubungan dengan guru penulis, siswa, dan orang tua. Peran Administrator tidak boleh mengubah
-- (membatalkan) catatan guru; yang boleh membatalkan hanya penulis lewat fn_void_observation.
-- Admin hanya memerlukan HITUNGAN (untuk pemeriksaan sebelum menghapus data), tanpa membaca isi.
DROP POLICY IF EXISTS rls_observations_void_admin ON public.observations;

CREATE OR REPLACE FUNCTION public.fn_admin_observation_count(
    p_student_id uuid DEFAULT NULL, p_schedule_id uuid DEFAULT NULL,
    p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_with_schedule boolean DEFAULT FALSE)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF public.fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'permission_denied: khusus administrator' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT count(*)::integer FROM public.observations o
            WHERE o.school_id = public.fn_current_school_id()
              AND (p_student_id  IS NULL OR o.student_id  = p_student_id)
              AND (p_schedule_id IS NULL OR o.schedule_id = p_schedule_id)
              AND (p_from IS NULL OR o.observed_at >= p_from)
              AND (p_to   IS NULL OR o.observed_at <= p_to)
              AND (NOT p_with_schedule OR o.schedule_id IS NOT NULL));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_admin_observation_count(uuid, uuid, date, date, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_observation_count(uuid, uuid, date, date, boolean) TO authenticated, service_role;
