-- Dua keputusan Romo 18 Okt 2026 setelah uji nyata Forum.
-- (1) LAMPIRAN TERTUTUP: Kepala Sekolah, Waka Kesiswaan, dan admin sekolah sebelumnya dapat MEMBACA semua lampiran sekolah (fn_forum_attachment_moderator pada kebijakan baca),
--     termasuk lampiran posting privat yang tidak ditujukan kepada mereka. Kini lampiran hanya dibaca penulis (pemilik berkas) dan penerima posting
--     (fn_forum_attachment_readable). Moderator (Kepsek, Waka Kesiswaan) hanya menghapus lampiran posting yang dapat ia baca. Karena klien menghapus berkas SESUDAH posting terhapus
--     (saat itu berkas tidak lagi terbaca moderator), fn_delete_forum_post mengalihkan pemilik berkas kepada penghapus tepat sebelum posting dihapus.
-- (2) ADMIN SEKOLAH KELUAR DARI FORUM: konsol admin tidak punya layar Forum, tetapi akun admin masih menjadi pilihan penerima ("TU / Admin"), menerima notifikasi yang
--     tidak dapat dibuka, dan terdaftar sebagai moderator. Kini admin tidak dapat menulis, menjadi penerima, atau memoderasi. Peran TU tetap penuh. Panel "Penugasan Forum"
--     di konsol admin (fn_get_forum_bk_staff) tidak berubah karena itu pengaturan, bukan Forum.
-- Penggantian fungsi memakai teks definisi yang sungguh terpasang dan GAGAL KERAS bila jumlah kemunculan tidak sesuai.

CREATE OR REPLACE FUNCTION pg_temp.ganti_fungsi(p_nama text, p_pola text, p_baru text, p_jumlah integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
AS $f$
DECLARE
    v_oid oid;
    v_def text;
    v_n   integer;
BEGIN
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = p_nama;
    v_def := pg_get_functiondef(v_oid);
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, p_pola, 'g');
    IF v_n <> p_jumlah THEN
        RAISE EXCEPTION 'penggantian % gagal: pola % ditemukan % kali (harap %)', p_nama, p_pola, v_n, p_jumlah;
    END IF;
    EXECUTE regexp_replace(v_def, p_pola, p_baru, 'g');
END
$f$;

-- ── Bagian 2: admin sekolah keluar dari Forum ──────────────────────────────
-- 2a. Kandidat penerima kelompok TU hanya peran TU; admin bukan lagi staf Forum
SELECT pg_temp.ganti_fungsi('fn_get_forum_recipient_candidates_semua', '''KEPSEK'', ''TU'', ''ADMINISTRATIVE''', '''KEPSEK'', ''TU''');
SELECT pg_temp.ganti_fungsi('fn_get_forum_recipient_candidates_semua', 'u\.role_type IN \(''TU'',''ADMINISTRATIVE''\)', 'u.role_type = ''TU''');
-- 2b. Membuat posting: admin bukan penulis dan bukan penerima yang sah (server menolak walau klien lama mengirimnya)
SELECT pg_temp.ganti_fungsi('fn_create_forum_post', '''KEPSEK'', ''TU'', ''ADMINISTRATIVE'', ''ORTU''', '''KEPSEK'', ''TU'', ''ORTU''');
SELECT pg_temp.ganti_fungsi('fn_create_forum_post', '''TU'', ''ADMINISTRATIVE'',(\s+)''SISWA''', '''TU'',\1''SISWA''');
-- 2c. Moderasi hapus posting dan daftar anggota forum: hanya Kepsek dan Waka Kesiswaan
SELECT pg_temp.ganti_fungsi('fn_delete_forum_post', 'IN \(''KEPSEK'', ''WAKA_KESISWAAN'', ''ADMINISTRATIVE''\)', 'IN (''KEPSEK'', ''WAKA_KESISWAAN'')');
SELECT pg_temp.ganti_fungsi('fn_get_forum_members', 'IN \(''WAKA_KESISWAAN'', ''KEPSEK'', ''ADMINISTRATIVE''\)', 'IN (''WAKA_KESISWAAN'', ''KEPSEK'')');
SELECT pg_temp.ganti_fungsi('fn_get_forum_member_details', 'IN \(''WAKA_KESISWAAN'', ''KEPSEK'', ''ADMINISTRATIVE''\)', 'IN (''WAKA_KESISWAAN'', ''KEPSEK'')');
SELECT pg_temp.ganti_fungsi('fn_forum_attachment_moderator', 'IN \(''KEPSEK'', ''WAKA_KESISWAAN'', ''ADMINISTRATIVE''\)', 'IN (''KEPSEK'', ''WAKA_KESISWAAN'')');
-- 2c'. Hapus posting oleh moderator: pemilik berkas dialihkan kepada penghapus sebelum posting hilang (lihat catatan di kepala berkas)
SELECT pg_temp.ganti_fungsi('fn_delete_forum_post', '(\s+)-- Notifikasi dibersihkan lebih dulu\.',
'\1IF v_path IS NOT NULL AND v_caller IS DISTINCT FROM v_author THEN\1    UPDATE storage.objects o SET owner_id = auth.uid()::text, owner = auth.uid()\1     WHERE o.bucket_id = ''forum-attachments'' AND o.name = v_path;\1END IF;\1-- Notifikasi dibersihkan lebih dulu.');
-- 2d. Komentar: admin tidak lagi termasuk peran yang boleh menulis komentar
DO $$
DECLARE v_cek text;
BEGIN
    SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) INTO STRICT v_cek
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
     WHERE c.relname = 'forum_post_comments' AND pol.polname = 'rls_forum_comments_insert';
    IF position('''ADMINISTRATIVE''::role_type, ' IN v_cek) = 0 THEN
        RAISE EXCEPTION 'kebijakan rls_forum_comments_insert tidak memuat ADMINISTRATIVE seperti yang diharapkan';
    END IF;
    EXECUTE format('ALTER POLICY rls_forum_comments_insert ON public.forum_post_comments WITH CHECK (%s)',
                   replace(v_cek, '''ADMINISTRATIVE''::role_type, ', ''));
END $$;
-- 2e. Sisa data: baris penerima, tanda baca, dan notifikasi Forum milik akun admin tidak pernah dapat dibuka; dibersihkan
DELETE FROM public.forum_post_acknowledgements k USING public.users u WHERE u.user_id = k.user_id AND u.role_type = 'ADMINISTRATIVE';
DELETE FROM public.forum_post_audience a USING public.users u WHERE u.user_id = a.user_id AND u.role_type = 'ADMINISTRATIVE';
DELETE FROM public.notifications n USING public.users u
 WHERE u.user_id = n.recipient_user_id AND u.role_type = 'ADMINISTRATIVE' AND (n.forum_post_id IS NOT NULL OR n.forum_comment_id IS NOT NULL);

-- ── Bagian 1: lampiran tertutup ────────────────────────────────────────────
ALTER POLICY forum_attachments_download ON storage.objects
    USING (
        bucket_id = 'forum-attachments'::text
        AND (storage.foldername(name))[1] = (public.fn_current_school_id())::text
        AND (
            public.fn_forum_attachment_readable(name)
            OR owner_id = (auth.uid())::text
        )
    );

ALTER POLICY forum_attachments_delete ON storage.objects
    USING (
        bucket_id = 'forum-attachments'::text
        AND (storage.foldername(name))[1] = (public.fn_current_school_id())::text
        AND (
            owner_id = (auth.uid())::text
            OR (public.fn_forum_attachment_moderator() AND public.fn_forum_attachment_readable(name))
        )
    );
