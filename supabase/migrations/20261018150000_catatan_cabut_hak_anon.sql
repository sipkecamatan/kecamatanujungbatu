-- Kebersihan keamanan Catatan Siswa (disetujui Romo 18 Okt 2026): peran anon (pengunjung tanpa login) tidak boleh menyentuh tabel catatan sama sekali.
-- Sebelumnya anon memegang hak penuh pada tabel (bawaan Supabase). Pengunjung tanpa login SUDAH tertahan dua hal: tidak ada kebijakan RLS untuk anon, dan
-- fungsi yang dipanggil kebijakan (mis. fn_current_user_id) tidak boleh dijalankan anon, sehingga query anon berakhir 42501 "permission denied for function".
-- Pencabutan ini menambah penghalang ketiga yang tidak bergantung pada keduanya: anon ditolak (42501) tepat pada hak tabel, bahkan bila suatu hari kebijakan atau
-- hak fungsi berubah. Pengguna yang sudah login (authenticated) dan service_role tidak berubah.
-- Tampilan lama v_student_portal_positif (tidak dipakai di kode; membaca tabel yang sama, security_invoker) ikut dicabut.
-- Cakupan sengaja sempit: hanya dua objek ini. Hak anon pada tabel lain dibiarkan (sebagian fitur memerlukannya, mis. pencarian login).
REVOKE ALL ON TABLE public.observations FROM anon;
REVOKE ALL ON TABLE public.v_student_portal_positif FROM anon;
