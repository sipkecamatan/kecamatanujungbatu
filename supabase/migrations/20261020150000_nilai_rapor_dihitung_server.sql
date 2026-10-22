-- Nilai rapor DIHITUNG OLEH DATABASE (permintaan Romo 23 Okt 2026): aturan "nilai rapor = hasil rumus atas nilai di Pelaksanaan" kini dijaga di server, bukan hanya di layar.
-- Sebelumnya browser menghitung angkanya dan database menerima angka apa saja (0-100). Kini, setiap kali guru menyimpan (INSERT atau UPDATE yang mengubah nilai_rapor, metode, atau rumus),
-- database menghitung sendiri dari rumus yang ikut tersimpan (grade_final.rumus: {metode, bobot{id penilaian: persen}}) dan nilai penilaian SUMATIF di assessment_results, lalu
-- MENETAPKAN nilai_rapor dan metode. Angka kiriman klien diabaikan. Tanpa rumus yang sah, atau bila rumus tidak dapat dihitung untuk siswa itu, penyimpanan DITOLAK.
-- Jalur tanpa pengguna (migrasi, service role, wizard reset) tidak dipaksa. Rumus meniru persis guru/js/nilai-rapor.js (hitungNilaiRapor): rata-rata, pembobotan (total tepat 100%, kontribusi tiap
-- penilaian dibulatkan lalu dijumlah), persentase TP tercapai (batas = awal rentang BSH atau SB yang terkecil), dan nilai TP terakhir; pembulatan normal di dalam 0-100.

-- Nilai siswa pada SEMUA penilaian sumatif milik guru itu untuk kelas + mapel + periode (nilai NULL bila siswa belum bernilai).
CREATE OR REPLACE FUNCTION public.fn_nilai_sumatif_siswa(p_school uuid, p_class uuid, p_subject uuid, p_teacher uuid, p_student uuid, p_year text, p_semester integer)
 RETURNS TABLE(aid uuid, nilai numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT a.id, ar.nilai
    FROM public.assessments a
    LEFT JOIN public.assessment_results ar ON ar.assessment_id = a.id AND ar.student_id = p_student AND ar.school_id = a.school_id AND ar.nilai IS NOT NULL
    WHERE a.school_id = p_school AND a.class_id = p_class AND a.subject_id = p_subject AND a.teacher_id = p_teacher
      AND a.academic_year::text = p_year AND a.semester::text = p_semester::text AND a.jenis = 'SUMATIF';
$function$;
REVOKE ALL ON FUNCTION public.fn_nilai_sumatif_siswa(uuid, uuid, uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- Hasil rumus untuk satu siswa; NULL bila tidak dapat dihitung (rumus tidak sah, bobot belum 100%, tanpa nilai, tanpa TP/KKTP, dst.).
CREATE OR REPLACE FUNCTION public.fn_hitung_nilai_rapor(p_school uuid, p_class uuid, p_subject uuid, p_teacher uuid, p_student uuid, p_year text, p_semester integer, p_rumus jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_metode text := p_rumus ->> 'metode';
    v_bobot  jsonb := CASE WHEN jsonb_typeof(p_rumus -> 'bobot') = 'object' THEN p_rumus -> 'bobot' ELSE '{}'::jsonb END;
    v_hasil  numeric;
    v_total  numeric;
    v_tot    numeric;
    v_tp     uuid;
    v_dinilai integer;
    v_tercapai integer;
BEGIN
    IF v_metode IS NULL OR v_metode NOT IN ('RATA', 'BOBOT', 'PERSEN', 'TERAKHIR') THEN RETURN NULL; END IF;

    IF v_metode = 'RATA' THEN
        SELECT avg(s.nilai) INTO v_hasil
        FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester) s
        WHERE s.nilai IS NOT NULL;

    ELSIF v_metode = 'BOBOT' THEN
        -- Total bobot dihitung atas SEMUA penilaian sumatif (yang tak berbobot = 0) dan harus tepat 100%; bila tidak, tidak ada hasil (tidak dinormalkan diam-diam).
        SELECT COALESCE(sum(x.b), 0) INTO v_total
        FROM (SELECT CASE WHEN (v_bobot ->> s.aid::text) ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' THEN (v_bobot ->> s.aid::text)::numeric ELSE 0 END AS b
              FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester) s) x;
        IF abs(v_total - 100) >= 0.001 THEN RETURN NULL; END IF;
        SELECT COALESCE(sum(x.b), 0) INTO v_tot
        FROM (SELECT s.nilai AS n, CASE WHEN (v_bobot ->> s.aid::text) ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' THEN (v_bobot ->> s.aid::text)::numeric ELSE 0 END AS b
              FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester) s) x
        WHERE x.n IS NOT NULL AND x.b > 0;
        IF v_tot <= 0 THEN RETURN NULL; END IF;
        SELECT sum(round(x.n * x.b / v_tot)) INTO v_hasil
        FROM (SELECT s.nilai AS n, CASE WHEN (v_bobot ->> s.aid::text) ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' THEN (v_bobot ->> s.aid::text)::numeric ELSE 0 END AS b
              FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester) s) x
        WHERE x.n IS NOT NULL AND x.b > 0;

    ELSIF v_metode = 'PERSEN' THEN
        -- Nilai per TP = rata-rata nilai penilaian sumatif yang menaut TP itu; tercapai bila >= batas KKTP (awal rentang BSH atau SB, yang terkecil). TP tanpa KKTP diabaikan.
        WITH sm AS (
            SELECT * FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester)
        ), tp AS (
            SELECT t.learning_objective_id AS id, avg(sm.nilai) AS nilai
            FROM sm JOIN public.assessment_tps t ON t.assessment_id = sm.aid
            WHERE sm.nilai IS NOT NULL
            GROUP BY t.learning_objective_id
        ), kk AS (
            SELECT tp.nilai,
                   (SELECT min(v) FROM unnest(ARRAY[(ac.rentang -> 'BSH' ->> 0)::numeric, (ac.rentang -> 'SB' ->> 0)::numeric]) v) AS batas
            FROM tp
            LEFT JOIN LATERAL (SELECT c.rentang FROM public.assessment_criteria c WHERE c.learning_objective_id = tp.id ORDER BY c.urutan, c.batas_bawah LIMIT 1) ac ON TRUE
        )
        SELECT count(*) FILTER (WHERE batas IS NOT NULL), count(*) FILTER (WHERE batas IS NOT NULL AND nilai >= batas)
          INTO v_dinilai, v_tercapai
        FROM kk;
        IF v_dinilai = 0 THEN RETURN NULL; END IF;
        v_hasil := 100.0 * v_tercapai / v_dinilai;

    ELSIF v_metode = 'TERAKHIR' THEN
        -- TP terakhir = TP (urutan terbesar) kelas + mapel + periode itu yang punya penilaian sumatif tertaut; nilainya = rata-rata penilaian yang menautnya.
        SELECT lo.id INTO v_tp
        FROM public.learning_objectives lo
        WHERE lo.school_id = p_school AND lo.class_id = p_class AND lo.subject_id = p_subject AND lo.teacher_id = p_teacher
          AND lo.academic_year::text = p_year AND lo.semester::text = p_semester::text
          AND EXISTS (SELECT 1 FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester) s
                      JOIN public.assessment_tps t ON t.assessment_id = s.aid WHERE t.learning_objective_id = lo.id)
        ORDER BY lo.urutan DESC, lo.kode_tp DESC
        LIMIT 1;
        IF v_tp IS NULL THEN RETURN NULL; END IF;
        SELECT avg(s.nilai) INTO v_hasil
        FROM public.fn_nilai_sumatif_siswa(p_school, p_class, p_subject, p_teacher, p_student, p_year, p_semester) s
        JOIN public.assessment_tps t ON t.assessment_id = s.aid
        WHERE t.learning_objective_id = v_tp AND s.nilai IS NOT NULL;
    END IF;

    IF v_hasil IS NULL THEN RETURN NULL; END IF;
    RETURN GREATEST(0, LEAST(100, round(v_hasil)));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_hitung_nilai_rapor(uuid, uuid, uuid, uuid, uuid, text, integer, jsonb) FROM PUBLIC, anon, authenticated;

-- Pemicu: yang menetapkan nilai_rapor dan metode adalah database.
CREATE OR REPLACE FUNCTION public.fn_trg_grade_final_hitung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_hasil numeric;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- migrasi, service role, wizard reset: tidak dipaksa
    IF TG_OP = 'UPDATE' AND NEW.nilai_rapor IS NOT DISTINCT FROM OLD.nilai_rapor
       AND NEW.metode IS NOT DISTINCT FROM OLD.metode AND NEW.rumus IS NOT DISTINCT FROM OLD.rumus THEN
        RETURN NEW;   -- mis. izin tampil, tanda T/R, deskripsi, atau pembersihan TP terhapus: angka rapor tidak disentuh
    END IF;
    IF NEW.rumus IS NULL OR COALESCE(NEW.rumus ->> 'metode', '') NOT IN ('RATA', 'BOBOT', 'PERSEN', 'TERAKHIR') THEN
        RAISE EXCEPTION 'nilai_rapor_tanpa_rumus: nilai rapor hanya dapat disimpan bersama rumus (metode Rata-rata, Pembobotan, Persentase TP, atau TP terakhir); angka manual tidak diterima'
            USING ERRCODE = 'P0001';
    END IF;
    v_hasil := public.fn_hitung_nilai_rapor(NEW.school_id, NEW.class_id, NEW.subject_id, NEW.teacher_id, NEW.student_id, NEW.academic_year::text, NEW.semester, NEW.rumus);
    IF v_hasil IS NULL THEN
        RAISE EXCEPTION 'nilai_rapor_tidak_dapat_dihitung: rumus % tidak menghasilkan nilai untuk siswa ini (bobot belum 100%%, belum ada nilai penilaian sumatif, atau TP/KKTP belum lengkap)', NEW.rumus ->> 'metode'
            USING ERRCODE = 'P0001';
    END IF;
    NEW.nilai_rapor := v_hasil;
    NEW.metode := NEW.rumus ->> 'metode';
    RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_trg_grade_final_hitung() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_grade_final_hitung ON public.grade_final;
CREATE TRIGGER trg_grade_final_hitung BEFORE INSERT OR UPDATE ON public.grade_final
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_grade_final_hitung();
