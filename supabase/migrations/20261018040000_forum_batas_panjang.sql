-- Audit Forum (Codex, 17 Okt 2026), temuan A-13 (terbukti dari skema live): batas panjang judul/isi/komentar hanya ada di atribut HTML (maxlength), sedangkan constraint
-- di server hanya memeriksa panjang MINIMUM. Pemanggil langsung (PostgREST/RPC) dapat mengirim teks sangat besar yang membebani penyimpanan, kueri berlapis, notifikasi,
-- dan tampilan semua penerima.
-- Batas dipilih sama dengan batas terbesar yang sudah dipakai klien, supaya tidak ada alur sah yang ditolak:
--   judul    200   (guru dan orang tua: maxlength=200)
--   isi     5000   (guru: 5000; orang tua: 2000)
--   komentar 2000  (guru: 1000; orang tua: 2000)
-- Saat dipasang tabel forum_posts dan forum_post_comments tidak berisi baris yang melanggar (diperiksa langsung oleh ADD CONSTRAINT; bila ada, migrasi gagal dan tidak mengubah apa pun).

ALTER TABLE public.forum_posts
    ADD CONSTRAINT forum_posts_title_len_check CHECK (char_length(title) <= 200),
    ADD CONSTRAINT forum_posts_body_len_check  CHECK (char_length(body)  <= 5000);

ALTER TABLE public.forum_post_comments
    ADD CONSTRAINT forum_post_comments_body_len_check CHECK (char_length(body) <= 2000);
