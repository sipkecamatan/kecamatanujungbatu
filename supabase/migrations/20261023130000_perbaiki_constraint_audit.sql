-- A-02: paksa is_visible_siswa/ortu selalu false di grade_final via trigger.
-- UI sudah mengirim false (nilai-rapor-ui.js); ini lapisan server agar tidak bisa dibypass klien.
CREATE OR REPLACE FUNCTION public.fn_grade_final_force_invisible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
    NEW.is_visible_siswa := false;
    NEW.is_visible_ortu  := false;
    RETURN NEW;
END;
$f$;

DROP TRIGGER IF EXISTS trg_grade_final_force_invisible ON public.grade_final;
CREATE TRIGGER trg_grade_final_force_invisible
    BEFORE INSERT OR UPDATE ON public.grade_final
    FOR EACH ROW EXECUTE FUNCTION public.fn_grade_final_force_invisible();

-- A-06: constraint enum tindak_lanjut di assessment_results.
-- Nilai yang sudah ada tetap valid (NULL dan tiga opsi resmi).
ALTER TABLE public.assessment_results
    DROP CONSTRAINT IF EXISTS chk_tindak_lanjut;
ALTER TABLE public.assessment_results
    ADD CONSTRAINT chk_tindak_lanjut
    CHECK (tindak_lanjut IS NULL OR tindak_lanjut IN ('PENGAYAAN', 'PENGUATAN', 'PENDAMPINGAN'));
