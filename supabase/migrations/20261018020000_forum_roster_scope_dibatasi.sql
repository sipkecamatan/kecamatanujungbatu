-- Audit Forum (Codex, 17 Okt 2026), temuan A-05 dan A-14, terbukti di basis data live (siswa/orang tua/guru mana pun dalam sekolah yang sama):
--  A-05  fn_get_forum_member_details(kelas LAIN) mengembalikan 65 baris nama staf, orang tua, dan siswa; fungsi saudaranya fn_get_forum_members (tidak disebut
--        Codex) mengembalikan 37 user_id anggota kelas lain kepada siswa dan orang tua. Keduanya SECURITY DEFINER dan hanya memeriksa sekolah, bukan peran/kebutuhan.
--  A-14  fn_get_user_forum_scope(<id pengguna lain>) mengembalikan peran, kelas wali, program, dan jabatan orang itu.
-- Pemakaian: fn_get_forum_members hanya dipanggil dari fn_create_forum_post (SECURITY DEFINER, berjalan sebagai pemilik fungsi, tidak terpengaruh pencabutan);
-- fn_get_forum_member_details tidak dipanggil klien atau fungsi mana pun; fn_get_user_forum_scope hanya dipanggil portal guru untuk ID pengguna sendiri.
-- Perbaikan: cabut hak panggil langsung kedua fungsi roster dari pengguna biasa (service_role tetap), dan jadikan scope hanya untuk diri sendiri.

REVOKE EXECUTE ON FUNCTION public.fn_get_forum_members(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text)  FROM authenticated;

CREATE OR REPLACE FUNCTION public.fn_get_user_forum_scope(p_user_id uuid)
 RETURNS TABLE(wali_kelas_class_id uuid, role_type text, program_id uuid, kaprodi_program_id uuid, is_waka_kesiswaan boolean, is_kepsek boolean, is_waka_kurikulum boolean, is_waka_humas boolean, is_bk boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        wali_kelas_class_id,
        role_type,
        program_id,
        kaprodi_program_id,
        is_waka_kesiswaan,
        is_kepsek,
        is_waka_kurikulum,
        is_waka_humas,
        is_bk
    FROM public.users
    WHERE user_id   = p_user_id
      AND user_id   = public.fn_current_user_id()      -- hanya diri sendiri (audit Forum A-14)
      AND school_id = fn_current_school_id()
    LIMIT 1;
$function$;
