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
  sid uuid; yr text; kelas uuid; penulis uuid; p1 uuid; p2 uuid; ortu uuid; waka_kes uuid; p uuid;
  aud text := 'select count(*)::text from forum_post_audience where post_id=%L';
  ack text := 'select count(*)::text from forum_post_acknowledgements where post_id=%L';
  notif text := 'select count(*)::text from notifications where forum_post_id=%L and type=''FORUM_COMMENT_NEW'' and recipient_user_id=%L';
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select c.class_id into kelas from classes c where c.school_id = sid and c.name = 'XI AKL 1';
  select user_id into penulis  from users where school_id = sid and full_name ilike 'Anwar Batubara%';
  select user_id into p1       from users where school_id = sid and full_name ilike 'Aisyah Ginting%';
  select user_id into p2       from users where school_id = sid and role_type = 'GURU' and is_active and user_id not in (penulis, p1) order by user_id limit 1;
  select user_id into waka_kes from users where school_id = sid and role_type = 'WAKA_KESISWAAN' and is_active limit 1;
  select sp.parent_user_id into ortu from student_parents sp join class_enrollments ce on ce.student_id = sp.student_id and ce.class_id = kelas and ce.withdrawn_at is null limit 1;
  insert into hasil_uji(k,v) values ('persona', format('penulis=%s p1=%s p2=%s waka=%s ortu=%s', penulis is not null, p1 is not null, p2 is not null, waka_kes is not null, ortu is not null));

  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI privat','isi','SEKOLAH') returning post_id into p;
  insert into forum_post_audience(post_id,school_id,user_id) values (p,sid,p1),(p,sid,p2),(p,sid,ortu),(p,sid,waka_kes);

  -- A-04/B-01: daftar penerima
  insert into hasil_uji(k,v) values ('A1_baris_audiens_yang_terlihat', format('penulis=%s penerima1=%s penerima2=%s ortu=%s moderator=%s',
     pg_temp.jalan(penulis, format(aud,p)), pg_temp.jalan(p1, format(aud,p)), pg_temp.jalan(p2, format(aud,p)), pg_temp.jalan(ortu, format(aud,p)), pg_temp.jalan(waka_kes, format(aud,p))));
  insert into hasil_uji(k,v) values ('A2_penerima_masih_menemukan_posting_lewat_barisnya', pg_temp.jalan(p1, format('select count(*)::text from forum_posts fp join forum_post_audience a on a.post_id = fp.post_id where fp.post_id=%L and a.user_id=%L', p, p1)));
  insert into hasil_uji(k,v) values ('A3_penerima_tak_dapat_menambah_diri_ke_audiens', pg_temp.jalan(penulis, format('with i as (insert into forum_post_audience(post_id,school_id,user_id) values (%L,%L,%L) returning 1) select count(*)::text from i', p, sid, penulis)));

  -- konfirmasi baca
  insert into forum_post_acknowledgements(post_id,school_id,user_id) values (p,sid,p1),(p,sid,ortu);
  insert into hasil_uji(k,v) values ('K1_konfirmasi_baca_yang_terlihat', format('penulis=%s penerima1=%s penerima2=%s ortu=%s',
     pg_temp.jalan(penulis, format(ack,p)), pg_temp.jalan(p1, format(ack,p)), pg_temp.jalan(p2, format(ack,p)), pg_temp.jalan(ortu, format(ack,p))));
  insert into hasil_uji(k,v) values ('K2_penerima_masih_dapat_menandai_dibaca', pg_temp.jalan(p2, format('with i as (insert into forum_post_acknowledgements(post_id,school_id,user_id) values (%L,%L,%L) returning 1) select count(*)::text from i', p, sid, p2)));

  -- B-05: komentar peserta lain tidak memberi tahu semua penerima
  insert into forum_post_comments(post_id,school_id,author_user_id,body) values (p,sid,p1,'komentar dari penerima 1');
  insert into hasil_uji(k,v) values ('N1_komentar_penerima_memberi_tahu', format('penulis=%s penerima2=%s ortu=%s moderator=%s',
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=penulis),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=p2),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=ortu),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=waka_kes)));
  delete from notifications where forum_post_id = p and type = 'FORUM_COMMENT_NEW';
  -- B-05: komentar PENULIS memberi tahu SEMUA penerima (bukan dirinya sendiri)
  insert into forum_post_comments(post_id,school_id,author_user_id,body) values (p,sid,penulis,'pembaruan resmi dari penulis');
  insert into hasil_uji(k,v) values ('N2_komentar_penulis_memberi_tahu_semua_penerima', format('penulis=%s p1=%s p2=%s ortu=%s moderator=%s',
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=penulis),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=p1),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=p2),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=ortu),
     (select count(*) from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=waka_kes)));
  insert into hasil_uji(k,v) values ('N3_teks_notifikasi_penulis', (select (body like '%(penulis)%')::text from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=p2 limit 1));
  -- penerima nonaktif (yang belum membaca) tidak diberi tahu
  perform set_config('app.bypass_users_guard', 'on', true);
  update users set is_active = false where user_id = waka_kes;
  perform set_config('app.bypass_users_guard', 'off', true);
  delete from notifications where forum_post_id = p and type = 'FORUM_COMMENT_NEW';
  insert into forum_post_comments(post_id,school_id,author_user_id,body) values (p,sid,penulis,'pembaruan kedua');
  insert into hasil_uji(k,v) values ('N4_penerima_nonaktif_tidak_diberi_tahu', (select count(*)::text from notifications where forum_post_id=p and type='FORUM_COMMENT_NEW' and recipient_user_id=waka_kes));
end $$;
select k, v from hasil_uji order by no;
