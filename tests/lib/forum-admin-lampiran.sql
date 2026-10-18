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
  sid uuid; yr text; tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  pen uuid; a_pen uuid; waka uuid; kep uuid; bk uuid; adm uuid; tu uuid; guru2 uuid; a_waka uuid; a_kep uuid;
  post1 uuid; post2 uuid; p1 text; p2 text; q1 text; q2 text;
  baca text := $q$select count(*)::text from storage.objects where bucket_id='forum-attachments' and name=%L$q$;
  hapus text := $q$with d as (delete from storage.objects where bucket_id='forum-attachments' and name=%L returning 1) select count(*)::text from d$q$;
  buat text := $q$select fn_create_forum_post(null, %L, 'isi uji lampiran', null, '{}'::uuid[], 'ORANG_TERTENTU', %L::uuid[], null, '{}'::uuid[], 'SEKOLAH', %L, gen_random_uuid())::text$q$;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select user_id, auth_user_id into pen, a_pen from users where school_id = sid and role_type = 'GURU' and is_active and wali_kelas_class_id is null and kaprodi_program_id is null and not is_bk order by user_id limit 1;
  select user_id, auth_user_id into guru2, a_pen from users where school_id = sid and role_type = 'GURU' and is_active and wali_kelas_class_id is null and kaprodi_program_id is null and not is_bk and user_id <> pen order by user_id limit 1;
  select user_id, auth_user_id into waka, a_waka from users where school_id = sid and role_type = 'WAKA_KESISWAAN' and is_active limit 1;
  select user_id, auth_user_id into kep, a_kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into bk from users where school_id = sid and (role_type = 'BK' or is_bk) and is_active limit 1;
  select user_id into adm from users where school_id = sid and role_type = 'ADMINISTRATIVE' and is_active limit 1;
  select user_id into tu from users where school_id = sid and role_type = 'TU' and is_active limit 1;
  select auth_user_id into a_pen from users where user_id = pen;
  insert into hasil_uji(k,v) values ('persona', format('penulis=%s guru2=%s waka=%s kepsek=%s bk=%s admin=%s tu=%s', pen is not null, guru2 is not null, waka is not null, kep is not null, bk is not null, adm is not null, tu is not null));

  -- Posting 1: penulis -> Waka Kesiswaan, dengan lampiran. Posting 2: penulis -> Kepsek, dengan lampiran.
  post1 := pg_temp.jalan(pen, format(buat, yr, '{' || waka::text || '}', 'UJI lampiran ' || tag || ' A'))::uuid;
  post2 := pg_temp.jalan(pen, format(buat, yr, '{' || kep::text || '}', 'UJI lampiran ' || tag || ' B'))::uuid;
  p1 := sid::text || '/uji-lamp-' || tag || '-1.pdf'; p2 := sid::text || '/uji-lamp-' || tag || '-2.pdf';
  q1 := sid::text || '/uji-lamp-' || tag || '-yatim1.pdf'; q2 := sid::text || '/uji-lamp-' || tag || '-yatim2.pdf';
  update forum_posts set attachment_path = p1, attachment_name = 'a.pdf' where post_id = post1;
  update forum_posts set attachment_path = p2, attachment_name = 'b.pdf' where post_id = post2;
  insert into storage.objects(bucket_id, name, owner_id) values ('forum-attachments', p1, a_pen::text), ('forum-attachments', p2, a_pen::text),
    ('forum-attachments', q1, a_pen::text), ('forum-attachments', q2, a_pen::text);

  -- BACA: hanya penulis dan penerima
  insert into hasil_uji(k,v) values ('B1_penulis_baca_lampiran_sendiri', pg_temp.jalan(pen, format(baca, p1)));
  insert into hasil_uji(k,v) values ('B2_penerima_Waka_baca', pg_temp.jalan(waka, format(baca, p1)));
  insert into hasil_uji(k,v) values ('B3_Kepsek_bukan_penerima_tidak_baca', pg_temp.jalan(kep, format(baca, p1)));
  insert into hasil_uji(k,v) values ('B4_admin_bukan_penerima_tidak_baca', pg_temp.jalan(adm, format(baca, p1)));
  insert into hasil_uji(k,v) values ('B5_BK_tidak_baca', pg_temp.jalan(bk, format(baca, p1)));
  insert into hasil_uji(k,v) values ('B6_TU_tidak_baca', pg_temp.jalan(tu, format(baca, p1)));
  insert into hasil_uji(k,v) values ('B7_Kepsek_penerima_posting2_baca', pg_temp.jalan(kep, format(baca, p2)));
  insert into hasil_uji(k,v) values ('B8_Waka_bukan_penerima_posting2_tidak_baca', pg_temp.jalan(waka, format(baca, p2)));
  insert into hasil_uji(k,v) values ('B9_Kepsek_tidak_lihat_berkas_yatim_orang_lain', pg_temp.jalan(kep, format(baca, q1)));

  -- HAPUS (penghapusan langsung diblokir Supabase kecuali GUC ini; yang diuji adalah kebijakan baris)
  perform set_config('storage.allow_delete_query', 'true', true);
  insert into hasil_uji(k,v) values ('H1_Kepsek_tak_dapat_hapus_lampiran_yang_bukan_ditujukan_kepadanya', pg_temp.jalan(kep, format(hapus, p1)));
  insert into hasil_uji(k,v) values ('H2_admin_tak_dapat_hapus', pg_temp.jalan(adm, format(hapus, p1)));
  insert into hasil_uji(k,v) values ('H3_guru_lain_tak_dapat_hapus', pg_temp.jalan(guru2, format(hapus, p1)));
  insert into hasil_uji(k,v) values ('H5_Kepsek_bukan_penerima_tak_dapat_hapus_posting', (select case when v like 'GALAT:42501' then 'ditolak' else v end from (select pg_temp.jalan(kep, format('select (select count(*) from fn_delete_forum_post(%L))::text', post1)) v) x));
  insert into hasil_uji(k,v) values ('H5b_pemilik_berkas_tidak_berubah_setelah_penolakan', (select count(*)::text from storage.objects where bucket_id='forum-attachments' and name=p1 and owner_id = a_pen::text) || '/' || (select count(*)::text from forum_posts where post_id = post1));
  insert into hasil_uji(k,v) values ('H4_Waka_penerima_dapat_hapus', pg_temp.jalan(waka, format(hapus, p1)));
  insert into hasil_uji(k,v) values ('H6_Kepsek_penerima_hapus_posting_lalu_berkasnya', (select v1 || '/' || v2 from (select pg_temp.jalan(kep, format('select (select count(*) from fn_delete_forum_post(%L))::text', post2)) v1, pg_temp.jalan(kep, format(hapus, p2)) v2) x));
  insert into hasil_uji(k,v) values ('H7_guru_lain_tak_dapat_hapus_berkas_yatim', pg_temp.jalan(guru2, format(hapus, q2)));
  insert into hasil_uji(k,v) values ('H8_pemilik_dapat_hapus_berkas_sendiri', pg_temp.jalan(pen, format(hapus, q2)));

  -- ADMIN KELUAR DARI FORUM
  insert into hasil_uji(k,v) values ('A1_menulis_ke_admin_ditolak', (select case when v like 'GALAT%' then 'ditolak' else 'DITERIMA' end from (select pg_temp.jalan(pen, format(buat, yr, '{' || adm::text || '}', 'UJI ke admin ' || tag)) v) x));
  insert into hasil_uji(k,v) values ('A2_admin_menulis_ditolak', (select case when v like 'GALAT%' then 'ditolak' else 'DITERIMA' end from (select pg_temp.jalan(adm, format(buat, yr, '{' || waka::text || '}', 'UJI dari admin ' || tag)) v) x));
  insert into hasil_uji(k,v) values ('A3_kandidat_kelompok_TU_tanpa_admin', pg_temp.jalan(pen, format($q$select count(*) filter (where user_id = (select user_id from users where role_type = 'ADMINISTRATIVE' and school_id = fn_current_school_id() limit 1))::text || '/' || (count(*) > 0)::text from fn_get_forum_recipient_candidates('SEMUA_TU', null, null, null, %L)$q$, yr)));
  insert into hasil_uji(k,v) values ('A4_admin_bukan_moderator_lampiran', pg_temp.jalan(adm, 'select fn_forum_attachment_moderator()::text'));
  insert into hasil_uji(k,v) values ('A5_Kepsek_tetap_moderator_lampiran', pg_temp.jalan(kep, 'select fn_forum_attachment_moderator()::text'));
  insert into hasil_uji(k,v) values ('A6_admin_tak_ada_di_audiens_manapun', (select count(*)::text from forum_post_audience a join users u on u.user_id = a.user_id where u.role_type = 'ADMINISTRATIVE'));
  insert into hasil_uji(k,v) values ('A7_TU_tetap_bisa_menerima', (select case when v like 'GALAT%' then 'GAGAL ' || v else 'ok' end from (select pg_temp.jalan(pen, format(buat, yr, '{' || tu::text || '}', 'UJI ke TU ' || tag)) v) x));
end $$;
select k, v from hasil_uji order by no;
