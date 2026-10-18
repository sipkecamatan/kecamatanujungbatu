-- Ditemukan saat menguji perbaikan audit Forum di peramban (18 Okt 2026), bukan dari laporan Codex:
-- penulis tidak dapat menghapus berkas lampiran miliknya sendiri begitu posting yang merujuknya dihapus atau lampirannya diganti. Kebijakan hapus
-- (forum_attachments_delete) memang mengizinkan pemilik, tetapi DELETE di storage.objects hanya berlaku pada baris yang juga lolos kebijakan SELECT, dan
-- kebijakan SELECT (forum_attachments_download) hanya meloloskan moderator atau pembaca posting yang MASIH merujuk path itu (fn_forum_attachment_readable).
-- Akibatnya storage.remove() dari klien mengembalikan sukses dengan 0 berkas terhapus (tanpa galat), sehingga setiap lampiran dari posting yang dihapus atau
-- diganti oleh non-moderator menjadi berkas yatim di bucket private (deleteForumSekolahPost dan jalur edit lampiran sama-sama terkena).
-- Perbaikan: pemilik berkas boleh melihat (dan karena itu menghapus) berkas miliknya sendiri. Tidak membuka akses baru: pemilik memang yang mengunggahnya.

ALTER POLICY forum_attachments_download ON storage.objects
    USING (
        bucket_id = 'forum-attachments'::text
        AND (storage.foldername(name))[1] = (public.fn_current_school_id())::text
        AND (
            public.fn_forum_attachment_moderator()
            OR public.fn_forum_attachment_readable(name)
            OR owner_id = (auth.uid())::text
        )
    );
