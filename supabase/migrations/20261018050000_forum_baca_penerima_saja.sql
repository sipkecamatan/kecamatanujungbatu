-- Aturan produk dari Romo (18 Okt 2026):
--  1. Orang tua dan siswa hanya membaca pesan yang DITUJUKAN kepada mereka, baik privat maupun publik.
--  3. Staf menulis dan membaca hanya postingan publik dan postingan yang ditujukan kepada mereka.
-- Keadaan sebelumnya (terukur di basis data live): posting lingkup KELAS (masih dapat dibuat lewat RPC, tidak ada di layar) dibaca berdasarkan PERAN/HUBUNGAN, bukan
-- penerima: guru kelas lain, wali kelas, Kaprodi, Kepsek, Waka Kesiswaan, admin, dan TU membaca posting yang tidak ditujukan kepada mereka; TU juga membaca SEMUA posting
-- lingkup sekolah lewat tiga kebijakan baca khusus; orang tua kelas membaca posting PARENT_VISIBLE berdasarkan hubungan kelas.
-- "Publik" di sistem = posting yang ditujukan ke kelompok (mis. Semua Guru) dan sudah dijabarkan menjadi daftar penerima (forum_post_audience); tidak ada pembaca di luar daftar.
--
-- Perbaikan:
--  (a) fn_can_read_forum_post: penulis, atau penerima aktif (posting ditarik: hanya penulis). Satu aturan untuk semua lingkup. Semua kebijakan baca (posting, penerima,
--      subjek, komentar, konfirmasi baca, lampiran Storage) memakai fungsi ini sehingga ikut berubah.
--  (b) tiga kebijakan baca khusus TU dihapus.
--  (c) fn_delete_forum_post: moderator hanya dapat menghapus posting yang juga dapat ia baca (ditujukan kepadanya); penulis tetap dapat menghapus miliknya.

CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id    uuid := fn_current_user_id();
    v_author_id    uuid;
    v_is_withdrawn boolean;
BEGIN
    IF v_caller_id IS NULL THEN RETURN false; END IF;

    SELECT fp.author_user_id, fp.is_withdrawn
    INTO   v_author_id, v_is_withdrawn
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- Penulis selalu dapat membaca postingnya sendiri.
    IF v_author_id = v_caller_id THEN RETURN true; END IF;

    -- Posting yang ditarik disembunyikan dari penerima.
    IF v_is_withdrawn THEN RETURN false; END IF;

    -- Selain itu: hanya penerima (baris forum_post_audience) yang masih aktif.
    RETURN EXISTS (
        SELECT 1
        FROM   public.forum_post_audience fpa
        JOIN   public.users u ON u.user_id = fpa.user_id
        WHERE  fpa.post_id   = p_post_id
          AND  fpa.user_id   = v_caller_id
          AND  u.is_active   = true
          AND  u.deleted_at IS NULL
    );
END;
$function$;

DROP POLICY IF EXISTS rls_forum_posts_read_tu          ON public.forum_posts;
DROP POLICY IF EXISTS rls_forum_post_audience_read_tu  ON public.forum_post_audience;
DROP POLICY IF EXISTS rls_forum_post_comments_read_tu  ON public.forum_post_comments;

CREATE OR REPLACE FUNCTION public.fn_delete_forum_post(p_post_id uuid)
 RETURNS TABLE(deleted_post_id uuid, attachment_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller    uuid := public.fn_current_user_id();
    v_school    uuid := public.fn_current_school_id();
    v_author    uuid;
    v_path      text;
    v_moderator boolean := false;
BEGIN
    IF p_post_id IS NULL THEN
        RAISE EXCEPTION 'post_id wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    -- Tenant-safe: posting di luar sekolah caller dianggap tidak ada.
    SELECT fp.author_user_id, fp.attachment_path
    INTO   v_author, v_path
    FROM   public.forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = v_school;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id    = v_caller
          AND u.school_id  = v_school
          AND u.is_active  = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    -- Penulis boleh menghapus miliknya. Moderator hanya posting yang juga dapat ia baca (ditujukan kepadanya):
    -- moderasi atas pesan yang tidak boleh ia lihat tidak bermakna dan melanggar aturan baca forum.
    -- v_caller NULL (tidak terautentikasi) selalu jatuh ke cabang tolak: NULL IS DISTINCT FROM <apapun> bernilai true.
    IF v_caller IS DISTINCT FROM v_author
       AND NOT (v_moderator AND public.fn_can_read_forum_post(p_post_id)) THEN
        RAISE EXCEPTION 'Akses ditolak: hanya penulis, atau moderator yang menerima posting ini, yang dapat menghapus posting.'
            USING ERRCODE = '42501';
    END IF;

    -- Notifikasi dibersihkan lebih dulu. FK-nya ON DELETE SET NULL,
    -- jadi tanpa baris ini notifikasinya bertahan sebagai rujukan kosong.
    DELETE FROM public.notifications
    WHERE forum_post_id = p_post_id
      AND school_id     = v_school;

    -- Tabel anak (audience, comments, acknowledgements, subjects)
    -- ikut terhapus lewat ON DELETE CASCADE.
    DELETE FROM public.forum_posts
    WHERE post_id   = p_post_id
      AND school_id = v_school;

    RETURN QUERY SELECT p_post_id, v_path;
END;
$function$;
