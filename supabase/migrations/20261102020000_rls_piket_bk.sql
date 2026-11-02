-- Migrasi 20261102020000
-- BK bisa baca late_arrivals dan student_exits seluruh sekolah (sama dengan waka kesiswaan)
-- Pola: fn_is_bk() mencakup role_type='BK' DAN flag is_bk=true
-- KEPSEK dan WAKA_KURIKULUM sengaja tidak dimasukkan (kepsek hanya agregat via fn_kepsek_monitoring)

-- ── late_arrivals: tambah BK ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "rls_late_arrivals_read_staff" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_staff"
  ON public.late_arrivals
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND (
      fn_is_on_duty_today()
      OR recorded_by = fn_current_user_id()
      OR fn_is_waka_kesiswaan()
      OR fn_is_bk()
      OR fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    )
  );

-- ── student_exits: tambah BK ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "rls_exits_read_waka" ON public.student_exits;
CREATE POLICY "rls_exits_read_waka"
  ON public.student_exits
  FOR SELECT
  USING (
    school_id = fn_current_school_id()
    AND (fn_is_waka_kesiswaan() OR fn_is_bk())
  );
