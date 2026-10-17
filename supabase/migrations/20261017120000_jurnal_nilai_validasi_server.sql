-- Audit Jurnal Mengajar A-02 dan A-06 (cacat pasti di sisi server).
--
-- A-02: kebijakan tulis `assessment_results` hanya memeriksa sekolah dan kepemilikan asesmen. `student_id` dan `class_id` tidak divalidasi,
--       sehingga guru dapat menulis nilai untuk siswa yang bukan di kelas asesmennya (bahkan siswa sekolah lain bila UUID-nya diketahui),
--       dan nilai itu lalu terbaca oleh siswa/orang tua pemilik `student_id` tersebut lewat portal. Trigger ini menegakkan: kelas hasil = kelas
--       asesmen, sekolah hasil = sekolah asesmen, dan siswa terdaftar di kelas itu pada tahun ajaran + semester asesmen.
--
-- A-06: batas tanggal jurnal (tidak di masa depan, tidak lebih dari setahun ke belakang) hanya ada di klien. Server menerima tanggal apa pun.
--       Trigger ini menegakkannya (hari ini = WIB). Penguncian periode akademik yang ditutup SENGAJA tidak dipasang di sini: itu pertanyaan
--       rancangan B-07 yang belum diputuskan pemilik produk.

CREATE OR REPLACE FUNCTION public.fn_assessment_result_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cls   uuid;
    v_sch   uuid;
    v_year  varchar;
    v_sem   integer;
BEGIN
    -- Pembaruan nilai pada baris yang kuncinya tidak berubah tidak diperiksa ulang
    -- (siswa yang kemudian pindah/keluar tidak boleh menghalangi koreksi nilai lama).
    IF TG_OP = 'UPDATE'
       AND NEW.assessment_id = OLD.assessment_id
       AND NEW.student_id    = OLD.student_id
       AND NEW.class_id      = OLD.class_id
       AND NEW.school_id     = OLD.school_id THEN
        RETURN NEW;
    END IF;

    SELECT a.class_id, a.school_id, a.academic_year, a.semester INTO v_cls, v_sch, v_year, v_sem
    FROM public.assessments a WHERE a.id = NEW.assessment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'assessment_not_found: asesmen tidak ditemukan' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.class_id IS DISTINCT FROM v_cls OR NEW.school_id IS DISTINCT FROM v_sch THEN
        RAISE EXCEPTION 'result_class_mismatch: kelas atau sekolah hasil tidak sesuai dengan asesmen' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.class_enrollments ce
        WHERE ce.student_id = NEW.student_id
          AND ce.class_id = v_cls
          AND ce.school_id = v_sch
          AND ce.academic_year = v_year
          AND ce.semester::text = v_sem::text
    ) THEN
        RAISE EXCEPTION 'student_not_in_class: siswa tidak terdaftar di kelas asesmen ini pada periodenya' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assessment_result_validate ON public.assessment_results;
CREATE TRIGGER trg_assessment_result_validate
    BEFORE INSERT OR UPDATE ON public.assessment_results
    FOR EACH ROW EXECUTE FUNCTION public.fn_assessment_result_validate();

CREATE OR REPLACE FUNCTION public.fn_teacher_journal_date_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_hari date := public.fn_hari_ini();
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.entry_date IS NOT DISTINCT FROM OLD.entry_date THEN
        RETURN NEW;   -- mengubah isi tanpa mengubah tanggal tidak diperiksa ulang
    END IF;
    IF NEW.entry_date > v_hari THEN
        RAISE EXCEPTION 'jurnal_tanggal: tanggal jurnal tidak boleh di masa depan' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.entry_date < (v_hari - interval '1 year')::date THEN
        RAISE EXCEPTION 'jurnal_tanggal: tanggal jurnal tidak boleh lebih dari satu tahun ke belakang' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_teacher_journal_date_check ON public.teacher_journals;
CREATE TRIGGER trg_teacher_journal_date_check
    BEFORE INSERT OR UPDATE ON public.teacher_journals
    FOR EACH ROW EXECUTE FUNCTION public.fn_teacher_journal_date_check();
