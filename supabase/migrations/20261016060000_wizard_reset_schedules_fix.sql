-- ============================================================================
-- Perbaikan fn_wizard_reset_schedules: buang perintah yang merujuk kolom yang tidak ada.
--
-- Fungsi ini memanggil  DELETE FROM teacher_journals WHERE schedule_id = ANY(...), padahal tabel teacher_journals tidak
-- punya kolom schedule_id (sisa skema lama) dan tidak ada FK ke teaching_schedules. Akibatnya SELURUH fungsi selalu galat
-- 42703 sebelum menghapus apa pun, sehingga "reset jadwal" di wizard admin (admin/js/api.js: wizardResetSchedules) gagal
-- untuk setiap admin sekolah.
--
-- Hanya empat tabel yang mereferensikan teaching_schedules dengan ON DELETE RESTRICT (attendance, observations,
-- substitute_schedules, teacher_attendance_log); keempatnya sudah dihapus fungsi ini sebelum teaching_schedules, jadi
-- membuang perintah teacher_journals sudah cukup. Penjaga wewenang dari migrasi 20261016050000 tidak berubah.
--
-- Batas yang diketahui: teaching_assignments direferensikan ld_documents dan ld_context_snapshots (perangkat ajar, fitur
-- disembunyikan) tanpa aturan hapus; bila sekolah punya dokumen seperti itu, fungsi ini akan galat 23503 dan membatalkan
-- seluruh penghapusan (aman, tidak ada yang terhapus sebagian).
-- fn_reapply_schedule_templates memuat kesalahan yang sama tetapi jalur legacy tanpa pemanggil dan hak EXECUTE pengguna
-- login sudah dicabut; sengaja tidak diubah.
-- ============================================================================

SET search_path = public, extensions;

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
