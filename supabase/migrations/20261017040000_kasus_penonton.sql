-- Kasus pembinaan: daftar penonton (pembaca) yang ditentukan pembuat kasus.
--
-- Rancangan (Romo, 17 Okt 2026):
--   * Pembuat kasus menentukan siapa yang boleh membaca kasus (staf mana pun di sekolah, orang tua siswa, siswa itu
--     sendiri), atau memilih "hanya saya".
--   * Penangan sekarang dan penangan sebelumnya selalu melihat; Waka Kesiswaan dan Kepala Sekolah selalu melihat
--     (pengawasan). Pembukaan oleh pengawas yang bukan pembuat/penangan/penonton dicatat di log akses kasus.
--   * Wali kelas, guru wali, BK kelas, dan siapa pun hanya melihat bila ditandai oleh pembuat (atau penangan menambah).
--     Penonton hanya membaca. Orang yang ditandai mendapat notifikasi singkat TANPA isi kasus.
--   * Admin sekolah (ADMINISTRATIVE) tidak lagi membaca isi kasus. Fungsi khusus admin memberi hitungan dan log aktivitas
--     tanpa judul/isi, dan penghapusan kasus tetap lewat fn_admin_delete_coaching_case.
--   * Orang tua/siswa yang ditandai membaca kasus, tetapi event hanya yang is_visible_to_student = true.

-- ── 1. Tabel penonton dan log akses ───────────────────────────
CREATE TABLE IF NOT EXISTS public.coaching_case_viewers (
    viewer_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id            uuid NOT NULL REFERENCES public.coaching_cases(case_id) ON DELETE CASCADE,
    school_id          uuid NOT NULL REFERENCES public.schools(school_id),
    user_id            uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    added_by_user_id   uuid NOT NULL REFERENCES public.users(user_id),
    added_at           timestamptz NOT NULL DEFAULT now(),
    removed_at         timestamptz,
    removed_by_user_id uuid REFERENCES public.users(user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccv_aktif ON public.coaching_case_viewers (case_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ccv_user ON public.coaching_case_viewers (school_id, user_id) WHERE removed_at IS NULL;
ALTER TABLE public.coaching_case_viewers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coaching_case_access_log (
    log_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id   uuid NOT NULL REFERENCES public.coaching_cases(case_id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES public.schools(school_id),
    user_id   uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    reason    text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ccal_case ON public.coaching_case_access_log (case_id, viewed_at DESC);
ALTER TABLE public.coaching_case_access_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.coaching_case_viewers   FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.coaching_case_access_log FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.coaching_case_viewers TO authenticated;
GRANT ALL    ON TABLE public.coaching_case_viewers TO service_role;
GRANT ALL    ON TABLE public.coaching_case_access_log TO service_role;

-- Jenis notifikasi baru untuk orang yang ditandai.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY[
    'ESCALATION_DM'::text, 'CASE_BROADCAST'::text, 'LOGIN_NEW_DEVICE'::text, 'OBSERVATION_NEW'::text,
    'CASE_RESTRICTED_NEW'::text, 'CASE_STUDENT_UPDATE'::text, 'FORUM_POST_NEW'::text, 'FORUM_COMMENT_NEW'::text,
    'PERANGKAT_AJAR'::text, 'LATE_ARRIVAL'::text, 'EXIT_NOTIFICATION'::text, 'CASE_TAGGED'::text])));

-- ── 2. Fungsi pembantu ────────────────────────────────────────
-- Pembuat atau salah satu penangan (sekarang maupun sebelumnya): boleh melihat daftar penonton dan log akses.
CREATE OR REPLACE FUNCTION public.fn_case_is_creator_or_handler(p_case_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.coaching_cases c
        WHERE c.case_id = p_case_id
          AND c.school_id = public.fn_current_school_id()
          AND (
              c.created_by_user_id = public.fn_current_user_id()
              OR EXISTS (
                  SELECT 1 FROM public.coaching_case_handlers h
                  WHERE h.case_id = p_case_id AND h.handler_user_id = public.fn_current_user_id()
              )
          )
    );
$function$;

-- Pembuat atau penangan SEKARANG: boleh menambah penonton.
CREATE OR REPLACE FUNCTION public.fn_case_can_add_viewers(p_case_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.coaching_cases c
        WHERE c.case_id = p_case_id
          AND c.school_id = public.fn_current_school_id()
          AND (c.created_by_user_id = public.fn_current_user_id()
               OR c.current_handler_user_id = public.fn_current_user_id())
    );
$function$;

-- Aturan keterlihatan kasus bagi staf (menggantikan versi lama yang juga memasukkan ADMINISTRATIVE).
CREATE OR REPLACE FUNCTION public.fn_can_see_coaching_case(p_case_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.coaching_cases c
        WHERE c.case_id = p_case_id
          AND c.school_id = public.fn_current_school_id()
          AND (
              c.created_by_user_id = public.fn_current_user_id()
              OR EXISTS (
                  SELECT 1 FROM public.coaching_case_handlers h
                  WHERE h.case_id = p_case_id AND h.handler_user_id = public.fn_current_user_id()
              )
              OR public.fn_is_kepsek()
              OR public.fn_is_waka_kesiswaan()
              OR EXISTS (
                  SELECT 1 FROM public.coaching_case_viewers v
                  WHERE v.case_id = p_case_id
                    AND v.user_id = public.fn_current_user_id()
                    AND v.removed_at IS NULL
              )
          )
    );
$function$;

-- ── 3. Kebijakan baca ─────────────────────────────────────────
-- Daftar penonton: diri sendiri, pembuat/penangan, dan pengawas (Waka Kesiswaan, Kepala Sekolah).
CREATE POLICY rls_ccv_read ON public.coaching_case_viewers AS PERMISSIVE FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND (user_id = public.fn_current_user_id()
                OR public.fn_case_is_creator_or_handler(case_id)
                OR public.fn_is_kepsek() OR public.fn_is_waka_kesiswaan()));

-- Orang tua / siswa yang ditandai: membaca kasus dan HANYA event yang ditandai terlihat.
CREATE POLICY rls_cc_read_viewer_nonstaff ON public.coaching_cases AS PERMISSIVE FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND public.fn_current_user_role() IN ('ORTU'::role_type, 'SISWA'::role_type)
           AND EXISTS (SELECT 1 FROM public.coaching_case_viewers v
                       WHERE v.case_id = coaching_cases.case_id
                         AND v.user_id = public.fn_current_user_id()
                         AND v.removed_at IS NULL));
CREATE POLICY rls_cce_read_viewer_nonstaff ON public.coaching_case_events AS PERMISSIVE FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND public.fn_current_user_role() IN ('ORTU'::role_type, 'SISWA'::role_type)
           AND is_visible_to_student = true
           AND EXISTS (SELECT 1 FROM public.coaching_case_viewers v
                       WHERE v.case_id = coaching_case_events.case_id
                         AND v.user_id = public.fn_current_user_id()
                         AND v.removed_at IS NULL));

-- ── 4. Menambah dan mencabut penonton ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_case_add_viewer(p_case_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_me        uuid := public.fn_current_user_id();
    v_case      public.coaching_cases%ROWTYPE;
    v_target    public.users%ROWTYPE;
    v_student   text;
    v_rows      integer;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'permission_denied: tidak ada sesi pengguna' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_case FROM public.coaching_cases
    WHERE case_id = p_case_id AND school_id = public.fn_current_school_id();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan' USING ERRCODE = 'P0004';
    END IF;

    IF NOT (v_case.created_by_user_id = v_me OR v_case.current_handler_user_id = v_me) THEN
        RAISE EXCEPTION 'permission_denied: hanya pembuat atau penangan yang boleh menambah pembaca'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target FROM public.users
    WHERE user_id = p_user_id AND school_id = v_case.school_id AND is_active IS TRUE AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'validation_error: pengguna tidak ditemukan di sekolah ini' USING ERRCODE = 'P0001';
    END IF;

    -- Pembuat dan penangan sekarang sudah punya akses.
    IF v_target.user_id IN (v_case.created_by_user_id, v_case.current_handler_user_id) THEN
        RETURN jsonb_build_object('ok', true, 'sudah_punya_akses', true);
    END IF;

    -- Peran yang boleh menjadi pembaca: staf internal, orang tua siswa ini, atau siswa ini sendiri.
    IF v_target.role_type IN ('GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type,
                              'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type,
                              'WAKA_HUMAS'::role_type) THEN
        NULL;
    ELSIF v_target.role_type = 'ORTU'::role_type AND EXISTS (
        SELECT 1 FROM public.student_parents sp
        WHERE sp.student_id = v_case.student_id AND sp.parent_user_id = v_target.user_id) THEN
        NULL;
    ELSIF v_target.role_type = 'SISWA'::role_type AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.student_id = v_case.student_id AND s.user_id = v_target.user_id) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'validation_error: peran pengguna ini tidak boleh menjadi pembaca kasus' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.coaching_case_viewers (case_id, school_id, user_id, added_by_user_id)
    VALUES (p_case_id, v_case.school_id, p_user_id, v_me)
    ON CONFLICT (case_id, user_id) WHERE removed_at IS NULL DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 1 THEN
        SELECT full_name INTO v_student FROM public.students WHERE student_id = v_case.student_id;
        INSERT INTO public.notifications (school_id, recipient_user_id, case_id, type, title, body)
        VALUES (
            v_case.school_id, p_user_id, p_case_id, 'CASE_TAGGED',
            CASE WHEN v_target.role_type IN ('ORTU'::role_type, 'SISWA'::role_type)
                 THEN 'Ada kasus yang dibagikan kepada Anda'
                 ELSE 'Anda disebut dalam sebuah kasus' END,
            CASE WHEN v_target.role_type IN ('ORTU'::role_type, 'SISWA'::role_type)
                 THEN format('Sekolah membagikan perkembangan kasus tentang %s.', coalesce(v_student, 'siswa'))
                 ELSE format('Anda ditambahkan sebagai pembaca kasus tentang %s. Buka tab Pembinaan Siswa untuk melihatnya.', coalesce(v_student, 'siswa')) END
        );
    END IF;

    RETURN jsonb_build_object('ok', true, 'ditambahkan', v_rows = 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_case_remove_viewer(p_case_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_me   uuid := public.fn_current_user_id();
    v_rows integer;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'permission_denied: tidak ada sesi pengguna' USING ERRCODE = '42501';
    END IF;
    -- Hanya PEMBUAT yang boleh mencabut pembaca.
    IF NOT EXISTS (SELECT 1 FROM public.coaching_cases c
                   WHERE c.case_id = p_case_id AND c.school_id = public.fn_current_school_id()
                     AND c.created_by_user_id = v_me) THEN
        RAISE EXCEPTION 'permission_denied: hanya pembuat kasus yang boleh mencabut pembaca' USING ERRCODE = '42501';
    END IF;
    UPDATE public.coaching_case_viewers
    SET removed_at = now(), removed_by_user_id = v_me
    WHERE case_id = p_case_id AND user_id = p_user_id AND removed_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'dicabut', v_rows);
END;
$function$;

-- ── 5. Membaca daftar penonton, kandidat tanda, dan log akses ──
CREATE OR REPLACE FUNCTION public.fn_case_list_viewers(p_case_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role_type public.role_type, added_at timestamptz, added_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.fn_case_is_creator_or_handler(p_case_id) OR public.fn_is_kepsek() OR public.fn_is_waka_kesiswaan()) THEN
        RAISE EXCEPTION 'permission_denied: tidak berwenang melihat daftar pembaca' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT v.user_id, u.full_name::text, u.role_type, v.added_at, a.full_name::text
    FROM public.coaching_case_viewers v
    JOIN public.users u ON u.user_id = v.user_id
    JOIN public.users a ON a.user_id = v.added_by_user_id
    WHERE v.case_id = p_case_id AND v.removed_at IS NULL AND v.school_id = public.fn_current_school_id()
    ORDER BY v.added_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_case_tag_candidates(p_case_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role_type public.role_type, relation_label text, priority integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_case       public.coaching_cases%ROWTYPE;
    v_year       varchar(9);
    v_sem        public.semester;
    v_class      uuid;
    v_program    uuid;
BEGIN
    IF NOT public.fn_case_can_add_viewers(p_case_id) THEN
        RAISE EXCEPTION 'permission_denied: hanya pembuat atau penangan yang boleh menandai' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_case FROM public.coaching_cases WHERE case_id = p_case_id;
    SELECT sc.current_academic_year, sc.current_semester INTO v_year, v_sem
    FROM public.school_config sc WHERE sc.school_id = v_case.school_id LIMIT 1;
    SELECT ce.class_id INTO v_class FROM public.class_enrollments ce
    WHERE ce.student_id = v_case.student_id AND ce.academic_year = v_year AND ce.semester = v_sem
      AND ce.withdrawn_at IS NULL LIMIT 1;
    SELECT s.program_id INTO v_program FROM public.students s WHERE s.student_id = v_case.student_id;

    RETURN QUERY
    WITH kandidat AS (
        -- 1. Wali kelas siswa
        SELECT u.user_id AS uid, u.full_name::text AS nama, u.role_type AS peran, 'Wali Kelas'::text AS label, 1 AS prio
        FROM public.users u
        WHERE u.school_id = v_case.school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND v_class IS NOT NULL AND u.wali_kelas_class_id = v_class
        UNION ALL
        -- 2. Guru wali siswa (penugasan aktif)
        SELECT u.user_id, u.full_name::text, u.role_type, 'Guru Wali'::text, 2
        FROM public.guru_wali_assignments gwa
        JOIN public.users u ON u.user_id = gwa.guru_user_id
        WHERE gwa.school_id = v_case.school_id AND gwa.student_id = v_case.student_id AND gwa.is_active IS TRUE
          AND gwa.academic_year = v_year AND u.is_active IS TRUE AND u.deleted_at IS NULL
        UNION ALL
        -- 3. BK yang ditugaskan ke kelas siswa
        SELECT u.user_id, u.full_name::text, u.role_type, 'Guru BK'::text, 3
        FROM public.bk_class_assignments b
        JOIN public.users u ON u.user_id = b.bk_user_id
        WHERE b.school_id = v_case.school_id AND v_class IS NOT NULL AND b.class_id = v_class AND b.is_active IS TRUE
          AND b.academic_year = v_year AND u.is_active IS TRUE AND u.deleted_at IS NULL
        UNION ALL
        -- 4. Kaprodi program siswa
        SELECT u.user_id, u.full_name::text, u.role_type, 'Kaprodi'::text, 4
        FROM public.users u
        WHERE u.school_id = v_case.school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND v_program IS NOT NULL AND u.kaprodi_program_id = v_program
        UNION ALL
        -- 5. Orang tua siswa
        SELECT u.user_id, u.full_name::text, u.role_type, 'Orang tua'::text, 5
        FROM public.student_parents sp
        JOIN public.users u ON u.user_id = sp.parent_user_id
        WHERE sp.student_id = v_case.student_id AND u.school_id = v_case.school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
        UNION ALL
        -- 6. Siswa itu sendiri
        SELECT u.user_id, u.full_name::text, u.role_type, 'Siswa'::text, 6
        FROM public.students s
        JOIN public.users u ON u.user_id = s.user_id
        WHERE s.student_id = v_case.student_id AND u.school_id = v_case.school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
        UNION ALL
        -- 7. Staf internal lain di sekolah
        SELECT u.user_id, u.full_name::text, u.role_type, 'Staf lain'::text, 7
        FROM public.users u
        WHERE u.school_id = v_case.school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND u.role_type IN ('GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type,
                              'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type,
                              'KEPSEK'::role_type)
    ),
    terbaik AS (
        SELECT DISTINCT ON (k.uid) k.uid, k.nama, k.peran, k.label, k.prio
        FROM kandidat k
        ORDER BY k.uid, k.prio
    )
    SELECT t.uid, t.nama, t.peran, t.label, t.prio
    FROM terbaik t
    WHERE t.uid NOT IN (v_case.created_by_user_id, v_case.current_handler_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.coaching_case_viewers v
                      WHERE v.case_id = p_case_id AND v.user_id = t.uid AND v.removed_at IS NULL)
    ORDER BY t.prio, t.nama;
END;
$function$;

-- Pengawas (Waka Kesiswaan / Kepala Sekolah) yang membuka kasus bukan miliknya dicatat. Dipanggil oleh klien saat kasus dibuka.
CREATE OR REPLACE FUNCTION public.fn_case_log_oversight_view(p_case_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_me     uuid := public.fn_current_user_id();
    v_school uuid := public.fn_current_school_id();
BEGIN
    IF v_me IS NULL OR NOT (public.fn_is_kepsek() OR public.fn_is_waka_kesiswaan()) THEN
        RETURN false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.coaching_cases c WHERE c.case_id = p_case_id AND c.school_id = v_school) THEN
        RETURN false;
    END IF;
    -- Hanya dicatat bila pengawas bukan pembuat/penangan/penonton (akses karena jabatan).
    IF public.fn_case_is_creator_or_handler(p_case_id)
       OR EXISTS (SELECT 1 FROM public.coaching_case_viewers v
                  WHERE v.case_id = p_case_id AND v.user_id = v_me AND v.removed_at IS NULL) THEN
        RETURN false;
    END IF;
    -- Satu catatan per pengawas per kasus per jam.
    IF EXISTS (SELECT 1 FROM public.coaching_case_access_log l
               WHERE l.case_id = p_case_id AND l.user_id = v_me AND l.viewed_at > now() - interval '1 hour') THEN
        RETURN false;
    END IF;
    INSERT INTO public.coaching_case_access_log (case_id, school_id, user_id, reason)
    VALUES (p_case_id, v_school, v_me, 'PENGAWASAN');
    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_case_list_access_log(p_case_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role_type public.role_type, viewed_at timestamptz, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.fn_case_is_creator_or_handler(p_case_id) OR public.fn_is_kepsek() OR public.fn_is_waka_kesiswaan()) THEN
        RAISE EXCEPTION 'permission_denied: tidak berwenang melihat log akses' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT l.user_id, u.full_name::text, u.role_type, l.viewed_at, l.reason
    FROM public.coaching_case_access_log l
    JOIN public.users u ON u.user_id = l.user_id
    WHERE l.case_id = p_case_id AND l.school_id = public.fn_current_school_id()
    ORDER BY l.viewed_at DESC
    LIMIT 100;
END;
$function$;

-- ── 6. Fungsi khusus admin sekolah (tanpa judul/isi kasus) ─────
CREATE OR REPLACE FUNCTION public.fn_admin_case_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school uuid := public.fn_current_school_id();
BEGIN
    IF public.fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type OR v_school IS NULL THEN
        RAISE EXCEPTION 'permission_denied: hanya admin sekolah' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'total', (SELECT count(*) FROM public.coaching_cases WHERE school_id = v_school),
        'open',  (SELECT count(*) FROM public.coaching_cases WHERE school_id = v_school AND status <> 'CLOSED'::case_status)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_case_activity(p_limit integer DEFAULT 50)
 RETURNS TABLE(event_type text, created_at timestamptz, student_name text, author_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school uuid := public.fn_current_school_id();
BEGIN
    IF public.fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type OR v_school IS NULL THEN
        RAISE EXCEPTION 'permission_denied: hanya admin sekolah' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT e.event_type::text, e.created_at, s.full_name::text, a.full_name::text
    FROM public.coaching_case_events e
    JOIN public.coaching_cases c ON c.case_id = e.case_id
    JOIN public.students s ON s.student_id = c.student_id
    JOIN public.users a ON a.user_id = e.author_user_id
    WHERE e.school_id = v_school
    ORDER BY e.created_at DESC
    LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$function$;

-- Hitungan kasus untuk pemeriksaan "data terkait" di portal admin (hapus siswa, hapus massal wizard): admin tidak lagi
-- membaca baris kasus, jadi hitungan memakai fungsi ini. p_student_ids NULL = seluruh kasus sekolah.
CREATE OR REPLACE FUNCTION public.fn_admin_case_count_for_students(p_student_ids uuid[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school uuid := public.fn_current_school_id();
BEGIN
    IF public.fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type OR v_school IS NULL THEN
        RAISE EXCEPTION 'permission_denied: hanya admin sekolah' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT count(*)::integer FROM public.coaching_cases c
            WHERE c.school_id = v_school AND (p_student_ids IS NULL OR c.student_id = ANY(p_student_ids)));
END;
$function$;

-- ── 7. Hak eksekusi fungsi baru ───────────────────────────────
REVOKE ALL ON FUNCTION public.fn_case_is_creator_or_handler(uuid)  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_can_add_viewers(uuid)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_add_viewer(uuid, uuid)       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_remove_viewer(uuid, uuid)    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_list_viewers(uuid)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_tag_candidates(uuid)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_log_oversight_view(uuid)     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_list_access_log(uuid)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_admin_case_counts()               FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_admin_case_activity(integer)      FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_is_creator_or_handler(uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_can_add_viewers(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_add_viewer(uuid, uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_remove_viewer(uuid, uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_list_viewers(uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_tag_candidates(uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_log_oversight_view(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_list_access_log(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_case_counts()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_case_activity(integer)      TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_admin_case_count_for_students(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_case_count_for_students(uuid[]) TO authenticated, service_role;
