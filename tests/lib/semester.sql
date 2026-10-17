create temp table _r(k text, v text) on commit drop;
grant all on _r to authenticated;
create or replace function pg_temp.jalan(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare a uuid; r text;
begin
  select auth_user_id into a from users where user_id = p_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into r; reset role; return coalesce(r,'NULL');
  exception when others then reset role; return 'GALAT:'||sqlstate||' '||left(sqlerrm,80); end;
end $f$;
do $$
declare sid uuid; adm uuid; cfg uuid; per uuid; yr text; creator uuid; cid uuid; stu uuid; cls uuid; n1 int; n2 int; kand text;
begin
  select school_id into sid from schools where slug='smkuji1';
  select user_id into adm from users where school_id=sid and role_type='ADMINISTRATIVE' and is_active limit 1;
  select config_id, current_academic_year into cfg, yr from school_config where school_id=sid;
  select id into per from academic_periods where school_id=sid and academic_year=yr and semester='1';
  select user_id into creator from users where school_id=sid and teacher_code='ABA';
  select ce.class_id, ce.student_id into cls, stu from class_enrollments ce join classes c on c.class_id=ce.class_id where ce.school_id=sid and c.name='XI AKL 1' and ce.semester='1' and ce.withdrawn_at is null order by ce.student_id limit 1;
  insert into coaching_cases (school_id, student_id, title, description, track, status, created_by_user_id, current_handler_user_id)
    values (sid, stu, 'UJI-SEM2', 'Deskripsi kasus uji semester dua yang cukup panjang.', 'SEKOLAH', 'OPEN', creator, creator) returning case_id into cid;
  insert into _r values('kandidat_semester1', pg_temp.jalan(creator, format('select string_agg(distinct relation_label, '','') from fn_case_tag_candidates(%L) where relation_label in (''Wali Kelas'',''Guru BK'',''Kaprodi'')', cid)));
  insert into _r values('tutup_semester1', pg_temp.jalan(adm, format('select fn_close_semester(%L, %L, ''1'')::text', per, cfg)));
  insert into _r values('semester_berjalan', (select current_semester::text from school_config where config_id=cfg));
  select count(*) into n1 from class_enrollments where school_id=sid and academic_year=yr and semester='2';
  insert into _r values('enrollment_semester2_setelah_tutup', n1::text);
  insert into _r values('buka_semester2_oleh_guru', pg_temp.jalan(creator, 'select fn_open_next_semester(date ''2027-01-04'', date ''2027-06-30'')::text'));
  insert into _r values('buka_semester2_rentang_tidak_valid', pg_temp.jalan(adm, 'select fn_open_next_semester(date ''2027-06-30'', date ''2027-01-04'')::text'));
  insert into _r values('buka_semester2_oleh_admin', (select (r::jsonb->>'period_created')||' '||(r::jsonb->>'enrolled')::text from (select pg_temp.jalan(adm, 'select fn_open_next_semester(date ''2027-01-04'', date ''2027-06-30'')::text') r) x));
  select count(*) into n1 from class_enrollments where school_id=sid and academic_year=yr and semester='2';
  select count(*) into n2 from class_enrollments ce join students s on s.student_id=ce.student_id where ce.school_id=sid and ce.academic_year=yr and ce.semester='1' and ce.withdrawn_at is null and s.student_status in ('AKTIF','PKL');
  insert into _r values('enrollment_semester2_sama_dengan_semester1', (n1=n2 and n1>0)::text);
  insert into _r values('buka_ulang_idempoten', (select (r::jsonb->>'period_created')||' '||(r::jsonb->>'enrolled') from (select pg_temp.jalan(adm, 'select fn_open_next_semester(date ''2027-01-04'', date ''2027-06-30'')::text') r) x));
  insert into _r values('kandidat_semester2', pg_temp.jalan(creator, format('select coalesce(string_agg(distinct relation_label, '','') ,''(kosong)'') from fn_case_tag_candidates(%L) where relation_label in (''Wali Kelas'',''Guru BK'',''Kaprodi'')', cid)));
end $$;
select k, v from _r order by k;
