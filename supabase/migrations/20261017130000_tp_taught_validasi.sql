-- Audit Jurnal Mengajar A-08 (RENDAH): fn_toggle_tp_taught (SECURITY DEFINER) menerima kelas dan TP dari pemanggil tanpa memeriksa apa pun.
-- Akibatnya guru dapat menandai "sudah diajarkan" untuk TP yang bukan miliknya, TP yang tidak ada, atau TP kelas lain. Dampaknya hanya pada baris milik
-- guru itu sendiri (kebijakan tp_taught_status memeriksa pemilik), tetapi data yang tersimpan menyesatkan. Kini TP harus ada, milik guru pemanggil,
-- satu sekolah, dan benar-benar berada pada kelas yang dikirim.
CREATE OR REPLACE FUNCTION public.fn_toggle_tp_taught(p_class_id uuid, p_tp_id text, p_is_taught boolean)
 RETURNS TABLE(id uuid, teacher_id uuid, class_id uuid, tp_id text, school_id uuid, is_taught boolean, taught_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_teacher_id uuid := fn_current_user_id();
    v_school_id  uuid := fn_current_school_id();
BEGIN
    IF v_teacher_id IS NULL OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak ditemukan';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM learning_objectives lo
        WHERE lo.id::text = p_tp_id
          AND lo.teacher_id = v_teacher_id
          AND lo.school_id  = v_school_id
          AND lo.class_id   = p_class_id
    ) THEN
        RAISE EXCEPTION 'tp_not_owned: TP tidak ditemukan pada kelas ini atau bukan milik Anda' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    INSERT INTO tp_taught_status (teacher_id, class_id, tp_id, school_id, is_taught, taught_at, updated_at)
    VALUES (
        v_teacher_id,
        p_class_id,
        p_tp_id,
        v_school_id,
        p_is_taught,
        CASE WHEN p_is_taught THEN now() ELSE NULL END,
        now()
    )
    ON CONFLICT (teacher_id, class_id, tp_id) DO UPDATE
        SET is_taught  = EXCLUDED.is_taught,
            taught_at  = CASE WHEN EXCLUDED.is_taught THEN now() ELSE NULL END,
            updated_at = now()
    RETURNING
        tp_taught_status.id,
        tp_taught_status.teacher_id,
        tp_taught_status.class_id,
        tp_taught_status.tp_id,
        tp_taught_status.school_id,
        tp_taught_status.is_taught,
        tp_taught_status.taught_at,
        tp_taught_status.updated_at;
END;
$function$;
