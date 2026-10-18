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
  sid uuid; yr text; penulis uuid; penerima uuid; orang_lain uuid; kepsek uuid; waka_kes uuid; ortu uuid; p uuid; p_mod uuid;
  kelas uuid; baca text := 'select count(*)::text from forum_posts where post_id=%L';
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

  -- posting guru kepada penerima biasa DAN Kepsek DAN orang tua
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI tarik','isi','SEKOLAH') returning post_id into p;
  insert into forum_post_audience(post_id,school_id,user_id) values (p,sid,penerima),(p,sid,kepsek),(p,sid,ortu);
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI tarik moderator','isi','SEKOLAH') returning post_id into p_mod;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_mod,sid,waka_kes);

  insert into hasil_uji(k,v) values ('T0_sebelum_tarik', format('penulis=%s penerima=%s kepsek=%s ortu=%s', pg_temp.jalan(penulis, format(baca,p)), pg_temp.jalan(penerima, format(baca,p)), pg_temp.jalan(kepsek, format(baca,p)), pg_temp.jalan(ortu, format(baca,p))));
  -- penerima biasa dan orang lain tidak dapat menarik
  insert into hasil_uji(k,v) values ('T1_penerima_biasa_tidak_dapat_menarik', pg_temp.jalan(penerima, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, true)', p)));
  insert into hasil_uji(k,v) values ('T2_orang_lain_tidak_dapat_menarik', pg_temp.jalan(orang_lain, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, true)', p)));
  insert into hasil_uji(k,v) values ('T3_moderator_bukan_penerima_tidak_dapat_menarik', pg_temp.jalan(waka_kes, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, true)', p)));
  -- penulis menarik
  insert into hasil_uji(k,v) values ('T4_penulis_menarik', pg_temp.jalan(penulis, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, true)', p)));
  insert into hasil_uji(k,v) values ('T5_setelah_ditarik', format('penulis=%s penerima=%s ortu=%s kepsek_moderator_penerima=%s', pg_temp.jalan(penulis, format(baca,p)), pg_temp.jalan(penerima, format(baca,p)), pg_temp.jalan(ortu, format(baca,p)), pg_temp.jalan(kepsek, format(baca,p))));
  insert into hasil_uji(k,v) values ('T6_penerima_tak_dapat_berkomentar_pada_posting_ditarik', pg_temp.jalan(penerima, format('with i as (insert into forum_post_comments(post_id,school_id,author_user_id,body) values (%L,%L,%L,''balas'') returning 1) select count(*)::text from i', p, sid, penerima)));
  insert into hasil_uji(k,v) values ('T7_penerima_tak_dapat_memulihkan', pg_temp.jalan(penerima, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, false)', p)));
  -- penulis memulihkan
  insert into hasil_uji(k,v) values ('T8_penulis_memulihkan', pg_temp.jalan(penulis, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, false)', p)));
  insert into hasil_uji(k,v) values ('T9_setelah_dipulihkan', format('penulis=%s penerima=%s ortu=%s', pg_temp.jalan(penulis, format(baca,p)), pg_temp.jalan(penerima, format(baca,p)), pg_temp.jalan(ortu, format(baca,p))));
  -- moderator penerima menarik dan memulihkan posting yang ditujukan kepadanya
  insert into hasil_uji(k,v) values ('M1_moderator_penerima_menarik', pg_temp.jalan(waka_kes, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, true)', p_mod)));
  insert into hasil_uji(k,v) values ('M2_moderator_penerima_tetap_membaca_yang_ditarik', pg_temp.jalan(waka_kes, format(baca, p_mod)));
  insert into hasil_uji(k,v) values ('M3_moderator_penerima_memulihkan', pg_temp.jalan(waka_kes, format('select is_withdrawn::text from fn_toggle_forum_post_withdrawn(%L, false)', p_mod)));
  -- celah sebelumnya: penulis tidak dapat memulihkan miliknya (hanya moderator); kini boleh (T8). Langsung ubah kolom tetap ditolak penjaga kolom:
  insert into hasil_uji(k,v) values ('D1_penulis_ubah_kolom_langsung_tetap_ditolak', pg_temp.jalan(penulis, format('with u as (update forum_posts set is_withdrawn=true where post_id=%L returning 1) select count(*)::text from u', p)));
  insert into hasil_uji(k,v) values ('D2_posting_tidak_ada', pg_temp.jalan(penulis, 'select is_withdrawn::text from fn_toggle_forum_post_withdrawn(gen_random_uuid(), true)'));
end $$;
select k, v from hasil_uji order by no;
