-- Tiga perubahan akses data keterlambatan (late_arrivals) dan izin keluar (student_exits):
--
-- 1. Guru piket: dari "hanya hari piket" menjadi bisa baca riwayat yang ia sendiri catat
-- 2. Wali kelas: tambah akses baca riwayat semua siswa di kelas waliannya
-- 3. Kepala sekolah: turunkan dari detail per siswa menjadi hanya agregat
--    (Kepsek tetap dapat angka via fn_kepsek_monitoring, tidak perlu baca baris)

-- ── late_arrivals ────────────────────────────────────────────────────────────

-- 1. Ganti policy staff: keluarkan fn_is_kepsek(), tambahkan piket historis (recorded_by)
DROP POLICY IF EXISTS "rls_late_arrivals_read_staff" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_staff"
  ON public.late_arrivals
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND (
      fn_is_on_duty_today()
      OR recorded_by = fn_current_user_id()   -- piket: riwayat yang ia sendiri catat
      OR fn_is_waka_kesiswaan()
      OR fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    )
  );

-- 2. Wali kelas: riwayat penuh untuk siswa di kelas waliannya
DROP POLICY IF EXISTS "rls_late_arrivals_read_wali" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_wali"
  ON public.late_arrivals
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'WALI_KELAS'::role_type
    AND EXISTS (
      SELECT 1
      FROM public.class_enrollments ce
      JOIN public.users u ON u.user_id = fn_current_user_id()
      WHERE ce.student_id    = late_arrivals.student_id
        AND ce.class_id      = u.wali_kelas_class_id
        AND ce.withdrawn_at  IS NULL
        AND u.school_id      = fn_current_school_id()
    )
  );

-- ── student_exits ────────────────────────────────────────────────────────────

-- 3. Ganti policy waka: keluarkan KEPSEK
DROP POLICY IF EXISTS "rls_exits_read_waka" ON public.student_exits;
CREATE POLICY "rls_exits_read_waka"
  ON public.student_exits
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'WAKA_KESISWAAN'::role_type
  );

-- 4. Guru piket: riwayat yang ia sendiri catat (tanpa batas tanggal)
--    Policy lama hanya memberi akses hari ini via fn_is_on_duty_today().
--    Kita tambah jalur kedua: recorded_by = piket itu sendiri.
--    (policy rls_exits_read_piket lama dipertahankan untuk hari-ini; ini untuk historis)
DROP POLICY IF EXISTS "rls_exits_read_piket_historis" ON public.student_exits;
CREATE POLICY "rls_exits_read_piket_historis"
  ON public.student_exits
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id  = fn_current_school_id()
    AND recorded_by = fn_current_user_id()
  );

-- 5. Wali kelas: riwayat penuh untuk siswa di kelas waliannya
DROP POLICY IF EXISTS "rls_exits_read_wali" ON public.student_exits;
CREATE POLICY "rls_exits_read_wali"
  ON public.student_exits
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'WALI_KELAS'::role_type
    AND EXISTS (
      SELECT 1
      FROM public.class_enrollments ce
      JOIN public.users u ON u.user_id = fn_current_user_id()
      WHERE ce.student_id    = student_exits.student_id
        AND ce.class_id      = u.wali_kelas_class_id
        AND ce.withdrawn_at  IS NULL
        AND u.school_id      = fn_current_school_id()
    )
  );
