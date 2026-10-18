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
  sid uuid; yr text; siswa_u uuid; ortu uuid; cls uuid; cls_lain uuid; guru uuid; guru2 uuid; kelas_guru uuid; peran text; u uuid;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select st.user_id, ce.class_id into siswa_u, cls from students st join class_enrollments ce on ce.student_id = st.student_id and ce.withdrawn_at is null
    where st.school_id = sid and st.user_id is not null order by st.student_id limit 1;
  select sp.parent_user_id into ortu from student_parents sp join class_enrollments ce on ce.student_id = sp.student_id and ce.class_id = cls limit 1;
  select class_id into cls_lain from classes where school_id = sid and class_id <> cls and is_active limit 1;
  select ta.user_id, ta.class_id into guru, kelas_guru from teaching_assignments ta join users u on u.user_id = ta.user_id and u.role_type = 'GURU' and u.is_active
    where ta.school_id = sid and ta.is_active and ta.academic_year = yr order by ta.user_id limit 1;
  select user_id into guru2 from users where school_id = sid and role_type = 'GURU' and is_active and user_id <> guru order by user_id limit 1;
  insert into hasil_uji(k,v) values ('persona', format('siswa=%s ortu=%s guru=%s guru2=%s kelas_lain=%s', siswa_u is not null, ortu is not null, guru is not null, guru2 is not null, cls_lain is not null));

  -- A-05: fungsi roster tidak dapat dipanggil langsung oleh pengguna biasa (siswa, orang tua, guru)
  foreach peran in array array['siswa', 'ortu', 'guru'] loop
    u := case peran when 'siswa' then siswa_u when 'ortu' then ortu else guru end;
    insert into hasil_uji(k,v) values ('R_' || peran, format('detail=%s members=%s',
      pg_temp.jalan(u, format('select count(*)::text from fn_get_forum_member_details(%L,%L)', cls_lain, yr)),
      pg_temp.jalan(u, format('select count(*)::text from fn_get_forum_members(%L,%L)', cls_lain, yr))));
  end loop;

  -- A-14: scope hanya untuk diri sendiri
  insert into hasil_uji(k,v) values ('S1_siswa_tanya_scope_guru', pg_temp.jalan(siswa_u, format('select count(*)::text from fn_get_user_forum_scope(%L)', guru)));
  insert into hasil_uji(k,v) values ('S2_guru_tanya_scope_guru_lain', pg_temp.jalan(guru, format('select count(*)::text from fn_get_user_forum_scope(%L)', guru2)));
  insert into hasil_uji(k,v) values ('S3_guru_tanya_scope_sendiri', pg_temp.jalan(guru, format('select role_type from fn_get_user_forum_scope(%L)', guru)));

  -- jalur sah tetap jalan: membuat posting kelas memakai fn_get_forum_members secara internal
  insert into hasil_uji(k,v) values ('P1_buat_posting_kelas_staf', pg_temp.jalan(guru, format(
    $q$select count(*)::text from (select fn_create_forum_post(%L, %L, 'isi uji roster', null, '{}'::uuid[], 'STAF_SAJA', '{}'::uuid[], null, '{}'::uuid[], 'KELAS', 'UJI roster', gen_random_uuid())) t$q$, kelas_guru, yr)));
  insert into hasil_uji(k,v) values ('P2_penerima_tercatat', (select count(*)::text from forum_post_audience a join forum_posts p on p.post_id = a.post_id where p.title = 'UJI roster' and p.school_id = sid));
end $$;
select k, v from hasil_uji order by no;
