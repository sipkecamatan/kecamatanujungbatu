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
  sid uuid; yr text; sm semester; guru uuid; cls uuid; subj uuid; stu uuid; stu_lain uuid; guru_lain uuid; wali uuid; kep uuid; wakur uuid; wakes uuid;
  bk uuid; adm uuid; tu uuid; ortu uuid; siswa_u uuid; tp1 uuid := gen_random_uuid(); tp2 uuid := gen_random_uuid();
  ins text := 'insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode, tp_optimal, tp_perlu) values (%L,%L,%L,%L,%L,%L,%s,%s,''RATA'',%L,%L) returning ''ok''';
  q text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id = sid;
  -- guru + kelas + mapel yang benar-benar diajar, dengan siswa terdaftar
  select ta.user_id, ta.class_id, ta.subject_id into guru, cls, subj
    from teaching_assignments ta join users u on u.user_id = ta.user_id and u.teacher_code is not null and u.is_active
    where ta.school_id = sid and ta.is_active and ta.academic_year = yr and ta.semester::text = sm::text
      and exists (select 1 from class_enrollments ce where ce.class_id = ta.class_id and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null)
      and exists (select 1 from users w where w.school_id = sid and w.wali_kelas_class_id = ta.class_id)
    order by ta.user_id, ta.class_id limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select ce.student_id into stu_lain from class_enrollments ce where ce.school_id = sid and ce.class_id <> cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select u.user_id into guru_lain from users u where u.school_id = sid and u.teacher_code is not null and u.is_active and u.user_id <> guru
    and not exists (select 1 from teaching_assignments ta where ta.user_id = u.user_id and ta.class_id = cls and ta.subject_id = subj)
    and not exists (select 1 from teaching_schedules ts where ts.scheduled_teacher_id = u.user_id and ts.class_id = cls and ts.subject_id = subj) order by u.user_id limit 1;
  select user_id into wali from users where school_id = sid and wali_kelas_class_id = cls and is_active and user_id <> guru limit 1;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into wakur from users where school_id = sid and (role_type = 'WAKA_KURIKULUM' or is_waka_kurikulum) and is_active limit 1;
  select user_id into wakes from users where school_id = sid and (role_type = 'WAKA_KESISWAAN' or is_waka_kesiswaan) and is_active limit 1;
  select user_id into bk from users where school_id = sid and role_type = 'BK' and is_active limit 1;
  select user_id into adm from users where school_id = sid and role_type = 'ADMINISTRATIVE' and is_active limit 1;
  select user_id into tu from users where school_id = sid and role_type = 'TU' and is_active limit 1;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = stu limit 1;
  select user_id into siswa_u from students where student_id = stu;
  insert into hasil_uji(k,v) values ('persona', format('guru=%s kelas=%s mapel=%s siswa=%s siswa_lain=%s guru_lain=%s wali=%s kepsek=%s wakur=%s wakes=%s bk=%s admin=%s tu=%s ortu=%s siswa_akun=%s',
    guru is not null, cls is not null, subj is not null, stu is not null, stu_lain is not null, guru_lain is not null, wali is not null, kep is not null, wakur is not null, wakes is not null, bk is not null, adm is not null, tu is not null, ortu is not null, siswa_u is not null));

  -- Menulis: hanya guru yang mengajar kelas+mapel itu, untuk siswa terdaftar, nilai 0-100
  insert into hasil_uji(k,v) values ('R1_guru_menyimpan', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu, guru, yr, sm::text, '85', '{}'::uuid[], '{}'::uuid[])));
  insert into hasil_uji(k,v) values ('R2_siswa_bukan_di_kelas', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu_lain, guru, yr, sm::text, '85', '{}'::uuid[], '{}'::uuid[])));
  insert into hasil_uji(k,v) values ('R3_nilai_lebih_dari_100', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu, guru, yr, sm::text, '101', '{}'::uuid[], '{}'::uuid[])));
  insert into hasil_uji(k,v) values ('R4_tp_optimal_dan_perlu_tumpang_tindih', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu, guru, yr, sm::text, '70', array[tp1], array[tp1])));
  insert into hasil_uji(k,v) values ('R5_guru_yang_tidak_mengajar', pg_temp.jalan(guru_lain, format(ins, sid, cls, subj, stu, guru_lain, yr, sm::text, '90', '{}'::uuid[], '{}'::uuid[])));
  insert into hasil_uji(k,v) values ('R6_atas_nama_guru_lain', pg_temp.jalan(guru_lain, format(ins, sid, cls, subj, stu, guru, yr, sm::text, '90', '{}'::uuid[], '{}'::uuid[])));
  insert into hasil_uji(k,v) values ('R7_koreksi_oleh_penyimpan', pg_temp.jalan(guru, format('update grade_final set nilai_rapor = 88, tp_optimal = %L, tp_perlu = %L where class_id = %L and student_id = %L returning ''ok''', array[tp1], array[tp2], cls, stu)));

  -- Membaca: guru penyimpan, wali kelas, Kepsek, Waka Kurikulum; peran lain tidak
  q := format('select count(*)::text from grade_final where class_id = %L and subject_id = %L', cls, subj);
  insert into hasil_uji(k,v) values ('B_baca_per_peran', format('guru=%s guru_lain=%s wali=%s kepsek=%s wakur=%s wakes=%s bk=%s admin=%s tu=%s ortu=%s siswa=%s',
    pg_temp.jalan(guru, q), pg_temp.jalan(guru_lain, q), pg_temp.jalan(wali, q), pg_temp.jalan(kep, q), pg_temp.jalan(wakur, q), pg_temp.jalan(wakes, q),
    pg_temp.jalan(bk, q), pg_temp.jalan(adm, q), pg_temp.jalan(tu, q), pg_temp.jalan(ortu, q), pg_temp.jalan(siswa_u, q)));

  -- Pembaca (bukan penyimpan) tidak dapat mengubah atau menghapus
  insert into hasil_uji(k,v) values ('W_wali_ubah', pg_temp.jalan(wali, format('with u as (update grade_final set nilai_rapor = 1 where class_id = %L returning 1) select count(*)::text from u', cls)));
  insert into hasil_uji(k,v) values ('W_kepsek_ubah', pg_temp.jalan(kep, format('with u as (update grade_final set nilai_rapor = 1 where class_id = %L returning 1) select count(*)::text from u', cls)));
  insert into hasil_uji(k,v) values ('W_wakur_hapus', pg_temp.jalan(wakur, format('with d as (delete from grade_final where class_id = %L returning 1) select count(*)::text from d', cls)));
  insert into hasil_uji(k,v) values ('W_nilai_tetap_88', (select nilai_rapor::text from grade_final where class_id = cls and student_id = stu and subject_id = subj));

  -- Penyimpan dapat menghapus miliknya
  insert into hasil_uji(k,v) values ('D_penyimpan_hapus', pg_temp.jalan(guru, format('with d as (delete from grade_final where class_id = %L and student_id = %L returning 1) select count(*)::text from d', cls, stu)));
end $$;
select k, v from hasil_uji order by no;
