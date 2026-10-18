create temp table hasil_uji(no serial, k text, v text) on commit drop;
create or replace function pg_temp.jalan(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare a uuid; r text;
begin
  select auth_user_id into a from users where user_id = p_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  begin
    execute p_sql into r;
    reset role;
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
    return coalesce(r, 'NULL');
  exception when assert_failure or others then
    reset role;
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
    return 'GALAT:' || sqlstate;
  end;
end $f$;
-- pengunjung tanpa login: peran anon, tanpa klaim JWT
create or replace function pg_temp.anon(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    execute p_sql into r;
    reset role;
    return coalesce(r, 'NULL');
  exception when assert_failure or others then
    reset role;
    return 'GALAT:' || sqlstate;
  end;
end $f$;
do $$
declare
  sid uuid; autor uuid; stu uuid; siswa_u uuid; ortu uuid; o uuid := gen_random_uuid(); sdk uuid; kolom text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select ts.scheduled_teacher_id, ce.student_id into autor, stu
  from teaching_schedules ts
  join class_enrollments ce on ce.class_id = ts.class_id and ce.academic_year = ts.academic_year and ce.withdrawn_at is null
  join students s on s.student_id = ce.student_id and s.user_id is not null
  join users u on u.user_id = ts.scheduled_teacher_id and u.teacher_code is not null and u.is_active and u.role_type = 'GURU'
  where ts.school_id = sid and exists (select 1 from student_parents sp where sp.student_id = ce.student_id)
  order by ts.scheduled_teacher_id, ce.student_id limit 1;
  select user_id into siswa_u from students where student_id = stu;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = stu limit 1;
  insert into hasil_uji(k,v) values ('persona', format('autor=%s stu=%s siswa=%s ortu=%s', autor is not null, stu is not null, siswa_u is not null, ortu is not null));

  perform fn_sync_observation(null, o, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_DAN_ORTU', 'catatan uji hak anon', now());

  -- Pengunjung tanpa login ditolak di pintu depan (hak akses), bukan hanya diberi 0 baris oleh RLS
  insert into hasil_uji(k,v) values ('A1_anon_select', pg_temp.anon('select count(*)::text from observations'));
  insert into hasil_uji(k,v) values ('A2_anon_insert', pg_temp.anon(format('insert into observations(observation_id, school_id, author_user_id, student_id, sentiment, dimension, visibility, content, observed_at) values (gen_random_uuid(), %L, %L, %L, ''POSITIF'', ''AKADEMIK'', ''SISWA_SAJA'', ''catatan uji anon'', now()) returning ''ok''', sid, autor, stu)));
  insert into hasil_uji(k,v) values ('A3_anon_update', pg_temp.anon(format('update observations set content = ''diubah anon'' where observation_id = %L returning ''ok''', o)));
  insert into hasil_uji(k,v) values ('A4_anon_delete', pg_temp.anon(format('delete from observations where observation_id = %L returning ''ok''', o)));
  insert into hasil_uji(k,v) values ('A5_anon_tampilan_lama', pg_temp.anon('select count(*)::text from v_student_portal_positif'));
  insert into hasil_uji(k,v) values ('A6_hak_anon_tersisa', (select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and table_name in ('observations', 'v_student_portal_positif')));

  -- Pengguna yang sudah login tidak berubah
  insert into hasil_uji(k,v) values ('B1_penulis_membaca', pg_temp.jalan(autor, format('select count(*)::text from observations where observation_id = %L', o)));
  insert into hasil_uji(k,v) values ('B2_siswa_membaca', pg_temp.jalan(siswa_u, format('select count(*)::text from observations where observation_id = %L', o)));
  insert into hasil_uji(k,v) values ('B3_ortu_membaca', pg_temp.jalan(ortu, format('select count(*)::text from observations where observation_id = %L', o)));
  insert into hasil_uji(k,v) values ('B4_penulis_menulis', pg_temp.jalan(autor, format('insert into observations(observation_id, school_id, author_user_id, student_id, sentiment, dimension, visibility, content, observed_at) values (gen_random_uuid(), %L, %L, %L, ''POSITIF'', ''AKADEMIK'', ''SISWA_SAJA'', ''catatan uji penulis'', now()) returning ''ok''', sid, autor, stu)));
  insert into hasil_uji(k,v) values ('B5_penulis_membatalkan', case when pg_temp.jalan(autor, format('select fn_void_observation(%L, %L)::text', o, 'uji pembatalan')) like 'GALAT%' then 'GAGAL' else 'ok' end);
  insert into hasil_uji(k,v) values ('B6_service_role_tetap', (select has_table_privilege('service_role', 'public.observations', 'select,insert,update,delete')::text));
end $$;
select k, v from hasil_uji order by no;
