-- Keputusan Romo (18 Okt 2026), butir sisa audit Forum:
--  A-04 / B-01  daftar penerima PRIVAT. Sebelumnya setiap penerima dapat membaca SELURUH baris forum_post_audience posting yang dibacanya (terukur: guru dan siswa penerima
--               membaca 2 dari 2 baris), sehingga sesama penerima saling tahu (mis. surat peringatan alpa ke tiga orang tua: orang tua pertama dapat melihat dua penerima lain).
--               Kini penerima hanya melihat BARIS DIRINYA SENDIRI; penulis melihat semuanya.
--  Konfirmasi baca (forum_post_acknowledgements) membuka sebagian daftar penerima (siapa yang sudah membaca), jadi diperlakukan sama: penerima hanya melihat konfirmasinya sendiri,
--               penulis melihat semuanya. Jumlah "dibaca" di kartu hanya ditampilkan pada tab Terkirim (penulis).
--  B-05         komentar yang ditulis PENULIS posting (pembaruan resmi dari penulis) memberi tahu SEMUA penerima; komentar dari peserta lain tetap hanya memberi tahu penulis, yang
--               sudah membaca, dan komentator sebelumnya (anti-spam).

DROP POLICY IF EXISTS rls_forum_aud_read ON public.forum_post_audience;
CREATE POLICY rls_forum_aud_own_read ON public.forum_post_audience FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND user_id = public.fn_current_user_id()
           AND public.fn_can_read_forum_post(post_id));

DROP POLICY IF EXISTS rls_forum_ack_read ON public.forum_post_acknowledgements;
CREATE POLICY rls_forum_ack_own_read ON public.forum_post_acknowledgements FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND user_id = public.fn_current_user_id());
CREATE POLICY rls_forum_ack_author_read ON public.forum_post_acknowledgements FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id()
           AND EXISTS (SELECT 1 FROM public.forum_posts fp
                       WHERE fp.post_id = forum_post_acknowledgements.post_id
                         AND fp.author_user_id = public.fn_current_user_id()
                         AND fp.school_id = public.fn_current_school_id()));

CREATE OR REPLACE FUNCTION public.fn_notify_on_forum_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_post           forum_posts%ROWTYPE;
    v_commenter_name TEXT;
    v_oleh_penulis   boolean;
BEGIN
    SELECT * INTO v_post
    FROM   forum_posts WHERE post_id = NEW.post_id;

    SELECT full_name INTO v_commenter_name
    FROM   users WHERE user_id = NEW.author_user_id;

    v_oleh_penulis := (NEW.author_user_id = v_post.author_user_id);

    INSERT INTO notifications (
        school_id, recipient_user_id,
        forum_post_id, forum_comment_id,
        type, title, body
    )
    SELECT DISTINCT
        NEW.school_id,
        target.user_id,
        NEW.post_id,
        NEW.comment_id,
        'FORUM_COMMENT_NEW',
        format('Komentar baru: %s', v_post.title),
        CASE WHEN v_oleh_penulis
             THEN format('%s (penulis) menambahkan komentar pada posting yang Anda terima.', coalesce(v_commenter_name, 'Penulis'))
             ELSE format('%s mengomentari posting yang Anda ikuti.', coalesce(v_commenter_name, 'Seseorang'))
        END
    FROM (
        -- Kelompok 1: penulis posting induk
        SELECT v_post.author_user_id AS user_id

        UNION

        -- Kelompok 2: semua yang sudah beri acknowledgement
        SELECT fpa.user_id
        FROM   forum_post_acknowledgements fpa
        WHERE  fpa.post_id   = NEW.post_id
          AND  fpa.school_id = NEW.school_id

        UNION

        -- Kelompok 3: komentator sebelumnya di posting ini
        SELECT fpc.author_user_id
        FROM   forum_post_comments fpc
        WHERE  fpc.post_id    = NEW.post_id
          AND  fpc.school_id  = NEW.school_id
          AND  fpc.comment_id != NEW.comment_id

        UNION

        -- Kelompok 4 (B-05): bila yang berkomentar adalah PENULIS posting, seluruh penerima aktif diberi tahu
        SELECT a.user_id
        FROM   forum_post_audience a
        JOIN   users u ON u.user_id = a.user_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
        WHERE  v_oleh_penulis
          AND  a.post_id   = NEW.post_id
          AND  a.school_id = NEW.school_id
    ) AS target
    WHERE target.user_id != NEW.author_user_id;

    RETURN NEW;
END;
$function$;
