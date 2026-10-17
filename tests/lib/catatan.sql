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
  sid uuid; autor uuid; guru_lain uuid; stu uuid; stu_lain uuid; ortu uuid; siswa_u uuid; adm uuid; kep uuid; bk uuid; waka uuid; wakur uuid; tu uuid;
  o uuid; o_pr uuid; o_sw uuid; o_or uuid; o_ds uuid; tgl date; n0 int; n1 int; r text; v text; q text; per uuid;
begin
  select school_id into sid from schools where slug='smkuji1';
  -- penulis + siswa yang diajarnya (punya akun siswa dan orang tua)
  select ts.scheduled_teacher_id, ce.student_id into autor, stu
  from teaching_schedules ts
  join class_enrollments ce on ce.class_id = ts.class_id and ce.academic_year = ts.academic_year and ce.withdrawn_at is null
  join students s on s.student_id = ce.student_id and s.user_id is not null
  join users u on u.user_id = ts.scheduled_teacher_id and u.teacher_code is not null and u.is_active and u.role_type = 'GURU'
  where ts.school_id = sid and exists (select 1 from student_parents sp where sp.student_id = ce.student_id)
  order by ts.scheduled_teacher_id, ce.student_id limit 1;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = stu limit 1;
  select user_id into siswa_u from students where student_id = stu;
  -- siswa yang TIDAK diajar penulis
  select st.student_id into stu_lain from students st where st.school_id = sid and st.student_status = 'AKTIF'
    and not exists (select 1 from class_enrollments ce where ce.student_id = st.student_id and ce.withdrawn_at is null
        and (exists (select 1 from teaching_schedules ts where ts.class_id = ce.class_id and ts.scheduled_teacher_id = autor)
          or exists (select 1 from teaching_assignments ta where ta.class_id = ce.class_id and ta.user_id = autor and ta.is_active)))
    order by st.student_id limit 1;
  -- guru lain yang mengajar siswa yang sama (untuk uji timpa) dan peran lain
  select u.user_id into guru_lain from users u where u.school_id = sid and u.role_type = 'GURU' and u.teacher_code is not null and u.is_active and u.user_id <> autor order by u.user_id limit 1;
  select user_id into adm from users where school_id = sid and role_type = 'ADMINISTRATIVE' and is_active limit 1;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into bk from users where school_id = sid and role_type = 'BK' and is_active limit 1;
  select user_id into waka from users where school_id = sid and (role_type = 'WAKA_KESISWAAN' or is_waka_kesiswaan) and is_active limit 1;
  select user_id into wakur from users where school_id = sid and (role_type = 'WAKA_KURIKULUM' or is_waka_kurikulum) and is_active limit 1;
  select user_id into tu from users where school_id = sid and role_type = 'TU' and is_active limit 1;
  insert into hasil_uji(k,v) values ('persona', format('autor=%s stu=%s stu_lain=%s ortu=%s siswa=%s adm=%s kep=%s bk=%s waka=%s wakur=%s tu=%s guru_lain=%s',
    autor is not null, stu is not null, stu_lain is not null, ortu is not null, siswa_u is not null, adm is not null, kep is not null, bk is not null, waka is not null, wakur is not null, tu is not null, guru_lain is not null));

  -- Server (jalur Edge memakai service_role): hubungan guru-siswa ditegakkan
  begin perform fn_sync_observation(null, gen_random_uuid(), autor, stu, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'catatan uji sepuluh karakter', now()); r := 'ok'; exception when assert_failure or others then r := 'GALAT:'||sqlstate; end;
  insert into hasil_uji(k,v) values ('A1_siswa_yang_diajar', r);
  begin perform fn_sync_observation(null, gen_random_uuid(), autor, stu_lain, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'catatan uji sepuluh karakter', now()); r := 'ok'; exception when assert_failure or others then r := 'GALAT:'||sqlstate; end;
  insert into hasil_uji(k,v) values ('A2_siswa_yang_tidak_diajar', r);
  -- upsert tidak boleh menimpa catatan penulis lain
  o := gen_random_uuid();
  perform fn_sync_observation(null, o, autor, stu, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'isi asli catatan uji', now());
  begin perform fn_sync_observation(null, o, guru_lain, stu, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'isi ditimpa guru lain', now()); exception when assert_failure or others then null; end;
  insert into hasil_uji(k,v) values ('A3_tidak_menimpa_catatan_penulis_lain', (select content from observations where observation_id = o));
  -- akun dihapus lunak ditolak
  perform set_config('app.bypass_users_guard', 'on', true);   -- kolom dilindungi: hanya untuk menyiapkan keadaan uji, di dalam transaksi yang dibatalkan
  update users set deleted_at = now() where user_id = autor;
  begin perform fn_sync_observation(null, gen_random_uuid(), autor, stu, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'catatan uji sepuluh karakter', now()); r := 'ok'; exception when assert_failure or others then r := 'GALAT:'||sqlstate; end;
  update users set deleted_at = null where user_id = autor;
  perform set_config('app.bypass_users_guard', 'off', true);
  insert into hasil_uji(k,v) values ('A4_akun_dihapus_lunak', r);
  -- periode ditutup mengunci penambahan
  tgl := date '2020-01-15';
  insert into academic_periods(school_id, academic_year, semester, start_date, end_date, status) values (sid, '2019/2020', '1', '2020-01-01', '2020-01-31', 'CLOSED');
  begin perform fn_sync_observation(null, gen_random_uuid(), autor, stu, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'catatan uji sepuluh karakter', tgl); r := 'ok'; exception when assert_failure or others then r := 'GALAT:'||sqlstate; end;
  insert into hasil_uji(k,v) values ('A5_periode_ditutup', r);

  -- Notifikasi per visibilitas (siswa dan orang tua)
  foreach v in array array['PRIVATE','SISWA_SAJA','ORTU_SAJA','SISWA_DAN_ORTU'] loop
    select count(*) into n0 from notifications where type = 'OBSERVATION_NEW';
    perform fn_sync_observation(null, gen_random_uuid(), autor, stu, 'POSITIF', 'AKADEMIK', v, 'catatan uji sepuluh karakter', now());
    select count(*) into n1 from notifications where type = 'OBSERVATION_NEW';
    insert into hasil_uji(k,v) values ('B_notifikasi_'||v, (n1 - n0)::text);
  end loop;

  -- Siapa yang boleh membaca: penulis, siswa, orang tua sesuai visibilitas; peran lain sekolah tidak
  o_pr := gen_random_uuid(); o_sw := gen_random_uuid(); o_or := gen_random_uuid(); o_ds := gen_random_uuid();
  perform fn_sync_observation(null, o_pr, autor, stu, 'POSITIF', 'AKADEMIK', 'PRIVATE', 'catatan privat rahasia uji', now());
  perform fn_sync_observation(null, o_sw, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_SAJA', 'catatan siswa saja uji', now());
  perform fn_sync_observation(null, o_or, autor, stu, 'POSITIF', 'AKADEMIK', 'ORTU_SAJA', 'catatan ortu saja uji', now());
  perform fn_sync_observation(null, o_ds, autor, stu, 'POSITIF', 'AKADEMIK', 'SISWA_DAN_ORTU', 'catatan siswa dan ortu uji', now());
  q := format('select count(*)::text from observations where observation_id in (%L,%L,%L,%L)', o_pr, o_sw, o_or, o_ds);
  insert into hasil_uji(k,v) values ('C_baca_per_peran', format('penulis=%s siswa=%s ortu=%s admin=%s kepsek=%s bk=%s waka_kesiswaan=%s waka_kurikulum=%s tu=%s guru_lain=%s',
    pg_temp.jalan(autor, q), pg_temp.jalan(siswa_u, q), pg_temp.jalan(ortu, q), pg_temp.jalan(adm, q), pg_temp.jalan(kep, q), pg_temp.jalan(bk, q),
    pg_temp.jalan(waka, q), pg_temp.jalan(wakur, q), pg_temp.jalan(tu, q), pg_temp.jalan(guru_lain, q)));

  -- Pembatalan oleh penulis
  insert into hasil_uji(k,v) values ('D1_batal_oleh_guru_lain', pg_temp.jalan(guru_lain, format('select fn_void_observation(%L, ''bukan milik saya'')::text', o_ds)));
  insert into hasil_uji(k,v) values ('D2_alasan_pendek', pg_temp.jalan(autor, format('select fn_void_observation(%L, ''abc'')::text', o_ds)));
  insert into hasil_uji(k,v) values ('D3_batal_oleh_penulis', pg_temp.jalan(autor, format('select fn_void_observation(%L, ''salah siswa uji'')::text', o_ds)));
  insert into hasil_uji(k,v) values ('D4_batal_dua_kali', pg_temp.jalan(autor, format('select fn_void_observation(%L, ''salah siswa uji'')::text', o_ds)));
  insert into hasil_uji(k,v) values ('D5_batal_oleh_admin', pg_temp.jalan(adm, format('select fn_void_observation(%L, ''admin mencoba membatalkan'')::text', o_or)));
  insert into hasil_uji(k,v) values ('D6_tersembunyi_dari_siswa_dan_ortu_setelah_batal', format('siswa=%s ortu=%s',
    pg_temp.jalan(siswa_u, format('select count(*)::text from observations where observation_id=%L', o_ds)),
    pg_temp.jalan(ortu, format('select count(*)::text from observations where observation_id=%L', o_ds))));

  -- Admin: hanya hitungan; tidak membaca dan tidak mengubah
  insert into hasil_uji(k,v) values ('E1_admin_hitungan', (pg_temp.jalan(adm, 'select (fn_admin_observation_count() >= 5)::text')));
  insert into hasil_uji(k,v) values ('E2_admin_ubah_baris', pg_temp.jalan(adm, format('with u as (update observations set is_void = true where observation_id=%L returning 1) select count(*)::text from u', o_pr)));
  insert into hasil_uji(k,v) values ('E3_guru_memanggil_fungsi_admin', pg_temp.jalan(autor, 'select fn_admin_observation_count()::text'));
  insert into hasil_uji(k,v) values ('E4_kebijakan_void_admin_tidak_ada', (select count(*)::text from pg_policies where tablename = 'observations' and policyname = 'rls_observations_void_admin'));
end $$;
select k, v from hasil_uji order by no;
