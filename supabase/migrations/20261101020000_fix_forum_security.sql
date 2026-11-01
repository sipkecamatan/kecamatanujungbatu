-- Fix dua pelanggaran isolasi tenant yang ditemukan di tenant-isolation.mjs:
--
-- BUG 1: fn_get_all_grades_summary — VOLATILE SECURITY DEFINER dapat dipanggil anon.
--   Root cause: baseline REVOKE memakai signature (uuid, character varying, integer),
--   tapi migration 20261023100000 + 20261023120000 membuat fungsi baru dengan
--   signature (uuid, text, integer). Fungsi baru tidak diwarisi REVOKE lama —
--   PostgreSQL grant EXECUTE ke PUBLIC secara default pada fungsi baru.
--   Fix: REVOKE ulang + GRANT ulang untuk signature text.
--
-- BUG 2: fn_can_read_forum_post — siswa yang withdrawn dari class_enrollments
--   masih bisa membaca forum post berskop KELAS.
--   Root cause: guard hanya cek users.is_active dan users.deleted_at, tidak cek
--   class_enrollments.withdrawn_at untuk posting berskop kelas.
--   Fix: tambahkan join class_enrollments pada cabang EXISTS untuk posting KELAS.

-- ── BUG 1: REVOKE fn_get_all_grades_summary dari anon ────────────────────────
REVOKE ALL ON FUNCTION public.fn_get_all_grades_summary(uuid, text, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, text, integer)
    TO authenticated, service_role;

-- ── BUG 2: fn_can_read_forum_post — tambahkan guard withdrawal untuk SISWA ───
CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id    uuid    := fn_current_user_id();
    v_author_id    uuid;
    v_is_withdrawn boolean;
    v_class_id     uuid;
    v_acad_year    text;
BEGIN
    IF v_caller_id IS NULL THEN RETURN false; END IF;

    SELECT fp.author_user_id, fp.is_withdrawn, fp.class_id, fp.academic_year
    INTO   v_author_id, v_is_withdrawn, v_class_id, v_acad_year
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- Penulis selalu dapat membaca postingnya sendiri.
    IF v_author_id = v_caller_id THEN RETURN true; END IF;

    -- Posting yang ditarik disembunyikan dari penerima.
    IF v_is_withdrawn THEN RETURN false; END IF;

    -- Selain itu: hanya penerima (baris forum_post_audience) yang masih aktif.
    -- Untuk posting berskop kelas, siswa (role SISWA) harus masih terdaftar
    -- di kelas tersebut (class_enrollments.withdrawn_at IS NULL).
    RETURN EXISTS (
        SELECT 1
        FROM   public.forum_post_audience fpa
        JOIN   public.users u
               ON u.user_id    = fpa.user_id
              AND u.is_active  = true
              AND u.deleted_at IS NULL
        -- Jika posting berskop kelas dan caller adalah siswa:
        -- wajib masih aktif di enrollment kelas itu.
        LEFT JOIN public.students stu
               ON stu.user_id = fpa.user_id
              AND u.role_type  = 'SISWA'
        LEFT JOIN public.class_enrollments ce
               ON ce.student_id    = stu.student_id
              AND ce.class_id      = v_class_id
              AND ce.academic_year = v_acad_year
              AND ce.withdrawn_at IS NULL
        WHERE  fpa.post_id  = p_post_id
          AND  fpa.user_id  = v_caller_id
          -- Guard: posting KELAS + role SISWA → harus ada baris enrollment aktif.
          -- Posting bukan KELAS (v_class_id IS NULL) atau bukan SISWA → lewati cek ini.
          AND  (v_class_id  IS NULL
                OR u.role_type <> 'SISWA'
                OR ce.student_id IS NOT DISTINCT FROM stu.student_id)
    );
END;
$function$;
