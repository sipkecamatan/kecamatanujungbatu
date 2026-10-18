-- Keputusan Romo (18 Okt 2026): fitur "tarik posting" PERLU ADA (sebelumnya diusulkan dipensiunkan). Fungsi server fn_toggle_forum_post_withdrawn ada, tetapi tak ada tombolnya di layar
-- dan aturannya tidak sejalan dengan aturan baca baru (hanya penulis dan penerima): pemulihan hanya untuk moderator yang tak bisa lagi membaca posting yang ditarik.
--
-- Semantik yang diterapkan:
--   * Posting yang ditarik HILANG dari semua penerima (tidak dapat dibaca, dikomentari, atau dibuka lampirannya) tetapi tetap terlihat oleh PENULIS (bertanda "Ditarik").
--   * Penulis dapat menarik dan memulihkan postingnya sendiri.
--   * Moderator (Kepsek, Waka Kesiswaan, admin) yang MENJADI PENERIMA posting dapat menarik dan memulihkan, dan tetap dapat membaca posting yang ditarik.
--   * Penerima biasa dan orang lain tidak dapat menarik/memulihkan apa pun (42501).

CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id     uuid := fn_current_user_id();
    v_author_id     uuid;
    v_is_withdrawn  boolean;
    v_class_id      uuid;
    v_academic_year text;
    v_school_id     uuid;
    v_is_student    boolean;
BEGIN
    IF v_caller_id IS NULL THEN RETURN false; END IF;

    SELECT fp.author_user_id, fp.is_withdrawn, fp.class_id, fp.academic_year, fp.school_id
    INTO   v_author_id, v_is_withdrawn, v_class_id, v_academic_year, v_school_id
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- Penulis selalu dapat membaca postingnya sendiri (juga yang ditarik).
    IF v_author_id = v_caller_id THEN RETURN true; END IF;

    -- Hanya penerima (baris forum_post_audience) yang masih aktif.
    IF NOT EXISTS (
        SELECT 1
        FROM   public.forum_post_audience fpa
        JOIN   public.users u ON u.user_id = fpa.user_id
        WHERE  fpa.post_id   = p_post_id
          AND  fpa.user_id   = v_caller_id
          AND  u.is_active   = true
          AND  u.deleted_at IS NULL
    ) THEN
        RETURN false;
    END IF;

    -- Posting yang ditarik: hanya moderator penerima yang masih dapat membacanya.
    IF v_is_withdrawn THEN
        RETURN EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.user_id = v_caller_id AND u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
              AND (u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE') OR u.is_kepsek = true OR u.is_waka_kesiswaan = true)
        );
    END IF;

    -- Penjagaan siswa: harus siswa aktif/PKL; pada posting kelas, harus masih terdaftar aktif di kelas itu.
    SELECT EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = v_caller_id AND s.school_id = v_school_id)
    INTO v_is_student;

    IF v_is_student THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.user_id = v_caller_id AND s.school_id = v_school_id AND s.student_status IN ('AKTIF', 'PKL')
        ) THEN
            RETURN false;
        END IF;

        IF v_class_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM   public.students s
            JOIN   public.class_enrollments ce ON ce.student_id = s.student_id
            WHERE  s.user_id        = v_caller_id
              AND  s.school_id      = v_school_id
              AND  ce.class_id      = v_class_id
              AND  ce.academic_year = v_academic_year
              AND  ce.school_id     = v_school_id
              AND  ce.withdrawn_at IS NULL
        ) THEN
            RETURN false;
        END IF;
    END IF;

    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_toggle_forum_post_withdrawn(p_post_id uuid, p_withdrawn boolean)
 RETURNS TABLE(post_id uuid, is_withdrawn boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id  uuid := public.fn_current_user_id();
    v_author_id  uuid;
    v_moderator  boolean := false;
BEGIN
    IF p_post_id IS NULL OR p_withdrawn IS NULL THEN
        RAISE EXCEPTION 'post_id dan status withdrawn wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    SELECT fp.author_user_id
    INTO v_author_id
    FROM public.forum_posts fp
    WHERE fp.post_id = p_post_id
      AND fp.school_id = public.fn_current_school_id()
      AND fp.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id = v_caller_id
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    -- Penulis boleh menarik dan memulihkan miliknya. Moderator hanya bila ia penerima posting (fn_can_read_forum_post meliputi posting yang ditarik bagi moderator penerima).
    IF v_caller_id IS DISTINCT FROM v_author_id
       AND NOT (v_moderator AND public.fn_can_read_forum_post(p_post_id)) THEN
        RAISE EXCEPTION 'Akses ditolak: hanya penulis, atau moderator yang menerima posting ini, yang dapat menarik atau memulihkan posting.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.forum_posts fp
    SET is_withdrawn = p_withdrawn,
        updated_at = now()
    WHERE fp.post_id = p_post_id
      AND fp.school_id = public.fn_current_school_id()
      AND fp.deleted_at IS NULL
    RETURNING fp.post_id, fp.is_withdrawn;
END;
$function$;
