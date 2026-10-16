-- ============================================================================
-- Perbaikan penjaga wewenang pada tiga fungsi hapus-data wizard (temuan audit jalur API, 16 Okt 2026).
--
-- Masalah: penjaga lama berbentuk  IF fn_current_school_id() <> p_school_id THEN RAISE ...  dan
--          IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN RAISE ...
-- Bila pemanggil tidak punya sekolah dan peran (akun login tanpa baris public.users, mis. pegawai wilayah),
-- kedua nilai NULL, perbandingan NULL tidak pernah benar, sehingga penjaga TERLEWATI. Akibatnya
-- fn_wizard_reset_students(p_school_id, NULL) menghapus semua siswa, absensi, dan akun siswa SEKOLAH MANA PUN
-- yang id-nya diketahui oleh akun seperti itu. (Pendaftaran publik dimatikan, jadi yang terdampak adalah akun
-- yang dibuat superadmin tanpa profil sekolah.)
-- fn_wizard_reset_schedules memiliki penjaga yang sama; fn_reapply_schedule_templates tidak punya penjaga sama
-- sekali. Keduanya kini kebetulan tertahan galat lain (kolom schedule_id tidak ada di teacher_journals) sehingga
-- tidak sampai menghapus, tetapi akan menjadi celah begitu galat itu diperbaiki.
--
-- Perbaikan: IS DISTINCT FROM (NULL ditolak), p_school_id wajib, dan penjaga ditambahkan ke fn_reapply.
-- Badan fungsi lainnya disalin dari baseline tanpa perubahan; hak akses tidak berubah (CREATE OR REPLACE).
-- Cacat kolom schedule_id sengaja TIDAK diperbaiki di sini (bukan soal isolasi; perlu keputusan terpisah).
-- ============================================================================

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.fn_wizard_reset_students(p_school_id uuid, p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ids           uuid[];
    v_case_ids      uuid[];
    v_user_ids      uuid[];
    v_auth_ids      uuid[];
    v_deleted_count int;
BEGIN
    IF p_school_id IS NULL OR fn_current_school_id() IS DISTINCT FROM p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset data siswa.';
    END IF;

    IF p_student_ids IS NULL THEN
        SELECT ARRAY_AGG(student_id) INTO v_ids
        FROM students WHERE school_id = p_school_id;
    ELSE
        SELECT ARRAY_AGG(student_id) INTO v_ids
        FROM students
        WHERE student_id = ANY(p_student_ids) AND school_id = p_school_id;
    END IF;

    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
        RETURN jsonb_build_object('deleted_students', 0, 'auth_user_ids', '[]'::jsonb);
    END IF;

    SELECT ARRAY_AGG(case_id) INTO v_case_ids
    FROM coaching_cases WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    SELECT ARRAY_AGG(user_id) INTO v_user_ids
    FROM students WHERE student_id = ANY(v_ids) AND user_id IS NOT NULL;

    IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
        SELECT ARRAY_AGG(auth_user_id) INTO v_auth_ids
        FROM users WHERE user_id = ANY(v_user_ids) AND auth_user_id IS NOT NULL;
    END IF;

    -- student_updates via case_id
    IF v_case_ids IS NOT NULL AND array_length(v_case_ids, 1) > 0 THEN
        DELETE FROM student_updates WHERE case_id = ANY(v_case_ids);
    END IF;

    -- coaching_case_events (append-only, disable trigger sementara)
    ALTER TABLE coaching_case_events DISABLE TRIGGER trg_coaching_case_events_immutable;
    IF v_case_ids IS NOT NULL AND array_length(v_case_ids, 1) > 0 THEN
        DELETE FROM coaching_case_events WHERE case_id = ANY(v_case_ids);
    END IF;
    ALTER TABLE coaching_case_events ENABLE TRIGGER trg_coaching_case_events_immutable;

    DELETE FROM coaching_cases
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM attendance
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM observations
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM pkl_attendance
    WHERE student_id = ANY(v_ids);

    DELETE FROM pkl_placements
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM guru_wali_assignments
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM class_enrollments
    WHERE student_id = ANY(v_ids);

    DELETE FROM student_parents
    WHERE student_id = ANY(v_ids);

    -- Posting forum siswa (RESTRICT ke users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM forum_posts
        WHERE author_user_id = ANY(v_user_ids);
    END IF;

    -- Notifications siswa (NO ACTION ke users — hapus sebelum users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM notifications
        WHERE recipient_user_id = ANY(v_user_ids);
    END IF;

    -- Akun portal siswa
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM users WHERE user_id = ANY(v_user_ids) AND school_id = p_school_id;
    END IF;

    DELETE FROM students WHERE student_id = ANY(v_ids) AND school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_students', v_deleted_count,
        'auth_user_ids',    COALESCE(to_jsonb(v_auth_ids), '[]'::jsonb)
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_wizard_reset_schedules(p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_schedule_ids  uuid[];
    v_deleted_sched int;
    v_deleted_tpl   int;
    v_deleted_asgn  int;
BEGIN
    -- Verifikasi pemanggil adalah ADMINISTRATIVE sekolah ini
    IF p_school_id IS NULL OR fn_current_school_id() IS DISTINCT FROM p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset jadwal.';
    END IF;

    -- Kumpulkan schedule_ids untuk hapus data yang RESTRICT ke teaching_schedules
    SELECT ARRAY_AGG(schedule_id) INTO v_schedule_ids
    FROM teaching_schedules WHERE school_id = p_school_id;

    IF v_schedule_ids IS NOT NULL AND array_length(v_schedule_ids, 1) > 0 THEN
        -- Log aktivitas guru per sesi (NOT NULL FK — penyebab utama 409)
        DELETE FROM teacher_attendance_log
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jurnal guru yang terkait sesi jadwal (nullable FK)
        DELETE FROM teacher_journals
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Absensi yang terkait sesi jadwal
        DELETE FROM attendance
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jadwal guru pengganti
        DELETE FROM substitute_schedules
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Observasi yang terkait sesi jadwal
        DELETE FROM observations
        WHERE schedule_id = ANY(v_schedule_ids) AND school_id = p_school_id;
    END IF;

    -- Sesi jadwal konkret
    DELETE FROM teaching_schedules WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

    -- Template jadwal mingguan
    DELETE FROM schedule_templates WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_tpl = ROW_COUNT;

    -- Penugasan mengajar
    DELETE FROM teaching_assignments WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_asgn = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_schedules',         v_deleted_sched,
        'deleted_templates',         v_deleted_tpl,
        'deleted_assignments',       v_deleted_asgn
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_reapply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_deleted_sess  integer := 0;
    v_deleted_sub   integer := 0;
    v_result        jsonb;
BEGIN
    -- Penjaga wewenang (sebelumnya tidak ada): hanya ADMINISTRATIVE sekolah ini; pemanggil tanpa sekolah/peran ditolak.
    IF p_school_id IS NULL OR fn_current_school_id() IS DISTINCT FROM p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat menerapkan ulang jadwal.';
    END IF;

    SET LOCAL statement_timeout = 0;

    -- Sesi target: masa depan, milik sekolah ini, belum ada absensi
    CREATE TEMP TABLE _reapply_target ON COMMIT DROP AS
    SELECT ts.schedule_id
    FROM   teaching_schedules ts
    WHERE  ts.school_id     = p_school_id
      AND  ts.academic_year = p_academic_year
      AND  ts.semester      = p_semester
      AND  ts.session_date  > CURRENT_DATE
      AND  NOT EXISTS (
               SELECT 1 FROM attendance a
               WHERE  a.schedule_id = ts.schedule_id
           );

    -- Putus referensi nullable (jangan hapus data observasi/jurnal guru)
    UPDATE observations
    SET    schedule_id = NULL
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    UPDATE teacher_journals
    SET    schedule_id = NULL
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    -- Hapus child records NOT NULL sebelum hapus sesi
    DELETE FROM teacher_attendance_log
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    DELETE FROM substitute_schedules
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);
    GET DIAGNOSTICS v_deleted_sub = ROW_COUNT;

    -- Hapus sesi target
    DELETE FROM teaching_schedules
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);
    GET DIAGNOSTICS v_deleted_sess = ROW_COUNT;

    DROP TABLE _reapply_target;

    -- Generate ulang dari template terkini (hanya mengisi yang kosong ke depan)
    SELECT fn_apply_schedule_templates(p_academic_year, p_semester, p_school_id)
    INTO   v_result;

    RETURN jsonb_build_object(
        'sessions_deleted',     v_deleted_sess,
        'substitutes_deleted',  v_deleted_sub,
        'templates_found',      (v_result->>'templates_found')::int,
        'assignments_upserted', (v_result->>'assignments_upserted')::int,
        'schedules_generated',  (v_result->>'schedules_generated')::int
    );
END;
$function$;

-- fn_reapply_schedule_templates adalah jalur "reapply legacy" yang sudah dihentikan (lihat komentar
-- supabase/functions/apply-schedule-templates): tidak ada klien atau fungsi edge yang memanggilnya. Hak EXECUTE pengguna
-- login dicabut agar permukaan serangan hilang; service_role tetap.
REVOKE EXECUTE ON FUNCTION public.fn_reapply_schedule_templates(text, semester, uuid) FROM authenticated;
