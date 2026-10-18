-- Audit Forum (Codex, 17 Okt 2026), temuan A-01 dan A-03, terbukti di basis data live:
--  A-01  penulis dapat mengisi attachment_url dengan "javascript:..." lalu penerima menjalankan skrip saat mengeklik lampiran (portal guru, orang tua, siswa).
--  A-03  penulis dapat mengubah langsung is_pinned, is_withdrawn, deleted_at, category_id, dll.; kebijakan UPDATE hanya menjaga lima kolom dan hak UPDATE kolom
--        pada authenticated mencakup semua kolom.
-- Perbaikan: trigger BEFORE UPDATE yang berlaku HANYA bagi pemanggil langsung (current_user authenticated/anon, yaitu permintaan PostgREST). Fungsi SECURITY DEFINER
-- (fn_toggle_forum_post_withdrawn, fn_delete_forum_post, dll.), service_role, dan postgres tidak terpengaruh. Kolom yang masih boleh diubah penulis: title, body,
-- is_edited, edited_at, updated_at, attachment_name, dan attachment_path/attachment_url dengan syarat di bawah.
--  - attachment_url hanya boleh dikosongkan (klien selalu memakai attachment_path + signed URL; bucket bersifat private).
--  - attachment_path hanya boleh NULL atau berkas milik pemanggil di bucket forum-attachments dengan awalan sekolah sendiri (tanpa "..").

CREATE OR REPLACE FUNCTION public.fn_forum_attachment_owned(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND p_path IS NOT NULL
       AND public.fn_current_school_id() IS NOT NULL
       AND split_part(p_path, '/', 1) = public.fn_current_school_id()::text
       AND position('..' in p_path) = 0
       AND EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = 'forum-attachments'
              AND o.name = p_path
              AND o.owner_id = auth.uid()::text
       );
$function$;
REVOKE ALL ON FUNCTION public.fn_forum_attachment_owned(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_forum_attachment_owned(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_forum_posts_guard_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Hanya permintaan langsung dari klien (PostgREST). Fungsi SECURITY DEFINER berjalan sebagai pemilik fungsi, service_role/postgres lolos.
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    IF NEW.post_id          IS DISTINCT FROM OLD.post_id
       OR NEW.school_id        IS DISTINCT FROM OLD.school_id
       OR NEW.author_user_id   IS DISTINCT FROM OLD.author_user_id
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at
       OR NEW.scope_type       IS DISTINCT FROM OLD.scope_type
       OR NEW.class_id         IS DISTINCT FROM OLD.class_id
       OR NEW.visibility       IS DISTINCT FROM OLD.visibility
       OR NEW.academic_year    IS DISTINCT FROM OLD.academic_year
       OR NEW.audience_type    IS DISTINCT FROM OLD.audience_type
       OR NEW.audience_type_2  IS DISTINCT FROM OLD.audience_type_2
       OR NEW.category_id      IS DISTINCT FROM OLD.category_id
       OR NEW.idempotency_key  IS DISTINCT FROM OLD.idempotency_key
       OR NEW.is_pinned        IS DISTINCT FROM OLD.is_pinned
       OR NEW.is_withdrawn     IS DISTINCT FROM OLD.is_withdrawn
       OR NEW.deleted_at       IS DISTINCT FROM OLD.deleted_at
    THEN
        RAISE EXCEPTION 'Kolom posting ini tidak dapat diubah langsung.' USING ERRCODE = '42501';
    END IF;

    IF NEW.attachment_url IS DISTINCT FROM OLD.attachment_url AND NEW.attachment_url IS NOT NULL THEN
        RAISE EXCEPTION 'attachment_url tidak boleh diisi; gunakan attachment_path.' USING ERRCODE = '42501';
    END IF;

    IF NEW.attachment_path IS DISTINCT FROM OLD.attachment_path AND NEW.attachment_path IS NOT NULL
       AND NOT public.fn_forum_attachment_owned(NEW.attachment_path) THEN
        RAISE EXCEPTION 'Lampiran tidak valid: harus berkas milik Anda di folder sekolah ini.' USING ERRCODE = '42501';
    END IF;

    IF NEW.attachment_name IS DISTINCT FROM OLD.attachment_name AND length(coalesce(NEW.attachment_name, '')) > 255 THEN
        RAISE EXCEPTION 'Nama lampiran terlalu panjang (maks. 255 karakter).' USING ERRCODE = '22001';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_forum_posts_guard_update ON public.forum_posts;
CREATE TRIGGER trg_forum_posts_guard_update
    BEFORE UPDATE ON public.forum_posts
    FOR EACH ROW EXECUTE FUNCTION public.fn_forum_posts_guard_update();
