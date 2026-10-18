-- Keputusan Romo 18 Okt 2026: Kepala Sekolah DIKELUARKAN dari Pembinaan Siswa. Kepala Sekolah hanya melihat data agregat di dashboard Kepala Sekolah.
-- Sebelumnya Kepsek: (1) selalu membaca semua kasus, (2) boleh menulis SEMUA jenis peristiwa pada kasus mana pun (rls_cce_insert), (3) melihat daftar pembaca dan log akses,
-- (4) mencatat jejak pengawas, (5) membuka kembali kasus tutup, (6) dapat ditandai sebagai pembaca dan menjadi tujuan eskalasi.
-- Kini semuanya dicabut. Waka Kesiswaan tetap pengawas (membaca, jejak pengawas, membuka kembali kasus tutup).
-- Pengganti: fn_kepsek_case_summary() yang HANYA mengembalikan angka (tanpa judul, deskripsi, atau nama siswa).
-- Data nyata dibaca sebelum migrasi: Kepsek tidak pernah membuat/menangani/ditandai pada kasus; riwayat peristiwa dan log lama (hasil uji) dibiarkan karena tidak dapat diubah.
-- Penggantian fungsi memakai teks definisi yang sungguh terpasang dan GAGAL KERAS bila jumlah kemunculan tidak sesuai (tidak ada penggantian diam-diam).

CREATE OR REPLACE FUNCTION pg_temp.ganti_fungsi(p_proc regprocedure, p_pola text, p_baru text, p_jumlah integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
AS $f$
DECLARE
    v_def text := pg_get_functiondef(p_proc);
    v_n   integer;
BEGIN
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, p_pola, 'g');
    IF v_n <> p_jumlah THEN
        RAISE EXCEPTION 'penggantian % gagal: pola % ditemukan % kali (harap %)', p_proc, p_pola, v_n, p_jumlah;
    END IF;
    EXECUTE regexp_replace(v_def, p_pola, p_baru, 'g');
END
$f$;

-- 1. Membaca kasus: hanya pembuat, penangan, pembaca yang ditandai, dan Waka Kesiswaan
SELECT pg_temp.ganti_fungsi('public.fn_can_see_coaching_case(uuid)'::regprocedure, 'OR\s+public\.fn_is_kepsek\(\)\s*', '');
-- 2. Daftar pembaca dan log akses
SELECT pg_temp.ganti_fungsi('public.fn_case_list_viewers(uuid)'::regprocedure, 'OR\s+public\.fn_is_kepsek\(\)\s+', '');
SELECT pg_temp.ganti_fungsi('public.fn_case_list_access_log(uuid)'::regprocedure, 'OR\s+public\.fn_is_kepsek\(\)\s+', '');
-- 3. Jejak pengawas: hanya Waka Kesiswaan
SELECT pg_temp.ganti_fungsi('public.fn_case_log_oversight_view(uuid)'::regprocedure, 'NOT \(public\.fn_is_kepsek\(\) OR public\.fn_is_waka_kesiswaan\(\)\)', 'NOT public.fn_is_waka_kesiswaan()');
-- 4. Membuka kembali kasus tutup: hanya Waka Kesiswaan
SELECT pg_temp.ganti_fungsi('public.fn_coaching_event_rules()'::regprocedure, 'IF NOT \(public\.fn_is_kepsek\(\) OR public\.fn_is_waka_kesiswaan\(\)\) THEN', 'IF NOT public.fn_is_waka_kesiswaan() THEN');
SELECT pg_temp.ganti_fungsi('public.fn_coaching_event_rules()'::regprocedure, 'hanya Waka Kesiswaan atau Kepala Sekolah yang dapat membuka kembali kasus', 'hanya Waka Kesiswaan yang dapat membuka kembali kasus');
-- 5. Tidak dapat ditandai, bukan kandidat penanda, bukan tujuan eskalasi, bukan penangan
SELECT pg_temp.ganti_fungsi('public.fn_case_add_viewer(uuid,uuid)'::regprocedure, '''KEPSEK''::role_type,\s*', '');
SELECT pg_temp.ganti_fungsi('public.fn_case_tag_candidates(uuid)'::regprocedure, '''WAKA_HUMAS''::role_type,\s*''KEPSEK''::role_type\)', '''WAKA_HUMAS''::role_type)');
SELECT pg_temp.ganti_fungsi('public.fn_get_escalation_candidates(uuid)'::regprocedure, 'AND\s+u\.is_kepsek\s*=\s*TRUE', 'AND FALSE', 2);
SELECT pg_temp.ganti_fungsi('public.fn_validate_escalation()'::regprocedure, '''KEPSEK''::role_type,\s*', '');
SELECT pg_temp.ganti_fungsi('public.fn_validate_escalation()'::regprocedure, 'WAKA_HUMAS, KEPSEK, KAPRODI', 'WAKA_HUMAS, KAPRODI');
SELECT pg_temp.ganti_fungsi('public.fn_matches_case_handler(role_type,uuid)'::regprocedure, '\s*OR \(p_handler_role = ''KEPSEK''::role_type\s+AND fn_is_kepsek\(\)\)', '');
-- Catatan: fn_notify_on_case_event (siaran lama, menyebut KEPSEK) merujuk tabel "cases" yang sudah tidak ada, tidak dipasang pada pemicu mana pun, dan tidak dipanggil fungsi lain:
-- kode mati, sengaja tidak disentuh.

-- 6. Menulis peristiwa: hapus klausa Kepsek; membaca daftar pembaca (tabel): hapus klausa Kepsek
ALTER POLICY rls_cce_insert ON public.coaching_case_events
    WITH CHECK (
        school_id = public.fn_current_school_id()
        AND author_user_id = public.fn_current_user_id()
        AND (
            current_setting('app.coaching_sync_active', true) = 'true'
            OR EXISTS (SELECT 1 FROM public.coaching_cases c
                        WHERE c.case_id = coaching_case_events.case_id
                          AND c.current_handler_user_id = public.fn_current_user_id()
                          AND c.status <> 'CLOSED'::public.case_status)
            OR (public.fn_is_waka_kesiswaan()
                AND event_type = 'STATUS_CHANGED'::public.coaching_case_event_type
                AND EXISTS (SELECT 1 FROM public.coaching_cases c
                             WHERE c.case_id = coaching_case_events.case_id AND c.status = 'CLOSED'::public.case_status))
        )
    );
ALTER POLICY rls_ccv_read ON public.coaching_case_viewers
    USING (
        school_id = public.fn_current_school_id()
        AND (user_id = public.fn_current_user_id()
             OR public.fn_case_is_creator_or_handler(case_id)
             OR public.fn_is_waka_kesiswaan())
    );

-- 7. Dashboard Kepala Sekolah: HANYA angka agregat sekolah (tanpa judul, deskripsi, nama siswa, atau pelaku)
CREATE OR REPLACE FUNCTION public.fn_kepsek_case_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school uuid := public.fn_current_school_id();
BEGIN
    IF NOT public.fn_is_kepsek() THEN
        RAISE EXCEPTION 'akses ditolak: khusus Kepala Sekolah' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT jsonb_build_object(
            'total', count(*),
            'per_status', jsonb_build_object(
                'OPEN',         count(*) FILTER (WHERE c.status::text = 'OPEN'),
                'UNDER_REVIEW', count(*) FILTER (WHERE c.status::text = 'UNDER_REVIEW'),
                'INTERVENTION', count(*) FILTER (WHERE c.status::text = 'INTERVENTION'),
                'MONITORING',   count(*) FILTER (WHERE c.status::text = 'MONITORING'),
                'CLOSED',       count(*) FILTER (WHERE c.status::text = 'CLOSED')),
            'per_track', jsonb_build_object(
                'SEKOLAH', count(*) FILTER (WHERE c.track::text = 'SEKOLAH'),
                'PKL',     count(*) FILTER (WHERE c.track::text = 'PKL')),
            'dibuka_30_hari',  count(*) FILTER (WHERE c.created_at >= now() - interval '30 days'),
            'ditutup_30_hari', count(*) FILTER (WHERE c.closed_at >= now() - interval '30 days'),
            'rata_hari_penyelesaian',
                round((avg(extract(epoch FROM (c.closed_at - c.created_at)) / 86400.0) FILTER (WHERE c.closed_at IS NOT NULL))::numeric, 1))
        FROM public.coaching_cases c
        WHERE c.school_id = v_school);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_kepsek_case_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_kepsek_case_summary() TO authenticated, service_role;
