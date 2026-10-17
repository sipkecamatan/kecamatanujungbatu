-- DG-02 (diperluas): pergantian Semester 1 -> 2 dalam tahun ajaran yang sama tidak membuat pendaftaran kelas (class_enrollments) untuk
-- Semester 2. fn_close_semester hanya menggeser school_config.current_semester, dan panel admin "Buka Semester 2" hanya menambah baris
-- academic_periods. Padahal pendaftaran kelas bersifat per (siswa, tahun ajaran, semester), dan banyak jalur memfilternya dengan semester
-- berjalan: validasi absensi di Edge (sync-attendance-batch memakai semester jadwal), kandidat eskalasi/penandaan kasus (wali kelas, BK), dll.
-- Akibatnya, begitu Semester 2 berjalan, absensi ditolak ("siswa tidak terdaftar") dan kandidat wali kelas/BK hilang.
--
-- Fungsi ini dipanggil admin saat membuka Semester 2: membuat periode ACTIVE bila belum ada, lalu menyalin pendaftaran Semester 1 yang masih
-- aktif ke Semester 2 (siswa AKTIF/PKL saja). Idempotent: dipanggil ulang hanya melengkapi yang belum ada.
CREATE OR REPLACE FUNCTION public.fn_open_next_semester(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school  uuid := public.fn_current_school_id();
    v_year    text;
    v_sem     text;
    v_created boolean := FALSE;
    v_rows    integer;
BEGIN
    IF public.fn_current_user_role() IS DISTINCT FROM 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'akses ditolak: hanya administrator sekolah' USING ERRCODE = '42501';
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
        RAISE EXCEPTION 'rentang tanggal Semester 2 tidak valid' USING ERRCODE = 'P0001';
    END IF;

    SELECT sc.current_academic_year, sc.current_semester::text INTO v_year, v_sem
    FROM public.school_config sc WHERE sc.school_id = v_school LIMIT 1;
    IF v_year IS NULL OR v_sem IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Semester 1 belum ditutup (semester berjalan bukan 2)' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.academic_periods p
                   WHERE p.school_id = v_school AND p.academic_year = v_year AND p.semester = '1'::semester AND p.status = 'CLOSED') THEN
        RAISE EXCEPTION 'periode Semester 1 belum berstatus CLOSED' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.academic_periods p
                   WHERE p.school_id = v_school AND p.academic_year = v_year AND p.semester = '2'::semester) THEN
        INSERT INTO public.academic_periods (school_id, academic_year, semester, start_date, end_date, status)
        VALUES (v_school, v_year, '2'::semester, p_start_date, p_end_date, 'ACTIVE');
        v_created := TRUE;
    END IF;

    INSERT INTO public.class_enrollments (school_id, student_id, class_id, academic_year, semester)
    SELECT ce.school_id, ce.student_id, ce.class_id, ce.academic_year, '2'::semester
    FROM public.class_enrollments ce
    JOIN public.students s ON s.student_id = ce.student_id
    WHERE ce.school_id = v_school
      AND ce.academic_year = v_year
      AND ce.semester = '1'::semester
      AND ce.withdrawn_at IS NULL
      AND s.student_status IN ('AKTIF'::student_status, 'PKL'::student_status)
    ON CONFLICT (student_id, academic_year, semester) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    RETURN jsonb_build_object('period_created', v_created, 'enrolled', v_rows, 'academic_year', v_year);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_open_next_semester(date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_open_next_semester(date, date) TO authenticated, service_role;
