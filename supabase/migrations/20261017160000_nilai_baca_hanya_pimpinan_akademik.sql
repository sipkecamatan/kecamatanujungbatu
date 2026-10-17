-- Keputusan Romo 17 Okt 2026: nilai yang diinput guru hanya terlihat oleh siswa dan orang tua (atas izin guru), guru pemiliknya, serta Kepala Sekolah dan
-- Waka Kurikulum sebagai dasar kebijakan.
--  1. Kaprodi, Waka Humas, dan Waka Kesiswaan dicabut aksesnya membaca asesmen, hasil, rekap, dan rubrik (kebijakan "supervision" dipersempit).
--  2. Kebijakan baca peran WALI_KELAS pada asesmen/hasil/rekap dihapus: wali kelas di data nyata berperan GURU sehingga kebijakan itu tidak pernah berlaku,
--     dan memang bukan jalur yang dikehendaki (wali kelas hanya mencetak rapor; nilai rapor tetap terbaca lewat rls_grade_final_select_wali).

DROP POLICY IF EXISTS rls_assessments_select_wali        ON public.assessments;
DROP POLICY IF EXISTS rls_assessment_results_select_wali ON public.assessment_results;
DROP POLICY IF EXISTS rls_grade_recap_select_wali        ON public.grade_recap;

ALTER POLICY rls_assessments_select_supervision        ON public.assessments
    USING (school_id = public.fn_current_school_id() AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()));
ALTER POLICY rls_assessment_results_select_supervision ON public.assessment_results
    USING (school_id = public.fn_current_school_id() AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()));
ALTER POLICY rls_grade_recap_select_supervision        ON public.grade_recap
    USING (school_id = public.fn_current_school_id() AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()));
ALTER POLICY rls_rubric_criteria_select_kepsek_waka    ON public.assessment_rubric_criteria
    USING (school_id = public.fn_current_school_id() AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()));
ALTER POLICY rls_rubric_results_select_kepsek_waka     ON public.assessment_rubric_results
    USING (school_id = public.fn_current_school_id() AND (public.fn_is_kepsek() OR public.fn_is_waka_kurikulum()));
