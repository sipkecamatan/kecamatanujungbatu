-- Aturan produk dari Romo (18 Okt 2026), butir 2: orang tua hanya dapat menulis terkait izin ketidakhadiran anaknya; isinya informasi yang OTOMATIS tertuju kepada
--   (a) wali kelas anak, (b) guru wali anak, (c) guru piket yang bertugas pada hari itu, (d) guru yang mengajar anak pada hari itu.
-- "Hari itu" = hari pesan dikirim (WIB).
-- Keadaan sebelumnya: orang tua menulis teks bebas (judul + isi) lewat fn_create_forum_post dengan penerima dihitung KLIEN: wali kelas, Guru BK, guru wali, guru yang mengajar
-- hari ini (Guru BK tidak termasuk daftar Romo; guru piket tidak ada); orang tua juga dapat berkomentar di posting apa pun yang dapat dibacanya.
--
-- Perubahan:
--  1. fn_izin_ortu_penerima(student, tanggal): satu-satunya sumber daftar penerima (dipakai penghitung izin dan validator).
--  2. fn_validate_parent_forum_audience: penerima posting orang tua harus anggota daftar itu (Guru BK dikeluarkan, guru piket ditambahkan).
--  3. fn_create_izin_ortu(student, alasan, keterangan, kunci): satu-satunya jalan bagi ORTU membuat posting; penerima dihitung di server; judul dan isi disusun server.
--  4. Pemicu BEFORE INSERT pada forum_posts: ORTU tidak dapat membuat posting dengan cara lain (mis. memanggil fn_create_forum_post langsung).
--  5. Orang tua hanya dapat berkomentar pada posting yang ia tulis sendiri (izinnya); pengumuman dan pesan guru kepadanya tidak dapat dikomentari orang tua.

CREATE OR REPLACE FUNCTION public.fn_izin_ortu_penerima(p_student_id uuid, p_tanggal date)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH s AS (
        SELECT st.student_id, st.school_id, sc.current_academic_year AS yr, sc.current_semester::text AS sem
        FROM public.students st
        JOIN public.school_config sc ON sc.school_id = st.school_id
        WHERE st.student_id = p_student_id
    ), e AS (
        SELECT ce.class_id
        FROM public.class_enrollments ce, s
        WHERE ce.student_id = s.student_id AND ce.school_id = s.school_id
          AND ce.academic_year = s.yr AND ce.withdrawn_at IS NULL
        ORDER BY (ce.semester::text = s.sem) DESC
        LIMIT 1
    ), r AS (
        -- (a) wali kelas anak
        SELECT u.user_id AS uid
        FROM public.users u, e, s
        WHERE u.school_id = s.school_id AND u.wali_kelas_class_id = e.class_id
        UNION
        -- (b) guru wali anak
        SELECT gwa.guru_user_id
        FROM public.guru_wali_assignments gwa, s
        WHERE gwa.school_id = s.school_id AND gwa.student_id = s.student_id
          AND gwa.academic_year = s.yr AND gwa.is_active IS TRUE
        UNION
        -- (c) guru piket yang bertugas pada hari itu (hari dalam minggu, semester berjalan)
        SELECT ds.user_id
        FROM public.duty_schedules ds, s
        WHERE ds.school_id = s.school_id AND ds.academic_year = s.yr AND ds.semester::text = s.sem
          AND ds.is_active IS TRUE
          AND ds.day_of_week::text = (ARRAY['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'])[EXTRACT(ISODOW FROM p_tanggal)::int]
        UNION
        -- (d) guru yang mengajar kelas anak pada hari itu
        SELECT ts.scheduled_teacher_id
        FROM public.teaching_schedules ts, e, s
        WHERE ts.school_id = s.school_id AND ts.class_id = e.class_id
          AND ts.session_date = p_tanggal AND ts.scheduled_teacher_id IS NOT NULL
    )
    SELECT COALESCE(array_agg(DISTINCT r.uid), ARRAY[]::uuid[])
    FROM r
    JOIN public.users u ON u.user_id = r.uid AND u.is_active IS TRUE AND u.deleted_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.fn_izin_ortu_penerima(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_izin_ortu_penerima(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_validate_parent_forum_audience()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_author_id           uuid;
    v_school_id           uuid;
    v_subject_student_ids uuid[];
    v_today               date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
    SELECT fp.author_user_id, fp.school_id
      INTO v_author_id, v_school_id
    FROM public.forum_posts fp
    WHERE fp.post_id = NEW.post_id;

    SELECT array_agg(fps.student_id)
      INTO v_subject_student_ids
    FROM public.forum_post_subjects fps
    WHERE fps.post_id = NEW.post_id;

    IF v_author_id IS NULL
       OR public.fn_current_user_role() IS DISTINCT FROM 'ORTU'
       OR v_author_id <> public.fn_current_user_id()
       OR NEW.user_id = v_author_id
    THEN
        RETURN NEW;
    END IF;

    -- Penerima harus termasuk daftar izin untuk salah satu anak subjek (atau, bila tanpa subjek, salah satu anak pengirim).
    IF NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(
                 v_subject_student_ids,
                 (SELECT array_agg(sp.student_id) FROM public.student_parents sp
                   WHERE sp.parent_user_id = v_author_id AND sp.school_id = v_school_id)
             )) AS sid
        WHERE EXISTS (
                  SELECT 1 FROM public.student_parents sp
                  WHERE sp.parent_user_id = v_author_id AND sp.student_id = sid AND sp.school_id = v_school_id)
          AND NEW.user_id = ANY (public.fn_izin_ortu_penerima(sid, v_today))
    ) THEN
        RAISE EXCEPTION 'Penerima forum orang tua harus wali kelas, guru wali, guru piket hari ini, atau guru yang mengajar anak pada hari ini.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_izin_ortu(
    p_student_id uuid, p_alasan text, p_keterangan text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller     uuid := public.fn_current_user_id();
    v_school     uuid := public.fn_current_school_id();
    v_role       text := public.fn_current_user_role()::text;
    v_today      date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date;
    v_year       text;
    v_nama       text;
    v_alasan     text;
    v_ket        text := NULLIF(btrim(COALESCE(p_keterangan, '')), '');
    v_recipients uuid[];
    v_post       uuid;
BEGIN
    IF v_caller IS NULL OR v_school IS NULL OR v_role IS DISTINCT FROM 'ORTU' THEN
        RAISE EXCEPTION 'Hanya orang tua yang dapat mengirim izin ketidakhadiran.' USING ERRCODE = '42501';
    END IF;
    IF p_student_id IS NULL THEN
        RAISE EXCEPTION 'Anak wajib dipilih.' USING ERRCODE = '22004';
    END IF;

    v_alasan := CASE upper(btrim(COALESCE(p_alasan, '')))
                    WHEN 'SAKIT' THEN 'Sakit' WHEN 'IZIN' THEN 'Izin' WHEN 'LAINNYA' THEN 'Lainnya' ELSE NULL END;
    IF v_alasan IS NULL THEN
        RAISE EXCEPTION 'Alasan harus Sakit, Izin, atau Lainnya.' USING ERRCODE = '22023';
    END IF;
    IF char_length(COALESCE(v_ket, '')) > 1000 THEN
        RAISE EXCEPTION 'Keterangan terlalu panjang (maks. 1000 karakter).' USING ERRCODE = '22001';
    END IF;

    -- Anak harus anak pengirim, aktif, di sekolah yang sama.
    SELECT s.full_name INTO v_nama
    FROM public.students s
    JOIN public.student_parents sp ON sp.student_id = s.student_id AND sp.school_id = v_school AND sp.parent_user_id = v_caller
    WHERE s.student_id = p_student_id AND s.school_id = v_school AND s.student_status = 'AKTIF';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Anak tidak ditemukan atau bukan anak Anda.' USING ERRCODE = '42501';
    END IF;

    SELECT sc.current_academic_year INTO v_year FROM public.school_config sc WHERE sc.school_id = v_school;
    v_recipients := public.fn_izin_ortu_penerima(p_student_id, v_today);
    IF COALESCE(cardinality(v_recipients), 0) = 0 THEN
        RAISE EXCEPTION 'Tidak ada guru penerima yang dapat ditemukan hari ini untuk anak ini.' USING ERRCODE = 'P0002';
    END IF;

    -- Izinkan pembuatan posting oleh ORTU hanya selama pemanggilan ini (dibaca pemicu fn_forum_posts_guard_insert_ortu; berlaku sampai akhir transaksi).
    PERFORM set_config('app.izin_ortu', 'on', true);
    v_post := public.fn_create_forum_post(
        NULL::uuid, v_year,
        'Alasan: ' || v_alasan || E'\n\nKeterangan: ' || COALESCE(v_ket, '-'),
        NULL::text, ARRAY[p_student_id], 'ORANG_TERTENTU', v_recipients, NULL::text, ARRAY[]::uuid[], 'SEKOLAH',
        'Izin ketidakhadiran - ' || v_nama || ' - ' || to_char(v_today, 'DD-MM-YYYY'),
        p_idempotency_key);
    PERFORM set_config('app.izin_ortu', 'off', true);

    -- Jalur posting lingkup sekolah tidak mencatat subjek siswa (akar temuan A-02); catat anak pada izin ini secara eksplisit.
    INSERT INTO public.forum_post_subjects (post_id, student_id, school_id)
    VALUES (v_post, p_student_id, v_school)
    ON CONFLICT DO NOTHING;

    RETURN v_post;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_create_izin_ortu(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_izin_ortu(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_forum_posts_guard_insert_ortu()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF public.fn_current_user_role()::text = 'ORTU'
       AND COALESCE(current_setting('app.izin_ortu', true), 'off') <> 'on' THEN
        RAISE EXCEPTION 'Orang tua hanya dapat mengirim izin ketidakhadiran.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_forum_posts_guard_insert_ortu ON public.forum_posts;
CREATE TRIGGER trg_forum_posts_guard_insert_ortu
    BEFORE INSERT ON public.forum_posts
    FOR EACH ROW EXECUTE FUNCTION public.fn_forum_posts_guard_insert_ortu();

ALTER POLICY rls_forum_comments_insert ON public.forum_post_comments
    WITH CHECK (
        school_id = public.fn_current_school_id()
        AND author_user_id = public.fn_current_user_id()
        AND public.fn_can_read_forum_post(post_id)
        AND public.fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type,
            'ADMINISTRATIVE'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ORTU'::role_type, 'TU'::role_type])
        AND (public.fn_current_user_role() <> 'ORTU'::role_type
             OR EXISTS (SELECT 1 FROM public.forum_posts p
                        WHERE p.post_id = forum_post_comments.post_id AND p.author_user_id = public.fn_current_user_id()))
    );
