-- B-07 (keputusan Romo 18 Okt 2026): nilai dikunci setelah semester ditutup.
--  * Admin sekolah tetap yang menutup semester (fn_close_semester, tidak diubah); periode berstatus CLOSED = nilai semester itu terkunci bagi GURU.
--  * Yang dikunci: asesmen, hasil asesmen, hasil rubrik, rekap nilai (grade_recap), dan nilai rapor (grade_final) pada tahun ajaran + semester yang CLOSED.
--  * Kepala Sekolah dan Waka Kurikulum dapat MEMBUKA kunci per kelas dengan alasan tertulis (minimal 10 karakter), dan menguncinya kembali.
--    Setiap pembukaan tercatat (siapa, kapan, alasan, kapan dikunci ulang) di grade_period_unlocks.
--  * Pengecualian disengaja: penjaga hanya berlaku bagi pemanggil berperan GURU yang masuk lewat JWT. Admin, service_role, dan SQL langsung
--    (penghapusan pengguna/sekolah, wizard reset, cascade) tidak terhalang. Jurnal mengajar tidak dikunci (tidak terkait kelas/semester).

CREATE TABLE IF NOT EXISTS public.grade_period_unlocks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL REFERENCES public.schools(school_id) ON DELETE CASCADE,
    class_id      uuid NOT NULL REFERENCES public.classes(class_id) ON DELETE CASCADE,
    academic_year varchar NOT NULL,
    semester      integer NOT NULL CHECK (semester IN (1, 2)),
    reason        text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
    unlocked_by   uuid NOT NULL REFERENCES public.users(user_id),
    unlocked_at   timestamptz NOT NULL DEFAULT now(),
    relocked_at   timestamptz,
    relocked_by   uuid REFERENCES public.users(user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_period_unlock_aktif
    ON public.grade_period_unlocks (school_id, class_id, academic_year, semester) WHERE relocked_at IS NULL;

ALTER TABLE public.grade_period_unlocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.grade_period_unlocks TO authenticated;
GRANT ALL ON public.grade_period_unlocks TO service_role;
DROP POLICY IF EXISTS rls_grade_period_unlocks_select ON public.grade_period_unlocks;
CREATE POLICY rls_grade_period_unlocks_select ON public.grade_period_unlocks AS PERMISSIVE FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum() OR public.fn_current_user_role() = 'ADMINISTRATIVE'::role_type));

-- Apakah nilai kelas+tahun+semester ini terkunci (periode CLOSED dan belum dibuka untuk kelas itu)?
CREATE OR REPLACE FUNCTION public.fn_grade_period_locked(p_school uuid, p_class uuid, p_year text, p_semester integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (SELECT 1 FROM public.academic_periods p
                   WHERE p.school_id = p_school AND p.academic_year = p_year AND p.semester::text = p_semester::text AND p.status = 'CLOSED')
       AND NOT EXISTS (SELECT 1 FROM public.grade_period_unlocks u
                       WHERE u.school_id = p_school AND u.class_id = p_class AND u.academic_year = p_year AND u.semester = p_semester AND u.relocked_at IS NULL);
$function$;
REVOKE ALL ON FUNCTION public.fn_grade_period_locked(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_grade_period_locked(uuid, uuid, text, integer) TO service_role;

-- Penjaga: menolak tulis (INSERT/UPDATE/DELETE) oleh GURU pada nilai yang periodenya terkunci. Memeriksa baris lama DAN baru (mencegah memindahkan nilai keluar).
CREATE OR REPLACE FUNCTION public.fn_guard_grade_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row   jsonb;
    v_asm   record;
    v_class uuid; v_year text; v_sem integer; v_school uuid;
    v_i     integer;
BEGIN
    IF auth.uid() IS NULL OR public.fn_current_user_role() IS DISTINCT FROM 'GURU'::role_type THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    FOR v_i IN 1..2 LOOP
        IF v_i = 1 THEN
            IF TG_OP = 'INSERT' THEN CONTINUE; END IF;
            v_row := to_jsonb(OLD);
        ELSE
            IF TG_OP = 'DELETE' THEN CONTINUE; END IF;
            v_row := to_jsonb(NEW);
        END IF;
        IF TG_TABLE_NAME IN ('assessment_results', 'assessment_rubric_results') THEN
            SELECT a.school_id, a.class_id, a.academic_year::text AS y, a.semester INTO v_asm FROM public.assessments a WHERE a.id = (v_row->>'assessment_id')::uuid;
            IF NOT FOUND THEN CONTINUE; END IF;
            v_school := v_asm.school_id; v_class := v_asm.class_id; v_year := v_asm.y; v_sem := v_asm.semester;
        ELSE
            v_school := (v_row->>'school_id')::uuid; v_class := (v_row->>'class_id')::uuid; v_year := v_row->>'academic_year'; v_sem := (v_row->>'semester')::integer;
        END IF;
        IF public.fn_grade_period_locked(v_school, v_class, v_year, v_sem) THEN
            RAISE EXCEPTION 'periode_terkunci: semester % tahun ajaran % sudah ditutup; nilai kelas ini tidak dapat diubah. Hubungi Waka Kurikulum atau Kepala Sekolah untuk membuka kunci.', v_sem, v_year
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_grade_period() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_period_assessments ON public.assessments;
CREATE TRIGGER trg_guard_period_assessments BEFORE INSERT OR UPDATE OR DELETE ON public.assessments FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();
DROP TRIGGER IF EXISTS trg_guard_period_assessment_results ON public.assessment_results;
CREATE TRIGGER trg_guard_period_assessment_results BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_results FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();
DROP TRIGGER IF EXISTS trg_guard_period_rubric_results ON public.assessment_rubric_results;
CREATE TRIGGER trg_guard_period_rubric_results BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_rubric_results FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();
DROP TRIGGER IF EXISTS trg_guard_period_grade_recap ON public.grade_recap;
CREATE TRIGGER trg_guard_period_grade_recap BEFORE INSERT OR UPDATE OR DELETE ON public.grade_recap FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();
DROP TRIGGER IF EXISTS trg_guard_period_grade_final ON public.grade_final;
CREATE TRIGGER trg_guard_period_grade_final BEFORE INSERT OR UPDATE OR DELETE ON public.grade_final FOR EACH ROW EXECUTE FUNCTION public.fn_guard_grade_period();

-- Buka kunci satu kelas (Kepala Sekolah atau Waka Kurikulum), dengan alasan tertulis.
CREATE OR REPLACE FUNCTION public.fn_unlock_grade_period(p_class uuid, p_year text, p_semester integer, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school uuid := public.fn_current_school_id();
    v_id     uuid;
BEGIN
    IF NOT (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()) THEN
        RAISE EXCEPTION 'akses ditolak: hanya Kepala Sekolah atau Waka Kurikulum yang dapat membuka kunci nilai' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'alasan pembukaan kunci wajib diisi (minimal 10 karakter)' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.class_id = p_class AND c.school_id = v_school) THEN
        RAISE EXCEPTION 'kelas tidak ditemukan di sekolah ini' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.academic_periods p WHERE p.school_id = v_school AND p.academic_year = p_year AND p.semester::text = p_semester::text AND p.status = 'CLOSED') THEN
        RAISE EXCEPTION 'periode itu belum ditutup; tidak ada kunci yang perlu dibuka' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.grade_period_unlocks u WHERE u.school_id = v_school AND u.class_id = p_class AND u.academic_year = p_year AND u.semester = p_semester AND u.relocked_at IS NULL) THEN
        RAISE EXCEPTION 'kunci kelas ini sudah terbuka' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.grade_period_unlocks (school_id, class_id, academic_year, semester, reason, unlocked_by)
    VALUES (v_school, p_class, p_year, p_semester, btrim(p_reason), public.fn_current_user_id())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

-- Kunci kembali kelas yang tadinya dibuka.
CREATE OR REPLACE FUNCTION public.fn_relock_grade_period(p_class uuid, p_year text, p_semester integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_n integer;
BEGIN
    IF NOT (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()) THEN
        RAISE EXCEPTION 'akses ditolak: hanya Kepala Sekolah atau Waka Kurikulum yang dapat mengunci nilai' USING ERRCODE = '42501';
    END IF;
    UPDATE public.grade_period_unlocks
       SET relocked_at = now(), relocked_by = public.fn_current_user_id()
     WHERE school_id = public.fn_current_school_id() AND class_id = p_class AND academic_year = p_year AND semester = p_semester AND relocked_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_unlock_grade_period(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unlock_grade_period(uuid, text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_relock_grade_period(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_relock_grade_period(uuid, text, integer) TO authenticated, service_role;

-- Status kunci satu kelas pada satu periode, untuk layar Kepala Sekolah / Waka Kurikulum.
CREATE OR REPLACE FUNCTION public.fn_get_grade_period_status(p_class uuid, p_year text, p_semester integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school uuid := public.fn_current_school_id();
    v_closed boolean;
    v_unlock record;
BEGIN
    IF NOT (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()) THEN
        RAISE EXCEPTION 'akses ditolak: hanya Kepala Sekolah atau Waka Kurikulum' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.class_id = p_class AND c.school_id = v_school) THEN
        RAISE EXCEPTION 'kelas tidak ditemukan di sekolah ini' USING ERRCODE = 'P0001';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.academic_periods p
                   WHERE p.school_id = v_school AND p.academic_year = p_year AND p.semester::text = p_semester::text AND p.status = 'CLOSED') INTO v_closed;
    SELECT u.reason, u.unlocked_at, us.full_name AS oleh INTO v_unlock
      FROM public.grade_period_unlocks u LEFT JOIN public.users us ON us.user_id = u.unlocked_by
     WHERE u.school_id = v_school AND u.class_id = p_class AND u.academic_year = p_year AND u.semester = p_semester AND u.relocked_at IS NULL;
    RETURN jsonb_build_object('closed', v_closed, 'unlocked', FOUND, 'reason', v_unlock.reason, 'unlocked_at', v_unlock.unlocked_at, 'unlocked_by_name', v_unlock.oleh);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_get_grade_period_status(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_grade_period_status(uuid, text, integer) TO authenticated, service_role;
