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
create or replace function pg_temp.sync(p_obs uuid, p_autor uuid, p_stu uuid, p_vis text) returns text language plpgsql as $f$
begin
  perform fn_sync_observation(null, p_obs, p_autor, p_stu, 'POSITIF', 'AKADEMIK', p_vis, 'catatan uji kebocoran visibilitas', now());
  return 'ok';
exception when assert_failure or others then
  return 'GALAT:' || sqlstate;
end $f$;
do $$
declare
  sid uuid; autor uuid; stu uuid; stu_lain uuid; siswa_u uuid; ortu uuid; siswa_lain_u uuid; ortu_lain uuid; wakhum uuid; kep uuid; bk uuid; wakes uuid; adm uuid;
  o_r uuid := gen_random_uuid(); o_p uuid := gen_random_uuid(); o_i uuid := gen_random_uuid(); o_s uuid := gen_random_uuid(); o_a uuid := gen_random_uuid(); o_b uuid := gen_random_uuid();
  o_c uuid := gen_random_uuid(); o_d uuid := gen_random_uuid(); o_m uuid := gen_random_uuid(); q text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select ts.scheduled_teacher_id, ce.student_id into autor, stu
  from teaching_schedules ts
  join class_enrollments ce on ce.class_id = ts.class_id and ce.academic_year = ts.academic_year and ce.withdrawn_at is null
  join students s on s.student_id = ce.student_id and s.user_id is not null
  join users u on u.user_id = ts.scheduled_teacher_id and u.teacher_code is not null and u.is_active and u.role_type = 'GURU'
  where ts.school_id = sid and exists (select 1 from student_parents sp where sp.student_id = ce.student_id)
  order by ts.scheduled_teacher_id, ce.student_id limit 1;
  select st.student_id into stu_lain from students st where st.school_id = sid and st.student_status = 'AKTIF' and st.user_id is not null
    and exists (select 1 from student_parents sp where sp.student_id = st.student_id)
    and not exists (select 1 from class_enrollments ce where ce.student_id = st.student_id and ce.withdrawn_at is null
        and (exists (select 1 from teaching_schedules ts where ts.class_id = ce.class_id and ts.scheduled_teacher_id = autor)
          or exists (select 1 from teaching_assignments ta where ta.class_id = ce.class_id and ta.user_id = autor and ta.is_active)))
    order by st.student_id limit 1;
  select user_id into siswa_u from students where student_id = stu;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = stu limit 1;
  select user_id into siswa_lain_u from students where student_id = stu_lain;
  select sp.parent_user_id into ortu_lain from student_parents sp where sp.student_id = stu_lain limit 1;
  select user_id into wakhum from users where school_id = sid and (role_type = 'WAKA_HUMAS' or is_waka_humas) and is_active limit 1;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into bk from users where school_id = sid and role_type = 'BK' and is_active limit 1;
  select user_id into wakes from users where school_id = sid and (role_type = 'WAKA_KESISWAAN' or is_waka_kesiswaan) and is_active limit 1;
  select user_id into adm from users where school_id = sid and role_type = 'ADMINISTRATIVE' and is_active limit 1;
  insert into hasil_uji(k,v) values ('persona', format('autor=%s stu=%s stu_lain=%s siswa=%s ortu=%s siswa_lain=%s ortu_lain=%s wakhum=%s',
    autor is not null, stu is not null, stu_lain is not null, siswa_u is not null, ortu is not null, siswa_lain_u is not null, ortu_lain is not null, wakhum is not null));

  -- L1: visibilitas di luar daftar putih lewat jalur Edge (fn_sync_observation)
  insert into hasil_uji(k,v) values ('L1a_RESTRICTED', pg_temp.sync(o_r, autor, stu, 'RESTRICTED'));
  insert into hasil_uji(k,v) values ('L1b_PUBLIC', pg_temp.sync(o_p, autor, stu, 'PUBLIC'));
  insert into hasil_uji(k,v) values ('L1c_INTERNAL_SCHOOL', pg_temp.sync(o_i, autor, stu, 'INTERNAL_SCHOOL'));
  insert into hasil_uji(k,v) values ('L1d_STUDENT_VISIBLE', pg_temp.sync(o_s, autor, stu, 'STUDENT_VISIBLE'));
  q := format('select count(*)::text from observations where observation_id = %L', o_r);
  insert into hasil_uji(k,v) values ('L1e_RESTRICTED_dibaca_waka_humas', pg_temp.jalan(wakhum, q));
  -- visibilitas yang sah tetap diterima
  insert into hasil_uji(k,v) values ('L1f_sah', format('private=%s siswa=%s ortu=%s keduanya=%s', pg_temp.sync(gen_random_uuid(), autor, stu, 'PRIVATE'), pg_temp.sync(gen_random_uuid(), autor, stu, 'SISWA_SAJA'),
    pg_temp.sync(gen_random_uuid(), autor, stu, 'ORTU_SAJA'), pg_temp.sync(o_a, autor, stu, 'SISWA_DAN_ORTU')));
  insert into hasil_uji(k,v) values ('L1g_sinkron_ulang_sah', pg_temp.sync(o_a, autor, stu, 'SISWA_DAN_ORTU'));

  -- L2: penulis memindahkan catatan ke siswa yang tidak diajar
  perform fn_sync_observation(null, o_b, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_DAN_ORTU', 'catatan uji pindah siswa asli', now());
  insert into hasil_uji(k,v) values ('L2a_update_pindah_siswa', pg_temp.jalan(autor, format('update observations set student_id = %L where observation_id = %L returning ''ok''', stu_lain, o_b)));
  insert into hasil_uji(k,v) values ('L2b_siswa_lain_membaca', pg_temp.jalan(siswa_lain_u, format('select count(*)::text from observations where observation_id = %L', o_b)));
  insert into hasil_uji(k,v) values ('L2c_ortu_lain_membaca', pg_temp.jalan(ortu_lain, format('select count(*)::text from observations where observation_id = %L', o_b)));
  insert into hasil_uji(k,v) values ('L2d_siswa_asli_tetap_membaca', pg_temp.jalan(siswa_u, format('select count(*)::text from observations where observation_id = %L', o_b)));
  -- penyuntingan sah tetap boleh (isi) dan pembatalan tetap berfungsi
  insert into hasil_uji(k,v) values ('L2e_sunting_isi_sah', pg_temp.jalan(autor, format('update observations set content = %L where observation_id = %L returning ''ok''', 'isi diperbarui oleh penulis', o_b)));
  insert into hasil_uji(k,v) values ('L2f_pembatalan_sah', case when pg_temp.jalan(autor, format('select fn_void_observation(%L, %L)::text', o_b, 'uji pembatalan')) like 'GALAT%' then 'GAGAL' else 'ok' end);

  -- Kontrol: peran lain tetap tidak membaca catatan biasa
  perform fn_sync_observation(null, o_c, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_SAJA', 'catatan uji biasa siswa saja', now());
  q := format('select count(*)::text from observations where observation_id = %L', o_c);
  insert into hasil_uji(k,v) values ('K1_peran_lain_membaca', format('wakhum=%s kepsek=%s bk=%s wakes=%s admin=%s siswa=%s ortu=%s penulis=%s',
    pg_temp.jalan(wakhum, q), pg_temp.jalan(kep, q), pg_temp.jalan(bk, q), pg_temp.jalan(wakes, q), pg_temp.jalan(adm, q), pg_temp.jalan(siswa_u, q), pg_temp.jalan(ortu, q), pg_temp.jalan(autor, q)));
end $$;
select k, v from hasil_uji order by no;
