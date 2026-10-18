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
  sid uuid; yr text; penulis uuid; penerima uuid; orang_lain uuid; kepsek uuid; waka_kes uuid; ortu uuid; kelas uuid; p uuid; p_mod uuid; p_lama uuid;
  baca text := 'select count(*)::text from forum_posts where post_id=%L';
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select c.class_id into kelas from classes c where c.school_id = sid and c.name = 'XI AKL 1';
  select user_id into penulis  from users where school_id = sid and full_name ilike 'Anwar Batubara%';
  select user_id into penerima from users where school_id = sid and full_name ilike 'Aisyah Ginting%';
  select user_id into orang_lain from users where school_id = sid and role_type = 'GURU' and is_active and user_id not in (penulis, penerima) order by user_id limit 1;
  select user_id into kepsek   from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into waka_kes from users where school_id = sid and role_type = 'WAKA_KESISWAAN' and is_active limit 1;
  select sp.parent_user_id into ortu from student_parents sp join class_enrollments ce on ce.student_id = sp.student_id and ce.class_id = kelas and ce.withdrawn_at is null limit 1;
  insert into hasil_uji(k,v) values ('persona', format('penulis=%s penerima=%s lain=%s kepsek=%s waka_kes=%s ortu=%s', penulis is not null, penerima is not null, orang_lain is not null, kepsek is not null, waka_kes is not null, ortu is not null));
  insert into hasil_uji(k,v) values ('F0_fungsi_tarik_sudah_dicabut', case when to_regprocedure('public.fn_toggle_forum_post_withdrawn(uuid,boolean)') is null then 'tidak_ada' else 'MASIH_ADA' end);

  -- posting guru kepada penerima biasa, Kepsek, dan orang tua; ada komentar dan notifikasi
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI hapus','isi','SEKOLAH') returning post_id into p;
  insert into forum_post_audience(post_id,school_id,user_id) values (p,sid,penerima),(p,sid,kepsek),(p,sid,ortu);
  insert into forum_post_comments(post_id,school_id,author_user_id,body) values (p,sid,penerima,'balasan uji');
  insert into notifications(school_id,recipient_user_id,type,title,body,forum_post_id) values (sid,penerima,'FORUM_POST_NEW','uji','uji',p);
  insert into hasil_uji(k,v) values ('H0_sebelum_hapus', format('penulis=%s penerima=%s kepsek=%s ortu=%s', pg_temp.jalan(penulis, format(baca,p)), pg_temp.jalan(penerima, format(baca,p)), pg_temp.jalan(kepsek, format(baca,p)), pg_temp.jalan(ortu, format(baca,p))));
  -- yang tidak berhak menghapus
  insert into hasil_uji(k,v) values ('H1_penerima_biasa_tidak_dapat_menghapus', pg_temp.jalan(penerima, format('select count(*)::text from fn_delete_forum_post(%L)', p)));
  insert into hasil_uji(k,v) values ('H2_ortu_penerima_tidak_dapat_menghapus', pg_temp.jalan(ortu, format('select count(*)::text from fn_delete_forum_post(%L)', p)));
  insert into hasil_uji(k,v) values ('H3_orang_lain_tidak_dapat_menghapus', pg_temp.jalan(orang_lain, format('select count(*)::text from fn_delete_forum_post(%L)', p)));
  insert into hasil_uji(k,v) values ('H4_moderator_bukan_penerima_tidak_dapat_menghapus', pg_temp.jalan(waka_kes, format('select count(*)::text from fn_delete_forum_post(%L)', p)));
  -- penulis menghapus = menarik dari semua orang, sekaligus menghapus isinya
  insert into hasil_uji(k,v) values ('H5_penulis_menghapus', pg_temp.jalan(penulis, format('select count(*)::text from fn_delete_forum_post(%L)', p)));
  insert into hasil_uji(k,v) values ('H6_setelah_dihapus_tak_seorang_pun_membaca', format('penulis=%s penerima=%s kepsek=%s ortu=%s', pg_temp.jalan(penulis, format(baca,p)), pg_temp.jalan(penerima, format(baca,p)), pg_temp.jalan(kepsek, format(baca,p)), pg_temp.jalan(ortu, format(baca,p))));
  insert into hasil_uji(k,v) values ('H7_komentar_penerima_notifikasi_ikut_hilang', format('posting=%s penerima=%s komentar=%s notifikasi=%s', (select count(*) from forum_posts where post_id = p), (select count(*) from forum_post_audience where post_id = p), (select count(*) from forum_post_comments where post_id = p), (select count(*) from notifications where forum_post_id = p)));
  insert into hasil_uji(k,v) values ('H8_hapus_dua_kali', pg_temp.jalan(penulis, format('select count(*)::text from fn_delete_forum_post(%L)', p)));
  -- moderator yang menerima posting boleh menghapusnya
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI untuk waka','isi','SEKOLAH') returning post_id into p_mod;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_mod,sid,waka_kes);
  insert into hasil_uji(k,v) values ('M1_moderator_penerima_dapat_menghapus', pg_temp.jalan(waka_kes, format('select count(*)::text from fn_delete_forum_post(%L)', p_mod)));
  -- peninggalan fitur lama: baris berstatus is_withdrawn hanya terlihat penulis (tak seorang pun lain, termasuk moderator penerima)
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type,is_withdrawn) values (sid,penulis,yr,'UJI peninggalan','isi','SEKOLAH',true) returning post_id into p_lama;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_lama,sid,penerima),(p_lama,sid,kepsek);
  insert into hasil_uji(k,v) values ('L1_peninggalan_ditarik_hanya_penulis_membaca', format('penulis=%s penerima=%s kepsek=%s', pg_temp.jalan(penulis, format(baca,p_lama)), pg_temp.jalan(penerima, format(baca,p_lama)), pg_temp.jalan(kepsek, format(baca,p_lama))));
end $$;
select k, v from hasil_uji order by no;
