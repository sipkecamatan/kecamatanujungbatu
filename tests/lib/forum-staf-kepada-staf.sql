create temp table hasil_uji(no serial, k text, v text) on commit drop;
create or replace function pg_temp.jalan(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare a uuid; r text;
begin
  select auth_user_id into a from users where user_id = p_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  begin execute p_sql into r; reset role; return coalesce(r, 'NULL');
  exception when others then reset role; return 'GALAT:' || sqlstate; end;
end $f$;
do $$
declare
  sid uuid; yr text; kelas uuid;
  nama text[] := array['wali_kelas','guru_biasa','bk','kaprodi','waka_kurikulum','waka_kesiswaan','waka_humas','kepsek','tu','admin'];
  ids uuid[]; i int; j int; r text; n_antar_ok int := 0; n_antar_gagal int := 0; n_diri_ditolak int := 0; n_diri_lain int := 0; contoh_gagal text := ''; p uuid; n int;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select c.class_id into kelas from classes c where c.school_id = sid and c.name = 'XI AKL 1';
  ids := array[
    (select user_id from users where school_id=sid and wali_kelas_class_id=kelas limit 1),
    (select user_id from users where school_id=sid and role_type='GURU' and is_active and wali_kelas_class_id is null and kaprodi_program_id is null and not is_bk order by user_id limit 1),
    (select user_id from users where school_id=sid and (role_type='BK' or is_bk) and is_active limit 1),
    (select user_id from users where school_id=sid and kaprodi_program_id is not null and is_active order by user_id limit 1),
    (select user_id from users where school_id=sid and role_type='WAKA_KURIKULUM' and is_active limit 1),
    (select user_id from users where school_id=sid and role_type='WAKA_KESISWAAN' and is_active limit 1),
    (select user_id from users where school_id=sid and role_type='WAKA_HUMAS' and is_active limit 1),
    (select user_id from users where school_id=sid and (role_type='KEPSEK' or is_kepsek) and is_active limit 1),
    (select user_id from users where school_id=sid and role_type='TU' and is_active limit 1),
    (select user_id from users where school_id=sid and role_type='ADMINISTRATIVE' and is_active limit 1)];
  insert into hasil_uji(k,v) values ('persona', (select string_agg(nama[x] || '=' || (ids[x] is not null)::text, ' ') from generate_subscripts(nama,1) x));

  for i in 1..array_length(nama,1) loop
    for j in 1..array_length(nama,1) loop
      r := pg_temp.jalan(ids[i], format($q$select fn_create_forum_post(null, %L, 'uji matriks', null, '{}'::uuid[], 'ORANG_TERTENTU', %L::uuid[], null, '{}'::uuid[], 'SEKOLAH', 'UJI matriks', gen_random_uuid())::text$q$, yr, '{' || ids[j] || '}'));
      if i <> j then
        if r like 'GALAT%' then n_antar_gagal := n_antar_gagal + 1; contoh_gagal := contoh_gagal || nama[i] || '>' || nama[j] || ':' || r || ' ';
        else n_antar_ok := n_antar_ok + 1; end if;
      else
        if r = 'GALAT:22023' then n_diri_ditolak := n_diri_ditolak + 1; else n_diri_lain := n_diri_lain + 1; end if;
      end if;
    end loop;
  end loop;
  insert into hasil_uji(k,v) values ('M1_antar_peran_diterima', n_antar_ok::text || ' ok, ' || n_antar_gagal::text || ' gagal ' || contoh_gagal);
  insert into hasil_uji(k,v) values ('M2_ke_diri_sendiri_ditolak_22023', n_diri_ditolak::text || ' ditolak, ' || n_diri_lain::text || ' lainnya');
  insert into hasil_uji(k,v) values ('M3_pengirim_tidak_ada_di_audiens_sendiri', (select count(*)::text from forum_posts p join forum_post_audience a on a.post_id = p.post_id and a.user_id = p.author_user_id where p.title = 'UJI matriks'));
  insert into hasil_uji(k,v) values ('M4_posting_tercipta_hanya_antar_peran', (select count(*)::text from forum_posts where title = 'UJI matriks'));

  -- Kelompok yang memuat pengirim: pengirim dikeluarkan, penerima lain tetap menerima
  p := (pg_temp.jalan(ids[1], format($q$select fn_create_forum_post(null, %L, 'uji kelompok', null, '{}'::uuid[], 'ORANG_TERTENTU', %L::uuid[], null, '{}'::uuid[], 'SEKOLAH', 'UJI kelompok', gen_random_uuid())::text$q$, yr, '{' || ids[1] || ',' || ids[2] || ',' || ids[8] || '}')))::uuid;
  insert into hasil_uji(k,v) values ('G1_kelompok_memuat_diri_diri_dikeluarkan', (select string_agg(distinct (user_id = ids[1])::text, ',') || '/' || count(*)::text from forum_post_audience where post_id = p));
  insert into hasil_uji(k,v) values ('G2_penerima_lain_menerima_notifikasi', (select count(*)::text from notifications where forum_post_id = p));
  insert into hasil_uji(k,v) values ('G3_penerima_membaca_pengirim_membaca', format('penerima=%s pengirim=%s', pg_temp.jalan(ids[2], format('select count(*)::text from forum_posts where post_id=%L', p)), pg_temp.jalan(ids[1], format('select count(*)::text from forum_posts where post_id=%L', p))));
  insert into hasil_uji(k,v) values ('G4_posting_terkirim_tidak_muncul_di_masuk_pengirim', pg_temp.jalan(ids[1], format('select count(*)::text from forum_posts fp join forum_post_audience a on a.post_id=fp.post_id and a.user_id=%L where fp.post_id=%L', ids[1], p)));

  -- Kandidat penerima: pengirim tidak ada, orang lain ada
  insert into hasil_uji(k,v) values ('C1_kandidat_tanpa_diri', format('wali_dlm_SEMUA_WALI_KELAS=%s guru_dlm_SEMUA_GURU=%s kepsek_dlm_KEPSEK=%s',
    pg_temp.jalan(ids[1], format('select count(*)::text from fn_get_forum_recipient_candidates(''SEMUA_WALI_KELAS'') where user_id=%L', ids[1])),
    pg_temp.jalan(ids[2], format('select count(*)::text from fn_get_forum_recipient_candidates(''SEMUA_GURU'') where user_id=%L', ids[2])),
    pg_temp.jalan(ids[8], format('select count(*)::text from fn_get_forum_recipient_candidates(''KEPSEK'') where user_id=%L', ids[8]))));
  insert into hasil_uji(k,v) values ('C2_wali_kelas_masih_melihat_wali_kelas_lain', pg_temp.jalan(ids[1], 'select (count(*) > 0)::text from fn_get_forum_recipient_candidates(''SEMUA_WALI_KELAS'')'));
  insert into hasil_uji(k,v) values ('C3_guru_masih_melihat_guru_lain', pg_temp.jalan(ids[2], 'select (count(*) > 1)::text from fn_get_forum_recipient_candidates(''SEMUA_GURU'')'));
  insert into hasil_uji(k,v) values ('C4_fungsi_mentah_tidak_dapat_dipanggil_langsung', pg_temp.jalan(ids[2], 'select count(*)::text from fn_get_forum_recipient_candidates_semua(''SEMUA_GURU'')'));
  insert into hasil_uji(k,v) values ('C5_siswa_tetap_ditolak', pg_temp.jalan((select user_id from students where nis='2025100541'), 'select count(*)::text from fn_get_forum_recipient_candidates(''SEMUA_GURU'')'));
end $$;
select k, v from hasil_uji order by no;
