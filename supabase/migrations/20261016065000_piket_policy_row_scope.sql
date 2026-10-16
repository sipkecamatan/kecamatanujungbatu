-- ============================================================================
-- Perbaikan kebijakan RLS teacher_piket_assignments: batasi BARIS, bukan hanya pemanggil.
--
-- Temuan audit jalur API (16 Okt 2026): kebijakan rls_piket_admin_write berlaku untuk SEMUA perintah (FOR ALL) tetapi syaratnya hanya
--   EXISTS (SELECT 1 FROM users WHERE users.auth_user_id = auth.uid() AND users.school_id = fn_current_school_id()
--           AND users.role_type = 'ADMINISTRATIVE')
-- yaitu memeriksa bahwa PEMANGGIL adalah ADMINISTRATIVE di sekolahnya, tanpa pernah memeriksa sekolah BARIS yang disentuh.
-- Akibatnya admin sekolah B lolos untuk setiap baris sekolah mana pun: dapat MEMBACA, MENGUBAH, MENGHAPUS, dan MENAMBAH jadwal
-- piket sekolah A (terbukti di PGlite; USING dipakai juga sebagai WITH CHECK karena tidak ada WITH CHECK terpisah).
-- Dari 265 kebijakan pada tabel ber-school_id, hanya ini yang cacat; empat lainnya tanpa rujukan school_id sengaja dibatasi lewat
-- induk (attendance via jadwal) atau lewat hubungan pemanggil dengan siswa/anak (observations).
--
-- Perbaikan: syarat baris (school_id = fn_current_school_id()) ditambahkan pada USING dan WITH CHECK; syarat pemanggil tetap.
-- Kebijakan baca rls_piket_select (school_id = fn_current_school_id()) tidak berubah.
-- ============================================================================

SET search_path = public, extensions;

DROP POLICY IF EXISTS "rls_piket_admin_write" ON public.teacher_piket_assignments;
CREATE POLICY "rls_piket_admin_write" ON public.teacher_piket_assignments AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
        AND users.school_id = fn_current_school_id()
        AND users.role_type = 'ADMINISTRATIVE'::role_type
    )
  )
  WITH CHECK (
    school_id = fn_current_school_id()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
        AND users.school_id = fn_current_school_id()
        AND users.role_type = 'ADMINISTRATIVE'::role_type
    )
  );
