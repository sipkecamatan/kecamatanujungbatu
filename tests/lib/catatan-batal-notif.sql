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
    return coalesce(r, 'NULL');
  exception when assert_failure or others then
    reset role;
    return 'GALAT:' || sqlstate;
  end;
end $f$;
do $$
declare
  sid uuid; autor uuid; guru_lain uuid; stu uuid; ortu uuid; siswa_u uuid;
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); lama uuid;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select ts.scheduled_teacher_id, ce.student_id into autor, stu
  from teaching_schedules ts
  join class_enrollments ce on ce.class_id = ts.class_id and ce.academic_year = ts.academic_year and ce.withdrawn_at is null
  join students s on s.student_id = ce.student_id and s.user_id is not null
  join users u on u.user_id = ts.scheduled_teacher_id and u.teacher_code is not null and u.is_active and u.role_type = 'GURU'
  where ts.school_id = sid and exists (select 1 from student_parents sp where sp.student_id = ce.student_id)
  order by ts.scheduled_teacher_id, ce.student_id limit 1;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = stu limit 1;
  select user_id into siswa_u from students where student_id = stu;
  select u.user_id into guru_lain from users u where u.school_id = sid and u.role_type = 'GURU' and u.teacher_code is not null and u.is_active and u.user_id <> autor order by u.user_id limit 1;
  insert into hasil_uji(k,v) values ('persona', format('autor=%s stu=%s ortu=%s siswa=%s guru_lain=%s', autor is not null, stu is not null, ortu is not null, siswa_u is not null, guru_lain is not null));

  -- notifikasi lama tanpa sambungan (sebelum migrasi) harus tetap utuh
  insert into notifications(school_id, recipient_user_id, type, title, body) values (sid, siswa_u, 'OBSERVATION_NEW', 'Catatan guru baru', 'notifikasi lama uji') returning notification_id into lama;

  perform fn_sync_observation(null, o1, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_DAN_ORTU', 'catatan uji pertama untuk notifikasi', now());
  perform fn_sync_observation(null, o2, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_DAN_ORTU', 'catatan uji kedua untuk notifikasi', now());
  insert into hasil_uji(k,v) values ('N1_notifikasi_tersambung', (select format('o1=%s o2=%s', count(*) filter (where observation_id = o1), count(*) filter (where observation_id = o2)) from notifications));

  -- guru lain tidak dapat membatalkan; notifikasi tetap
  insert into hasil_uji(k,v) values ('N2_guru_lain_tak_dapat_membatalkan', pg_temp.jalan(guru_lain, format('select fn_void_observation(%L, %L)::text', o1, 'bukan milik saya')));
  insert into hasil_uji(k,v) values ('N3_notifikasi_tetap_setelah_ditolak', (select count(*)::text from notifications where observation_id = o1));

  -- penulis membatalkan catatan pertama
  insert into hasil_uji(k,v) values ('N4_penulis_membatalkan', case when pg_temp.jalan(autor, format('select fn_void_observation(%L, %L)::text', o1, 'uji pembatalan notifikasi')) like 'GALAT%' then 'GAGAL' else 'ok' end);
  insert into hasil_uji(k,v) values ('N5_notifikasi_catatan_batal_hilang', (select count(*)::text from notifications where observation_id = o1));
  insert into hasil_uji(k,v) values ('N6_catatan_lain_tetap_diberitahu', (select count(*)::text from notifications where observation_id = o2));
  insert into hasil_uji(k,v) values ('N7_notifikasi_lama_tak_tersentuh', (select count(*)::text from notifications where notification_id = lama));
  insert into hasil_uji(k,v) values ('N8_siswa_tak_membaca_catatan_batal', pg_temp.jalan(siswa_u, format('select count(*)::text from observations where observation_id = %L', o1)));
  insert into hasil_uji(k,v) values ('N9_ortu_tak_membaca_catatan_batal', pg_temp.jalan(ortu, format('select count(*)::text from observations where observation_id = %L', o1)));
  insert into hasil_uji(k,v) values ('N10_siswa_masih_membaca_catatan_lain', pg_temp.jalan(siswa_u, format('select count(*)::text from observations where observation_id = %L', o2)));
  insert into hasil_uji(k,v) values ('N11_batal_dua_kali_ditolak', pg_temp.jalan(autor, format('select fn_void_observation(%L, %L)::text', o1, 'uji pembatalan kedua')));
end $$;
select k, v from hasil_uji order by no;
