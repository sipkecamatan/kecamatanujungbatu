-- Perbaiki WITH CHECK pada rls_exits_update_own:
-- sebelumnya tidak menyertakan fn_is_on_duty_today() sehingga
-- USING menolak baris tapi WITH CHECK tidak memblokir nilai baru.
DROP POLICY IF EXISTS "rls_exits_update_own" ON public.student_exits;
CREATE POLICY "rls_exits_update_own" ON public.student_exits AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING  ((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today())
  WITH CHECK ((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today());
