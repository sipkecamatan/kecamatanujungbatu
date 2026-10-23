-- Guru yang mengajar hari ini dapat membaca keterlambatan dan izin keluar
-- siswa di kelas yang sedang diajarnya — hanya hari ini, akses hilang besok.
--
-- Syarat: ada baris teaching_schedules dengan scheduled_teacher_id = guru login,
-- session_date = hari ini, dan siswa terdaftar (class_enrollments) di kelas itu.

-- ── late_arrivals ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "rls_late_arrivals_read_guru_mengajar" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_guru_mengajar"
  ON public.late_arrivals
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND late_date = (now() AT TIME ZONE 'Asia/Jakarta')::date
    AND EXISTS (
      SELECT 1
      FROM public.teaching_schedules ts
      JOIN public.class_enrollments  ce ON ce.class_id = ts.class_id
      WHERE ts.scheduled_teacher_id = fn_current_user_id()
        AND ts.session_date         = (now() AT TIME ZONE 'Asia/Jakarta')::date
        AND ts.school_id            = fn_current_school_id()
        AND ce.student_id           = late_arrivals.student_id
        AND ce.withdrawn_at         IS NULL
    )
  );

-- ── student_exits ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "rls_exits_read_guru_mengajar" ON public.student_exits;
CREATE POLICY "rls_exits_read_guru_mengajar"
  ON public.student_exits
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    school_id = fn_current_school_id()
    AND exit_date = (now() AT TIME ZONE 'Asia/Jakarta')::date
    AND EXISTS (
      SELECT 1
      FROM public.teaching_schedules ts
      JOIN public.class_enrollments  ce ON ce.class_id = ts.class_id
      WHERE ts.scheduled_teacher_id = fn_current_user_id()
        AND ts.session_date         = (now() AT TIME ZONE 'Asia/Jakarta')::date
        AND ts.school_id            = fn_current_school_id()
        AND ce.student_id           = student_exits.student_id
        AND ce.withdrawn_at         IS NULL
    )
  );
