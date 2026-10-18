-- Keputusan Romo (18 Okt 2026): "tarik posting" SAMA DENGAN "hapus posting"; tidak perlu "pulihkan posting". Migrasi 20261018090000 yang menambah tarik/pulihkan yang dapat
-- dibatalkan digantikan: tombol Tarik/Pulihkan dicabut dari portal guru dan orang tua, dan di server:
--   * fn_toggle_forum_post_withdrawn dihapus (tidak ada lagi jalan untuk menarik sementara);
--   * fn_can_read_forum_post kembali ke aturan sederhana (penulis; penerima aktif; siswa harus aktif dan, pada posting kelas, terdaftar): posting berstatus is_withdrawn
--     (peninggalan fitur lama; tidak ada lagi yang dapat menghasilkannya) hanya terlihat penulis. Cabang moderator-penerima untuk posting ditarik dibuang.
-- Hapus posting (fn_delete_forum_post, permanen) tetap satu-satunya cara menarik posting; moderator hanya dapat menghapus posting yang ditujukan kepadanya.

DROP FUNCTION IF EXISTS public.fn_toggle_forum_post_withdrawn(uuid, boolean);

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

    -- Penulis selalu dapat membaca postingnya sendiri.
    IF v_author_id = v_caller_id THEN RETURN true; END IF;

    -- Posting yang ditarik disembunyikan dari penerima.
    IF v_is_withdrawn THEN RETURN false; END IF;

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
