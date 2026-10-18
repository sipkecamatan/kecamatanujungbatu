create temp table hasil_uji(no serial, k text, v text) on commit drop;
create or replace function pg_temp.coba(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return 'GALAT:' || sqlstate; end $f$;
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
declare sid uuid; yr text; g uuid; g2 uuid; post uuid; ins text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select user_id into g  from users where school_id = sid and role_type = 'GURU' and is_active order by user_id limit 1;
  select user_id into g2 from users where school_id = sid and is_active and user_id <> g order by user_id limit 1;
  ins := 'insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (%L,%L,%L,%L,%L,%L)';
  insert into hasil_uji(k,v) values ('B1_judul_200_diterima', pg_temp.coba(format(ins, sid, g, yr, repeat('j', 200), 'isi', 'SEKOLAH')));
  insert into hasil_uji(k,v) values ('B2_judul_201_ditolak',  pg_temp.coba(format(ins, sid, g, yr, repeat('j', 201), 'isi', 'SEKOLAH')));
  insert into hasil_uji(k,v) values ('B3_isi_5000_diterima',  pg_temp.coba(format(ins, sid, g, yr, 'Judul uji', repeat('i', 5000), 'SEKOLAH')));
  insert into hasil_uji(k,v) values ('B4_isi_5001_ditolak',   pg_temp.coba(format(ins, sid, g, yr, 'Judul uji', repeat('i', 5001), 'SEKOLAH')));
  insert into forum_posts(school_id, author_user_id, academic_year, title, body, scope_type) values (sid, g, yr, 'UJI batas', 'isi', 'SEKOLAH') returning post_id into post;
  insert into hasil_uji(k,v) values ('B5_komentar_2000_diterima', pg_temp.coba(format('insert into forum_post_comments(post_id,school_id,author_user_id,body) values (%L,%L,%L,%L)', post, sid, g, repeat('k', 2000))));
  insert into hasil_uji(k,v) values ('B6_komentar_2001_ditolak',  pg_temp.coba(format('insert into forum_post_comments(post_id,school_id,author_user_id,body) values (%L,%L,%L,%L)', post, sid, g, repeat('k', 2001))));
  -- lewat jalur sah fungsi server (pengguna biasa): judul 201 ditolak, 200 diterima
  insert into hasil_uji(k,v) values ('B7_rpc_judul_201_ditolak', pg_temp.jalan(g, format('select fn_create_forum_post(null, %L, ''isi'', null, ''{}''::uuid[], ''STAF_SAJA'', %L::uuid[], null, ''{}''::uuid[], ''SEKOLAH'', %L, gen_random_uuid())::text', yr, '{' || g2 || '}', repeat('j', 201))));
  insert into hasil_uji(k,v) values ('B8_rpc_judul_200_diterima', case when pg_temp.jalan(g, format('select fn_create_forum_post(null, %L, ''isi'', null, ''{}''::uuid[], ''STAF_SAJA'', %L::uuid[], null, ''{}''::uuid[], ''SEKOLAH'', %L, gen_random_uuid())::text', yr, '{' || g2 || '}', repeat('j', 200))) like 'GALAT%' then 'GALAT' else 'ok' end);
end $$;
select k, v from hasil_uji order by no;
