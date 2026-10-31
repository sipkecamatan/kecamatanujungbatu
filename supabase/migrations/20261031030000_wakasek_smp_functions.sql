-- Lanjutan 20261031010000 yang gagal karena enum WAKASEK belum ter-commit
-- saat dipakai dalam transaksi yang sama (error 55P04).
-- WAKASEK enum sudah ada di DB (ALTER TYPE tidak bisa di-rollback).
-- fn_is_waka_humas sudah benar via 20261031020000 (tanpa WAKASEK).
-- Migration ini menerapkan semua perubahan yang tersisa.

-- ── 1. Unique index: satu WAKASEK aktif per sekolah ──────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_wakasek_active
    ON public.users (school_id)
    WHERE role_type = 'WAKASEK' AND is_active = true AND deleted_at IS NULL;

-- ── 2. fn_is_waka_kesiswaan ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_waka_kesiswaan()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_KESISWAAN' OR u.role_type = 'WAKASEK' OR u.is_waka_kesiswaan)
    );
$function$;

-- ── 3. fn_is_waka_kurikulum ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_waka_kurikulum()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_KURIKULUM' OR u.role_type = 'WAKASEK' OR u.is_waka_kurikulum)
    );
$function$;

-- ── 4. fn_is_schoolwide_observer ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_schoolwide_observer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND ( u.role_type IN ('BK','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKASEK')
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kurikulum OR u.is_waka_kesiswaan )
    );
$function$;

-- ── 5. fn_can_read_forum_post ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_class_id      UUID;
    v_academic_year TEXT;
    v_visibility    TEXT;
    v_author_id     UUID;
    v_school_id     UUID;
    v_is_withdrawn  BOOLEAN;
    v_scope_type    TEXT;
    v_caller_id     UUID := fn_current_user_id();
BEGIN
    SELECT fp.class_id, fp.academic_year, fp.visibility,
           fp.author_user_id, fp.school_id, fp.is_withdrawn,
           fp.scope_type
    INTO   v_class_id, v_academic_year, v_visibility,
           v_author_id, v_school_id, v_is_withdrawn,
           v_scope_type
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    IF v_is_withdrawn THEN
        RETURN v_caller_id = v_author_id
            OR fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'WAKASEK', 'ADMINISTRATIVE')
            OR EXISTS (
                SELECT 1 FROM users u
                WHERE  u.user_id   = v_caller_id
                  AND  u.school_id = v_school_id
                  AND  (u.is_kepsek = true OR u.is_waka_kesiswaan = true)
                  AND  u.is_active = true AND u.deleted_at IS NULL
            );
    END IF;

    IF v_scope_type = 'SEKOLAH' THEN
        IF v_author_id = v_caller_id THEN RETURN true; END IF;
        RETURN EXISTS (
            SELECT 1
            FROM   public.forum_post_audience fpa
            JOIN   public.users u ON u.user_id = fpa.user_id
            WHERE  fpa.post_id   = p_post_id
              AND  fpa.user_id   = v_caller_id
              AND  u.is_active   = true
              AND  u.deleted_at IS NULL
        );
    END IF;

    IF fn_current_user_id() = v_author_id THEN RETURN true; END IF;

    IF fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'WAKASEK', 'ADMINISTRATIVE')
       OR EXISTS (
           SELECT 1 FROM users u
           WHERE  u.user_id   = fn_current_user_id()
             AND  u.school_id = v_school_id
             AND  (u.is_waka_kesiswaan = true OR u.is_kepsek = true)
             AND  u.is_active = true AND u.deleted_at IS NULL
       )
    THEN RETURN true; END IF;

    IF EXISTS (
        SELECT 1
        FROM   users u
        JOIN   classes c ON c.class_id = v_class_id
        WHERE  u.user_id   = fn_current_user_id()
          AND  u.school_id = v_school_id
          AND  u.is_active = true
          AND  u.deleted_at IS NULL
          AND  (u.program_id = c.program_id
                OR u.kaprodi_program_id = c.program_id)
          AND  c.program_id IS NOT NULL
    ) THEN RETURN true; END IF;

    RETURN EXISTS (
        SELECT 1
        FROM   public.forum_post_audience fpa
        JOIN   public.users u ON u.user_id = fpa.user_id
        WHERE  fpa.post_id   = p_post_id
          AND  fpa.user_id   = v_caller_id
          AND  u.is_active   = true
          AND  u.deleted_at IS NULL
    );
END;
$function$;

-- ── 6. fn_class_attendance_summary ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_class_attendance_summary(p_class_id uuid, p_academic_year text, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date, p_teacher_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, full_name text, nis text, hadir bigint, alpa bigint, izin bigint, sakit bigint, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active
          AND u.role_type IN ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
                              'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','WAKASEK')
    ) THEN
        RAISE EXCEPTION 'Tidak berwenang membaca rekap absensi' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        s.student_id,
        s.full_name::text,
        s.nis::text,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END)
    FROM public.class_enrollments ce
    JOIN public.students s ON s.student_id = ce.student_id
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = p_class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = p_academic_year
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
          AND (p_teacher_id IS NULL OR ts.scheduled_teacher_id = p_teacher_id)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND a.student_id = s.student_id
          AND a.school_id = public.fn_current_school_id()
          AND NOT a.is_void
    WHERE ce.class_id = p_class_id
      AND ce.school_id = public.fn_current_school_id()
      AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL
      AND s.student_status = 'AKTIF'
      AND s.school_id = public.fn_current_school_id()
      AND public.fn_can_see_student(s.student_id)
    GROUP BY s.student_id, s.full_name, s.nis
    ORDER BY s.full_name;
END;
$function$;

-- ── 7. fn_create_forum_post ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_forum_post(p_class_id uuid, p_academic_year text, p_content text, p_category_code text DEFAULT NULL::text, p_subject_student_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type text DEFAULT 'STAF_SAJA'::text, p_specific_user_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type_2 text DEFAULT NULL::text, p_specific_user_ids_2 uuid[] DEFAULT '{}'::uuid[], p_scope_type text DEFAULT 'KELAS'::text, p_title text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id      UUID   := fn_current_user_id();
    v_school_id      UUID   := fn_current_school_id();
    v_post_id        UUID   := gen_random_uuid();
    v_category_id    UUID;
    v_visibility     TEXT;
    v_title          TEXT;
    v_author_name    TEXT;
    v_class_name     TEXT;
    v_audience_ids   UUID[] := ARRAY[]::UUID[];
    v_audience_ids_2 UUID[] := ARRAY[]::UUID[];
    v_caller_role    TEXT;
    v_existing_id    UUID;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT fp.post_id INTO v_existing_id
        FROM   forum_posts fp
        WHERE  fp.school_id       = v_school_id
          AND  fp.author_user_id  = v_caller_id
          AND  fp.idempotency_key = p_idempotency_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    IF p_content IS NULL OR length(trim(p_content)) < 3 THEN
        RAISE EXCEPTION 'Isi posting minimal 3 karakter.';
    END IF;

    IF p_scope_type = 'SEKOLAH' THEN

        IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
            RAISE EXCEPTION 'Judul posting wajib diisi untuk forum sekolah.';
        END IF;

        v_title      := trim(p_title);
        v_visibility := 'INTERNAL';

        SELECT role_type INTO v_caller_role FROM users WHERE user_id = v_caller_id;

        IF v_caller_role IS NULL OR v_caller_role NOT IN (
            'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
            'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS', 'WAKASEK',
            'KEPSEK', 'TU', 'ADMINISTRATIVE', 'ORTU'
        ) THEN
            RAISE EXCEPTION
                'Akses ditolak: peran "%" tidak diizinkan membuat posting forum sekolah.',
                coalesce(v_caller_role, '(tidak dikenal)')
                USING ERRCODE = 'P0001';
        END IF;

        IF p_category_code IS NOT NULL AND trim(p_category_code) <> '' THEN
            SELECT category_id INTO v_category_id
            FROM   communication_categories
            WHERE  category_code = p_category_code AND is_active = true;
        END IF;

        BEGIN
            INSERT INTO forum_posts (
                post_id, school_id, class_id, category_id, author_user_id,
                academic_year, title, body, visibility,
                audience_type, audience_type_2, scope_type, idempotency_key
            ) VALUES (
                v_post_id, v_school_id, NULL, v_category_id, v_caller_id,
                p_academic_year, v_title, p_content, v_visibility,
                p_audience_type, p_audience_type_2, 'SEKOLAH', p_idempotency_key
            );
        EXCEPTION WHEN unique_violation THEN
            SELECT fp.post_id INTO v_existing_id
            FROM   forum_posts fp
            WHERE  fp.school_id       = v_school_id
              AND  fp.author_user_id  = v_caller_id
              AND  fp.idempotency_key = p_idempotency_key;
            IF v_existing_id IS NOT NULL THEN
                RETURN v_existing_id;
            END IF;
            RAISE;
        END;

        v_audience_ids :=
            ARRAY(
                SELECT DISTINCT uid
                FROM unnest(
                    COALESCE(p_specific_user_ids,   ARRAY[]::UUID[]) ||
                    COALESCE(p_specific_user_ids_2, ARRAY[]::UUID[])
                ) AS uid
                WHERE EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.user_id    = uid
                      AND u.school_id  = v_school_id
                      AND u.is_active  = true
                      AND u.deleted_at IS NULL
                      AND u.role_type IN (
                          'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
                          'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS', 'WAKASEK',
                          'KEPSEK', 'TU', 'ADMINISTRATIVE',
                          'SISWA', 'ORTU'
                      )
                )
            ) || ARRAY[v_caller_id];

        IF array_length(v_audience_ids, 1) <= 1 THEN
            RAISE EXCEPTION 'Tidak ada penerima valid yang ditemukan di sekolah ini.';
        END IF;

        INSERT INTO forum_post_audience (post_id, user_id, school_id)
        SELECT DISTINCT v_post_id, uid, v_school_id
        FROM   unnest(v_audience_ids) uid
        WHERE  uid IS NOT NULL
        ON CONFLICT DO NOTHING;

        SELECT full_name INTO v_author_name FROM users WHERE user_id = v_caller_id;

        INSERT INTO notifications (
            school_id, recipient_user_id, type, title, body, forum_post_id
        )
        SELECT
            v_school_id,
            fpa.user_id,
            'FORUM_POST_NEW',
            format(
                CASE WHEN v_caller_role = 'ORTU' THEN 'Kabar Ortu: %s' ELSE 'Pengumuman: %s' END,
                v_title
            ),
            format('%s', v_author_name),
            v_post_id
        FROM   forum_post_audience fpa
        WHERE  fpa.post_id = v_post_id
          AND  fpa.user_id != v_caller_id
        ON CONFLICT DO NOTHING;

        RETURN v_post_id;
    END IF;

    SELECT c.name INTO v_class_name FROM classes c WHERE c.class_id = p_class_id AND c.school_id = v_school_id;
    IF v_class_name IS NULL THEN
        RAISE EXCEPTION 'Kelas tidak ditemukan di sekolah ini.' USING ERRCODE = 'P0002';
    END IF;

    SELECT role_type INTO v_caller_role FROM users WHERE user_id = v_caller_id;

    v_visibility := CASE
        WHEN p_audience_type IN ('SISWA_SAJA','ORTU_SAJA','SISWA_DAN_ORTU') THEN 'EXTERNAL'
        ELSE 'INTERNAL'
    END;

    IF p_category_code IS NOT NULL AND trim(p_category_code) <> '' THEN
        SELECT category_id INTO v_category_id
        FROM   communication_categories
        WHERE  category_code = p_category_code AND is_active = true;
    END IF;

    BEGIN
        INSERT INTO forum_posts (
            post_id, school_id, class_id, category_id, author_user_id,
            academic_year, body, visibility, audience_type, audience_type_2,
            scope_type, idempotency_key
        ) VALUES (
            v_post_id, v_school_id, p_class_id, v_category_id, v_caller_id,
            p_academic_year, p_content, v_visibility, p_audience_type, p_audience_type_2,
            'KELAS', p_idempotency_key
        );
    EXCEPTION WHEN unique_violation THEN
        SELECT fp.post_id INTO v_existing_id
        FROM   forum_posts fp
        WHERE  fp.school_id       = v_school_id
          AND  fp.author_user_id  = v_caller_id
          AND  fp.idempotency_key = p_idempotency_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
        RAISE;
    END;

    v_audience_ids := ARRAY(
        SELECT fn_get_forum_members(p_class_id, p_academic_year, v_visibility)
    );

    IF p_subject_student_ids IS NOT NULL AND cardinality(p_subject_student_ids) > 0 THEN
        v_audience_ids := v_audience_ids || ARRAY(
            SELECT DISTINCT u.user_id
            FROM students s JOIN users u ON u.user_id = s.user_id
            WHERE s.student_id = ANY(p_subject_student_ids)
              AND s.school_id = v_school_id
        );
    END IF;

    IF p_specific_user_ids IS NOT NULL AND cardinality(p_specific_user_ids) > 0 THEN
        v_audience_ids_2 := ARRAY(
            SELECT DISTINCT uid FROM unnest(p_specific_user_ids) uid
            WHERE EXISTS (SELECT 1 FROM users u WHERE u.user_id = uid AND u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL)
        );
    END IF;

    IF p_specific_user_ids_2 IS NOT NULL AND cardinality(p_specific_user_ids_2) > 0 THEN
        v_audience_ids_2 := v_audience_ids_2 || ARRAY(
            SELECT DISTINCT uid FROM unnest(p_specific_user_ids_2) uid
            WHERE EXISTS (SELECT 1 FROM users u WHERE u.user_id = uid AND u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL)
        );
    END IF;

    v_audience_ids := ARRAY(SELECT DISTINCT unnest(v_audience_ids || v_audience_ids_2));

    IF v_caller_id IS NOT NULL AND NOT (v_caller_id = ANY(v_audience_ids)) THEN
        v_audience_ids := v_audience_ids || ARRAY[v_caller_id];
    END IF;

    INSERT INTO forum_post_audience (post_id, user_id, school_id)
    SELECT DISTINCT v_post_id, uid, v_school_id
    FROM   unnest(v_audience_ids) uid
    WHERE  uid IS NOT NULL
    ON CONFLICT DO NOTHING;

    SELECT full_name INTO v_author_name FROM users WHERE user_id = v_caller_id;
    SELECT c.name INTO v_class_name FROM classes c WHERE c.class_id = p_class_id;

    INSERT INTO notifications (school_id, recipient_user_id, type, title, body, forum_post_id)
    SELECT v_school_id, fpa.user_id, 'FORUM_POST_NEW',
           format('Pesan baru di kelas %s', v_class_name),
           format('%s', v_author_name),
           v_post_id
    FROM   forum_post_audience fpa
    WHERE  fpa.post_id = v_post_id
      AND  fpa.user_id != v_caller_id
    ON CONFLICT DO NOTHING;

    RETURN v_post_id;
END;
$function$;

-- ── 8. fn_delete_forum_post ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_delete_forum_post(p_post_id uuid)
 RETURNS TABLE(deleted_post_id uuid, attachment_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller    uuid := public.fn_current_user_id();
    v_school    uuid := public.fn_current_school_id();
    v_author    uuid;
    v_path      text;
    v_moderator boolean := false;
BEGIN
    IF p_post_id IS NULL THEN
        RAISE EXCEPTION 'post_id wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    SELECT fp.author_user_id, fp.attachment_path
    INTO   v_author, v_path
    FROM   public.forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = v_school;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id    = v_caller
          AND u.school_id  = v_school
          AND u.is_active  = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'WAKASEK', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    IF v_caller IS DISTINCT FROM v_author AND NOT v_moderator THEN
        RAISE EXCEPTION 'Akses ditolak: hanya penulis atau moderator yang dapat menghapus posting.'
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.notifications
    WHERE forum_post_id = p_post_id
      AND school_id     = v_school;

    DELETE FROM public.forum_posts
    WHERE post_id   = p_post_id
      AND school_id = v_school;

    RETURN QUERY SELECT p_post_id, v_path;
END;
$function$;

-- ── 9. fn_forum_attachment_moderator ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_forum_attachment_moderator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users u
        WHERE u.user_id = fn_current_user_id() AND u.school_id = fn_current_school_id()
          AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND (u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'WAKASEK', 'ADMINISTRATIVE')
            OR u.is_kepsek IS TRUE OR u.is_waka_kesiswaan IS TRUE));
$function$;

-- ── 10. fn_get_forum_member_details ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_forum_member_details(p_class_id uuid, p_academic_year text)
 RETURNS TABLE(user_id uuid, full_name text, role_type text, student_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_school_id uuid := fn_current_school_id();
    v_school_id        uuid;
    v_program_id       uuid;
BEGIN
    SELECT c.school_id, c.program_id INTO v_school_id, v_program_id
    FROM public.classes c WHERE c.class_id = p_class_id;
    IF v_caller_school_id IS NULL OR v_school_id IS DISTINCT FROM v_caller_school_id THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.wali_kelas_class_id = p_class_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.teaching_assignments ta JOIN public.users u ON u.user_id = ta.user_id
    WHERE ta.class_id = p_class_id AND ta.academic_year = p_academic_year
      AND ta.is_active IS TRUE AND ta.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.guru_wali_assignments gwa JOIN public.users u ON u.user_id = gwa.guru_user_id
    WHERE gwa.academic_year = p_academic_year AND gwa.is_active IS TRUE
      AND gwa.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND gwa.student_id IN (
          SELECT ce.student_id FROM public.class_enrollments ce
          WHERE ce.class_id = p_class_id AND ce.academic_year = p_academic_year
            AND ce.withdrawn_at IS NULL AND ce.school_id = v_school_id
      )
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.bk_class_assignments bca JOIN public.users u ON u.user_id = bca.bk_user_id
    WHERE bca.class_id = p_class_id AND bca.academic_year = p_academic_year
      AND bca.is_active IS TRUE AND bca.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND (u.role_type IN ('WAKA_KESISWAAN', 'WAKASEK', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kesiswaan IS TRUE OR u.is_kepsek IS TRUE)
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND v_program_id IS NOT NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND (u.program_id = v_program_id OR u.kaprodi_program_id = v_program_id)
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, s.full_name::text
    FROM public.student_parents sp
    JOIN public.students s ON s.student_id = sp.student_id
    JOIN public.class_enrollments ce ON ce.student_id = s.student_id
    JOIN public.users u ON u.user_id = sp.parent_user_id
    WHERE ce.class_id = p_class_id AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL AND ce.school_id = v_school_id
      AND sp.school_id = v_school_id AND s.school_id = v_school_id
      AND s.student_status = 'AKTIF'
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
    ORDER BY full_name;
END;
$function$;

-- ── 11. fn_get_forum_recipient_candidates ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_forum_recipient_candidates(p_target_group text, p_program_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_day_of_week smallint DEFAULT NULL::smallint, p_academic_year text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, full_name text, role_label text, extra_info text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_school_id  uuid        := fn_current_school_id();
  v_acad_year  text        := COALESCE(p_academic_year,
    to_char(now(), 'YYYY') || '/' || to_char(now() + interval '1 year', 'YYYY'));
  v_day_enum   day_of_week;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.school_id = v_school_id
      AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type IN (
        'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
        'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS', 'WAKASEK',
        'KEPSEK', 'TU', 'ADMINISTRATIVE'
      )
  ) THEN
    RAISE EXCEPTION 'Akses kandidat penerima forum hanya untuk staf aktif.'
      USING ERRCODE = '42501';
  END IF;

  IF p_day_of_week IS NOT NULL THEN
    v_day_enum := CASE p_day_of_week
      WHEN 1 THEN 'SENIN'
      WHEN 2 THEN 'SELASA'
      WHEN 3 THEN 'RABU'
      WHEN 4 THEN 'KAMIS'
      WHEN 5 THEN 'JUMAT'
      WHEN 6 THEN 'SABTU'
    END::day_of_week;
  END IF;

  IF p_target_group = 'SEMUA_GURU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type = 'GURU';

  ELSIF p_target_group = 'GURU_MAPEL' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type = 'GURU'
        AND (p_program_id IS NULL OR u.program_id = p_program_id);

  ELSIF p_target_group = 'SEMUA_GURU_WALI' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'GURU_WALI'::text, NULL::text
      FROM public.users u
      JOIN public.guru_wali_assignments gwa ON gwa.guru_user_id = u.user_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND gwa.school_id = v_school_id AND gwa.is_active = true
        AND gwa.academic_year = v_acad_year;

  ELSIF p_target_group = 'SEMUA_WALI_KELAS' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text, c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL AND c.is_active = true;

  ELSIF p_target_group = 'WALI_KELAS_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text, c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL AND c.program_id = p_program_id AND c.is_active = true;

  ELSIF p_target_group = 'SEMUA_KAPRODI' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text, pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.kaprodi_program_id IS NOT NULL;

  ELSIF p_target_group = 'KAPRODI_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text, pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.kaprodi_program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_BK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'BK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.is_bk = true;

  ELSIF p_target_group = 'SEMUA_WAKA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text,
             CASE
               WHEN u.role_type = 'WAKASEK'    THEN 'WAKASEK'
               WHEN u.is_waka_kurikulum         THEN 'WAKA_KURIKULUM'
               WHEN u.is_waka_kesiswaan         THEN 'WAKA_KESISWAAN'
               WHEN u.is_waka_humas             THEN 'WAKA_HUMAS'
               ELSE u.role_type
             END::text,
             NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND (u.role_type = 'WAKASEK'
          OR u.is_waka_kurikulum = true OR u.is_waka_kesiswaan = true
          OR u.is_waka_humas = true
          OR u.role_type IN ('WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'));

  ELSIF p_target_group = 'KEPSEK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KEPSEK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND (u.is_kepsek = true OR u.role_type = 'KEPSEK');

  ELSIF p_target_group = 'SEMUA_TU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'TU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type IN ('TU','ADMINISTRATIVE');

  ELSIF p_target_group = 'SEMUA_SISWA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, NULL::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF';

  ELSIF p_target_group IN ('SISWA_KELAS', 'SISWA_PER_KELAS') THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, c.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id AND ce.academic_year = v_acad_year AND ce.withdrawn_at IS NULL;

  ELSIF p_target_group IN ('SISWA_JURUSAN', 'SISWA_PER_JURUSAN') THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, pr.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF' AND s.program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_ORTU' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, NULL::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF' AND sp.school_id = v_school_id;

  ELSIF p_target_group IN ('ORTU_KELAS', 'ORTU_PER_KELAS') THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, c.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id AND ce.academic_year = v_acad_year AND ce.withdrawn_at IS NULL
        AND sp.school_id = v_school_id;

  ELSIF p_target_group IN ('ORTU_JURUSAN', 'ORTU_PER_JURUSAN') THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, pr.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF' AND s.program_id = p_program_id
        AND sp.school_id = v_school_id;

  ELSIF p_target_group = 'GURU_PIKET' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'GURU_PIKET'::text, ds.day_of_week::text
      FROM public.users u
      JOIN public.duty_schedules ds ON ds.user_id = u.user_id
      WHERE u.school_id = v_school_id AND u.is_active = true AND u.deleted_at IS NULL
        AND ds.school_id = v_school_id AND ds.academic_year = v_acad_year AND ds.is_active = true
        AND (v_day_enum IS NULL OR ds.day_of_week = v_day_enum);

  END IF;
END;
$function$;

-- ── 12. fn_notify_on_case_event ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_on_case_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_case      RECORD;
    v_actor_name TEXT;
    v_title     TEXT;
    v_body      TEXT;
BEGIN
    SELECT cc.school_id, cc.case_id, cc.title, cc.audience, cc.student_id
    INTO   v_case
    FROM   coaching_cases cc
    WHERE  cc.case_id = NEW.case_id;

    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT full_name INTO v_actor_name FROM users WHERE user_id = NEW.author_user_id;

    IF NEW.event_type = 'DECISION_ESCALATE' AND NEW.handler_user_id IS NOT NULL THEN
        INSERT INTO notifications (school_id, recipient_user_id, case_id, type, title, body)
        VALUES (
            v_case.school_id, NEW.handler_user_id, v_case.case_id,
            'CASE_ASSIGNED',
            format('Kasus diteruskan kepada Anda'),
            format('%s — kasus "%s"', coalesce(v_actor_name,'Seseorang'), v_case.title)
        )
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_case.audience = 'PUBLIC'
       AND NEW.event_type IN (
           'COMMENT_ADDED','DECISION_ESCALATE','DECISION_CLOSE','STATUS_CHANGED'
       )
    THEN
        v_title := CASE NEW.event_type
            WHEN 'COMMENT_ADDED'     THEN 'Komentar baru di kasus'
            WHEN 'DECISION_ESCALATE' THEN 'Kasus diteruskan ke handler baru'
            WHEN 'DECISION_CLOSE'    THEN 'Kasus ditutup'
            WHEN 'STATUS_CHANGED'    THEN 'Status kasus berubah'
            ELSE                          'Update kasus'
        END;
        v_body  := format('%s — kasus "%s"',
                          coalesce(v_actor_name,'Seseorang'), v_case.title);
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT v_case.school_id, u.user_id, v_case.case_id,
               'CASE_BROADCAST', v_title, v_body
        FROM   users u
        WHERE  u.school_id = v_case.school_id
          AND  u.role_type IN (
              'GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKASEK','KEPSEK'
          )
          AND  u.is_active  = true
          AND  u.deleted_at IS NULL
          AND  u.user_id   != NEW.author_user_id;
    END IF;

    IF NEW.event_type IN ('STATUS_CHANGED','DECISION_CLOSE')
       AND v_case.student_id IS NOT NULL
    THEN
        INSERT INTO notifications (school_id, recipient_user_id, case_id, type, title, body)
        SELECT v_case.school_id, sp.parent_user_id, v_case.case_id,
               'CASE_UPDATE',
               CASE NEW.event_type WHEN 'DECISION_CLOSE' THEN 'Kasus selesai' ELSE 'Update kasus' END,
               format('%s', v_case.title)
        FROM student_parents sp
        WHERE sp.student_id = v_case.student_id
          AND sp.school_id  = v_case.school_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$function$;

-- ── 13. fn_pending_attendance_sessions ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pending_attendance_sessions(p_date date DEFAULT NULL::date)
 RETURNS TABLE(teacher_id uuid, session_start time without time zone, session_end time without time zone, teacher_name text, subject_name text, class_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'WAKASEK', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ts.scheduled_teacher_id, ts.session_start::time, ts.session_end::time,
        u.full_name::text, s.name::text, c.name::text
    FROM public.teaching_schedules ts
    JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
    JOIN public.subjects s ON s.subject_id = ts.subject_id
    JOIN public.classes c ON c.class_id = ts.class_id
    WHERE ts.school_id = v_school_id
      AND ts.meeting_status = 'NORMAL'
      AND (p_date IS NULL OR ts.session_date = p_date)
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
    ORDER BY u.full_name, ts.session_start;
END;
$function$;

-- ── 14. fn_pending_sessions_by_teacher ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pending_sessions_by_teacher(p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(teacher_id uuid, teacher_name text, jumlah bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'WAKASEK', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    SELECT u.user_id, u.full_name::text, count(*)
    FROM public.teaching_schedules ts
    JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
    WHERE ts.school_id = v_school_id
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    GROUP BY u.user_id, u.full_name
    ORDER BY count(*) DESC, u.full_name;
END;
$function$;

-- ── 15. fn_pending_sessions_detail ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pending_sessions_detail(p_teacher_id uuid, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(session_date date, session_start time without time zone, session_end time without time zone, subject_name text, class_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'WAKASEK', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    SELECT ts.session_date, ts.session_start::time, ts.session_end::time, s.name::text, c.name::text
    FROM public.teaching_schedules ts
    JOIN public.subjects s ON s.subject_id = ts.subject_id
    JOIN public.classes c ON c.class_id = ts.class_id
    WHERE ts.school_id = v_school_id
      AND ts.scheduled_teacher_id = p_teacher_id
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ORDER BY ts.session_date, ts.session_start;
END;
$function$;

-- ── 16. fn_school_staff_health ────────────────────────────────────────────────
-- WAKASEK dihitung di waka_kurikulum_count dan waka_kesiswaan_count,
-- TIDAK di waka_humas_count (keputusan 31 Okt: WAKASEK = kesiswaan+kurikulum saja).
CREATE OR REPLACE FUNCTION public.fn_school_staff_health()
 RETURNS TABLE(school_id uuid, kepsek_count bigint, waka_kurikulum_count bigint, waka_kesiswaan_count bigint, waka_humas_count bigint, wakasek_count bigint, staff_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT school_id,
        COUNT(*) FILTER (WHERE role_type = 'KEPSEK' OR is_kepsek) AS kepsek_count,
        COUNT(*) FILTER (WHERE role_type IN ('WAKA_KURIKULUM','WAKASEK') OR is_waka_kurikulum) AS waka_kurikulum_count,
        COUNT(*) FILTER (WHERE role_type IN ('WAKA_KESISWAAN','WAKASEK') OR is_waka_kesiswaan) AS waka_kesiswaan_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_HUMAS' OR is_waka_humas) AS waka_humas_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKASEK') AS wakasek_count,
        COUNT(*) FILTER (WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')) AS staff_count
    FROM users WHERE is_active = TRUE AND deleted_at IS NULL GROUP BY school_id;
$function$;

-- ── 17. Data: pindahkan Syahrul Ramadhan ke WAKASEK ──────────────────────────
ALTER TABLE users DISABLE TRIGGER trg_guard_users_protected_columns;

UPDATE users
SET role_type = 'WAKASEK'
WHERE login_identifier = '199005272016031912'
  AND role_type = 'WAKA_KESISWAAN';

ALTER TABLE users ENABLE TRIGGER trg_guard_users_protected_columns;
