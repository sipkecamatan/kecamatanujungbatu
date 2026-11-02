-- Tambahkan WAKASEK ke daftar role yang bisa membaca dan dibaca di tabel users.
-- Masalah: piket SMP dicatat oleh WAKASEK, tapi JOIN ke users.full_name
-- (untuk kolom "Dicatat Oleh") selalu null karena:
--   (a) caller WAKASEK tidak ada di fn_current_user_role() check rls_users_read_staff
--   (b) target WAKASEK tidak ada di role_type check rls_users_read_staff
-- Solusi: tambah WAKASEK ke kedua array.

DROP POLICY IF EXISTS "rls_users_read_staff" ON public.users;
CREATE POLICY "rls_users_read_staff" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    (school_id = fn_current_school_id()) AND (
      (
        fn_current_user_role() = ANY (ARRAY[
          'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
          'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS',
          'WAKASEK','ADMINISTRATIVE'
        ]::role_type[])
        AND role_type = ANY (ARRAY[
          'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
          'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS',
          'WAKASEK','DUDI','ADMINISTRATIVE'
        ]::role_type[])
      )
      OR (auth_user_id = auth.uid())
      OR (
        fn_current_user_role() = ANY (ARRAY[
          'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
          'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS',
          'WAKASEK','ADMINISTRATIVE'
        ]::role_type[])
        AND role_type = ANY (ARRAY['SISWA','ORTU']::role_type[])
      )
    )
  );

-- WAKASEK juga perlu masuk ke rls_users_read_waka agar konsisten
-- (waka selengkapnya sudah di read_staff, ini hanya untuk kejelasan)
DROP POLICY IF EXISTS "rls_users_read_waka" ON public.users;
CREATE POLICY "rls_users_read_waka" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    (school_id = fn_current_school_id())
    AND fn_current_user_role() = ANY (ARRAY[
      'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKASEK'
    ]::role_type[])
  );
