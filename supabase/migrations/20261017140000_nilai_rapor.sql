-- Nilai rapor per mata pelajaran (keputusan Romo 17 Okt 2026, mengikuti Panduan e-Rapor SMK 2025 dan Panduan Pembelajaran dan Asesmen 2025).
--  * Guru mata pelajaran menetapkan SATU Nilai Akhir (0-100) per siswa per mapel per semester; operator/admin tidak menginput nilai.
--  * Guru menandai TP "dicapai optimal" (T) dan TP "perlu peningkatan" (R); deskripsi capaian tertinggi/terendah dapat disusun otomatis dan diedit.
--  * Terlihat oleh: guru penyimpan; wali kelas siswa (hanya baca, untuk cek dan cetak); Kepala Sekolah dan Waka Kurikulum (hanya baca, pengawasan).
--    Siswa, orang tua, BK, Waka Kesiswaan/Humas, Kaprodi, dan admin TIDAK membacanya.
--  * Tidak ada publikasi ke portal siswa/orang tua: rapor resmi dicetak dari e-Rapor.
-- Catatan: wali kelas pada data nyata berperan GURU dengan wali_kelas_class_id; kebijakan baca wali memakai fn_wali_of_student tanpa memeriksa peran.

CREATE TABLE IF NOT EXISTS public.grade_final (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id          uuid NOT NULL REFERENCES public.schools(school_id) ON DELETE CASCADE,
    class_id           uuid NOT NULL REFERENCES public.classes(class_id) ON DELETE CASCADE,
    subject_id         uuid NOT NULL REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    student_id         uuid NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    teacher_id         uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    academic_year      varchar NOT NULL,
    semester           integer NOT NULL CHECK (semester IN (1, 2)),
    nilai_rapor        numeric(5,2) NOT NULL CHECK (nilai_rapor >= 0 AND nilai_rapor <= 100),
    metode             text NOT NULL DEFAULT 'MANUAL' CHECK (metode IN ('RATA', 'BOBOT', 'PERSEN', 'MANUAL')),
    tp_optimal         uuid[] NOT NULL DEFAULT '{}',
    tp_perlu           uuid[] NOT NULL DEFAULT '{}',
    deskripsi_tertinggi text,
    deskripsi_terendah  text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_grade_final UNIQUE (class_id, subject_id, student_id, academic_year, semester, teacher_id),
    CONSTRAINT chk_grade_final_tp_beda CHECK (NOT (tp_optimal && tp_perlu))
);
CREATE INDEX IF NOT EXISTS idx_grade_final_kelas ON public.grade_final (school_id, class_id, subject_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_grade_final_siswa ON public.grade_final (student_id);

ALTER TABLE public.grade_final ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_final TO authenticated;
GRANT ALL ON public.grade_final TO service_role;

DROP TRIGGER IF EXISTS trg_set_updated_at_grade_final ON public.grade_final;
CREATE TRIGGER trg_set_updated_at_grade_final BEFORE UPDATE ON public.grade_final
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Siswa harus terdaftar di kelas itu pada tahun ajaran + semester yang sama (sama seperti validasi hasil asesmen, A-02).
-- Koreksi pada baris yang kuncinya tidak berubah tidak diperiksa ulang (siswa yang kemudian pindah tidak menghalangi koreksi).
CREATE OR REPLACE FUNCTION public.fn_grade_final_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.class_id = OLD.class_id AND NEW.student_id = OLD.student_id AND NEW.subject_id = OLD.subject_id
       AND NEW.academic_year = OLD.academic_year AND NEW.semester = OLD.semester AND NEW.school_id = OLD.school_id THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.class_enrollments ce
        WHERE ce.student_id = NEW.student_id AND ce.class_id = NEW.class_id AND ce.school_id = NEW.school_id
          AND ce.academic_year = NEW.academic_year AND ce.semester::text = NEW.semester::text
    ) THEN
        RAISE EXCEPTION 'student_not_in_class: siswa tidak terdaftar di kelas ini pada periodenya' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.subject_id = NEW.subject_id AND s.school_id = NEW.school_id) THEN
        RAISE EXCEPTION 'subject_not_in_school: mata pelajaran bukan milik sekolah ini' USING ERRCODE = '42501';
    END IF;
    -- Hanya guru yang mengajar kelas + mata pelajaran itu pada periodenya (penugasan mengajar aktif atau jadwal mengajar).
    IF NOT (
        EXISTS (SELECT 1 FROM public.teaching_assignments ta
                WHERE ta.user_id = NEW.teacher_id AND ta.class_id = NEW.class_id AND ta.subject_id = NEW.subject_id
                  AND ta.academic_year = NEW.academic_year AND ta.semester::text = NEW.semester::text AND ta.is_active IS TRUE)
        OR EXISTS (SELECT 1 FROM public.teaching_schedules ts
                WHERE ts.scheduled_teacher_id = NEW.teacher_id AND ts.class_id = NEW.class_id AND ts.subject_id = NEW.subject_id
                  AND ts.academic_year = NEW.academic_year AND ts.semester::text = NEW.semester::text)
    ) THEN
        RAISE EXCEPTION 'teacher_not_teaching: guru tidak mengajar mata pelajaran ini di kelas ini pada periodenya' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_grade_final_validate ON public.grade_final;
CREATE TRIGGER trg_grade_final_validate BEFORE INSERT OR UPDATE ON public.grade_final
    FOR EACH ROW EXECUTE FUNCTION public.fn_grade_final_validate();

-- Guru penyimpan: baca dan tulis barisnya sendiri; menulis mensyaratkan teacher_code (guru yang mengajar), seperti catatan siswa.
DROP POLICY IF EXISTS rls_grade_final_select_owner ON public.grade_final;
CREATE POLICY rls_grade_final_select_owner ON public.grade_final FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND teacher_id = public.fn_current_user_id());

DROP POLICY IF EXISTS rls_grade_final_insert_owner ON public.grade_final;
CREATE POLICY rls_grade_final_insert_owner ON public.grade_final FOR INSERT TO authenticated
    WITH CHECK (school_id = public.fn_current_school_id() AND teacher_id = public.fn_current_user_id()
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = public.fn_current_user_id() AND NULLIF(btrim(u.teacher_code::text), '') IS NOT NULL));

DROP POLICY IF EXISTS rls_grade_final_update_owner ON public.grade_final;
CREATE POLICY rls_grade_final_update_owner ON public.grade_final FOR UPDATE TO authenticated
    USING (school_id = public.fn_current_school_id() AND teacher_id = public.fn_current_user_id())
    WITH CHECK (school_id = public.fn_current_school_id() AND teacher_id = public.fn_current_user_id());

DROP POLICY IF EXISTS rls_grade_final_delete_owner ON public.grade_final;
CREATE POLICY rls_grade_final_delete_owner ON public.grade_final FOR DELETE TO authenticated
    USING (school_id = public.fn_current_school_id() AND teacher_id = public.fn_current_user_id());

-- Wali kelas: baca saja, untuk siswa kelas walinya (cek dan cetak rapor).
DROP POLICY IF EXISTS rls_grade_final_select_wali ON public.grade_final;
CREATE POLICY rls_grade_final_select_wali ON public.grade_final FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND public.fn_wali_of_student(student_id));

-- Kepala Sekolah dan Waka Kurikulum: baca saja (pengawasan penyusunan rapor).
DROP POLICY IF EXISTS rls_grade_final_select_pimpinan ON public.grade_final;
CREATE POLICY rls_grade_final_select_pimpinan ON public.grade_final FOR SELECT TO authenticated
    USING (school_id = public.fn_current_school_id() AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()));
