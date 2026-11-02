-- Migrasi 20261102010000
-- 1. Fix rls_exits_read_waka: gunakan fn_is_waka_kesiswaan() agar WAKASEK (SMP) bisa baca student_exits
-- 2. Tambah kebijakan SELECT KAPRODI di late_arrivals (filter program mereka)
-- 3. Tambah kebijakan SELECT KAPRODI di student_exits  (filter program mereka)

-- ── student_exits: WAKA (termasuk WAKASEK) ───────────────────────────────────
DROP POLICY IF EXISTS "rls_exits_read_waka" ON public.student_exits;
CREATE POLICY "rls_exits_read_waka"
  ON public.student_exits
  FOR SELECT
  USING (fn_is_waka_kesiswaan());

-- ── late_arrivals: KAPRODI (hanya program mereka) ────────────────────────────
DROP POLICY IF EXISTS "rls_late_arrivals_read_kaprodi" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_kaprodi"
  ON public.late_arrivals
  FOR SELECT
  USING (
    fn_current_user_role() = 'KAPRODI'::role_type
    AND fn_kaprodi_program_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.class_enrollments ce
      JOIN public.classes cls ON cls.class_id = ce.class_id
      WHERE ce.student_id = late_arrivals.student_id
        AND ce.withdrawn_at IS NULL
        AND cls.program_id IS DISTINCT FROM NULL
        AND cls.program_id = fn_kaprodi_program_id()
    )
  );

-- ── student_exits: KAPRODI (hanya program mereka) ────────────────────────────
DROP POLICY IF EXISTS "rls_exits_read_kaprodi" ON public.student_exits;
CREATE POLICY "rls_exits_read_kaprodi"
  ON public.student_exits
  FOR SELECT
  USING (
    fn_current_user_role() = 'KAPRODI'::role_type
    AND fn_kaprodi_program_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.class_enrollments ce
      JOIN public.classes cls ON cls.class_id = ce.class_id
      WHERE ce.student_id = student_exits.student_id
        AND ce.withdrawn_at IS NULL
        AND cls.program_id IS DISTINCT FROM NULL
        AND cls.program_id = fn_kaprodi_program_id()
    )
  );
