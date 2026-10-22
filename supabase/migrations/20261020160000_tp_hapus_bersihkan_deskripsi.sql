-- Audit Excel/Nilai Rapor (23 Okt 2026), temuan F7: deskripsi capaian yang tersimpan bisa masih menyebut TP yang sudah dihapus. Menghapus TP sudah membuang id TP itu dari tanda T/R
-- nilai rapor tersimpan (20261020140000); kini deskripsi yang DISUSUN OTOMATIS dari TP itu ikut dikosongkan.
-- Kalimat otomatis (sama dengan guru/js/nilai-rapor.js susunDeskripsi, satu TP): T -> "Menunjukkan penguasaan yang baik dalam <teks TP>." ; R -> "Perlu peningkatan dalam <teks TP>."
-- <teks TP> = deskripsi TP (atau kode TP bila deskripsi kosong) tanpa titik/spasi di ujung. Deskripsi yang sudah DISUNTING guru (tidak persis kalimat itu) TIDAK disentuh.
-- Deskripsi kosong tidak masalah: layar menyusunnya kembali dari tanda T/R terkini saat guru menyimpan.
CREATE OR REPLACE FUNCTION public.fn_tp_hapus_bersihkan_tanda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_teks text := regexp_replace(btrim(COALESCE(NULLIF(OLD.deskripsi_tp, ''), OLD.kode_tp, '')), '[.\s]+$', '');
BEGIN
    UPDATE public.grade_final g
       SET deskripsi_tertinggi = CASE WHEN OLD.id = ANY (g.tp_optimal) AND g.deskripsi_tertinggi = 'Menunjukkan penguasaan yang baik dalam ' || v_teks || '.' THEN NULL ELSE g.deskripsi_tertinggi END,
           deskripsi_terendah  = CASE WHEN OLD.id = ANY (g.tp_perlu)    AND g.deskripsi_terendah  = 'Perlu peningkatan dalam ' || v_teks || '.'                THEN NULL ELSE g.deskripsi_terendah END,
           tp_optimal = array_remove(g.tp_optimal, OLD.id),
           tp_perlu   = array_remove(g.tp_perlu, OLD.id)
     WHERE g.class_id = OLD.class_id AND g.subject_id = OLD.subject_id
       AND g.academic_year = OLD.academic_year AND g.semester = OLD.semester
       AND (OLD.id = ANY (g.tp_optimal) OR OLD.id = ANY (g.tp_perlu))
       AND NOT public.fn_grade_period_locked(g.school_id, g.class_id, g.academic_year::text, g.semester);
    RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_tp_hapus_bersihkan_tanda() FROM PUBLIC, anon, authenticated;
