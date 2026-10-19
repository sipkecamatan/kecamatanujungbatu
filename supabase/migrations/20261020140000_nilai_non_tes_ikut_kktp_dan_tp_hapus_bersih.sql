-- Dua perbaikan alur Perencanaan -> Pelaksanaan -> Nilai Rapor (permintaan Romo 20 Okt 2026), keduanya di SUMBERNYA:
--
-- (1) Nilai angka penilaian sumatif NON-TES berasal dari PREDIKAT (BB/MB/BSH/SB) + rentang KKTP TP-nya (titik tengah rentang).
--     Sebelumnya angka itu disimpan sebagai salinan beku: mengubah KKTP tidak mengubah nilai yang sudah tersimpan, sehingga Rekap dan Nilai Rapor
--     memakai angka basi. Kini setiap perubahan KKTP (tambah/ubah rentang/hapus) menyelaraskan nilai angka penilaian yang memakainya.
--     Rentang yang dipakai penilaian = KKTP dari TP tertaut pertama menurut urutan TP (sama dengan aturan di formulir penilaian); tanpa KKTP = rentang bawaan.
--     Semester yang ditutup (terkunci) TIDAK diubah. Penilaian TES (angka diketik guru) tidak disentuh.
--
-- (2) Menghapus TP meninggalkan id TP itu pada tanda T/R nilai rapor tersimpan (kolom larik tanpa kunci asing). Kini id itu dibuang saat TP dihapus.

-- ── (1) ──
CREATE OR REPLACE FUNCTION public.fn_nilai_dari_predikat(p_status text, p_rentang jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
    WITH r AS (
        SELECT COALESCE(p_rentang -> p_status, '{"BB":[0,54],"MB":[55,69],"BSH":[70,84],"SB":[85,100]}'::jsonb -> p_status) AS rng
    )
    SELECT CASE WHEN p_status IN ('BB', 'MB', 'BSH', 'SB') AND rng IS NOT NULL
                THEN round(((rng ->> 0)::numeric + (rng ->> 1)::numeric) / 2)
           END
    FROM r;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sinkron_nilai_non_tes(p_lo uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
    WITH calon AS (
        SELECT ar.id,
               public.fn_nilai_dari_predikat(ar.status, kk.rentang) AS baru
        FROM public.assessment_results ar
        JOIN public.assessments a ON a.id = ar.assessment_id AND a.school_id = ar.school_id
                                 AND a.jenis = 'SUMATIF' AND COALESCE(a.teknik, '') <> 'TES'
        JOIN LATERAL (SELECT t.learning_objective_id
                      FROM public.assessment_tps t JOIN public.learning_objectives lo ON lo.id = t.learning_objective_id
                      WHERE t.assessment_id = a.id
                      ORDER BY lo.urutan, lo.kode_tp LIMIT 1) pilih ON TRUE
        LEFT JOIN LATERAL (SELECT ac.rentang FROM public.assessment_criteria ac
                           WHERE ac.learning_objective_id = pilih.learning_objective_id AND ac.rentang IS NOT NULL
                           ORDER BY ac.urutan LIMIT 1) kk ON TRUE
        WHERE pilih.learning_objective_id = p_lo
          AND ar.status IN ('BB', 'MB', 'BSH', 'SB')
          AND NOT public.fn_grade_period_locked(a.school_id, a.class_id, a.academic_year::text, a.semester)
    )
    UPDATE public.assessment_results ar
       SET nilai = c.baru, updated_at = now()
      FROM calon c
     WHERE ar.id = c.id AND c.baru IS NOT NULL AND ar.nilai IS DISTINCT FROM c.baru;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_sinkron_nilai_non_tes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_trg_kktp_sinkron_nilai()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM public.fn_sinkron_nilai_non_tes(CASE WHEN TG_OP = 'DELETE' THEN OLD.learning_objective_id ELSE NEW.learning_objective_id END);
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_trg_kktp_sinkron_nilai() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kktp_sinkron_nilai_ins_upd ON public.assessment_criteria;
CREATE TRIGGER trg_kktp_sinkron_nilai_ins_upd AFTER INSERT OR UPDATE OF rentang ON public.assessment_criteria
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_kktp_sinkron_nilai();
DROP TRIGGER IF EXISTS trg_kktp_sinkron_nilai_del ON public.assessment_criteria;
CREATE TRIGGER trg_kktp_sinkron_nilai_del AFTER DELETE ON public.assessment_criteria
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_kktp_sinkron_nilai();

-- Selaraskan data yang sudah ada (idempotent; semester terkunci dilewati).
DO $$
DECLARE v_lo uuid;
BEGIN
    FOR v_lo IN SELECT id FROM public.learning_objectives LOOP
        PERFORM public.fn_sinkron_nilai_non_tes(v_lo);
    END LOOP;
END $$;

-- ── (2) ──
CREATE OR REPLACE FUNCTION public.fn_tp_hapus_bersihkan_tanda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    UPDATE public.grade_final g
       SET tp_optimal = array_remove(g.tp_optimal, OLD.id), tp_perlu = array_remove(g.tp_perlu, OLD.id)
     WHERE g.class_id = OLD.class_id AND g.subject_id = OLD.subject_id
       AND g.academic_year = OLD.academic_year AND g.semester = OLD.semester
       AND (OLD.id = ANY (g.tp_optimal) OR OLD.id = ANY (g.tp_perlu))
       AND NOT public.fn_grade_period_locked(g.school_id, g.class_id, g.academic_year::text, g.semester);
    RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_tp_hapus_bersihkan_tanda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tp_hapus_bersihkan_tanda ON public.learning_objectives;
CREATE TRIGGER trg_tp_hapus_bersihkan_tanda BEFORE DELETE ON public.learning_objectives
    FOR EACH ROW EXECUTE FUNCTION public.fn_tp_hapus_bersihkan_tanda();
