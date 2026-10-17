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
  sid uuid; guru uuid; cls uuid; cls_lain uuid; yr text; sm semester; subj uuid; asmt uuid;
  stu uuid; stu_lain uuid; stu_sekolah_lain uuid; jid uuid := gen_random_uuid();
  hasil text := 'insert into assessment_results (school_id, class_id, assessment_id, student_id, nilai) values (%L, %L, %L, %L, 80) returning ''ok''';
  jur text := 'insert into teacher_journals (journal_id, owner_user_id, school_id, content, entry_date) values (%L, %L, %L, ''isi jurnal uji'', %s) returning ''ok''';
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id = sid;
  select user_id into guru from users where school_id = sid and teacher_code = 'ABA';
  select ce.class_id into cls from class_enrollments ce join classes c on c.class_id = ce.class_id
    where ce.school_id = sid and c.name = 'XI AKL 1' and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  -- kelas lain dan siswa yang TIDAK terdaftar di kelas asesmen
  select ce.class_id, ce.student_id into cls_lain, stu_lain from class_enrollments ce
    where ce.school_id = sid and ce.class_id <> cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select st.student_id into stu_sekolah_lain from students st where st.school_id <> sid limit 1;
  select subject_id into subj from subjects where school_id = sid limit 1;
  insert into assessments (school_id, class_id, subject_id, academic_year, semester, teacher_id, jenis)
    values (sid, cls, subj, yr, sm::text::int, guru, 'SUMATIF') returning id into asmt;
  insert into hasil_uji(k,v) values ('persona', format('guru=%s kelas=%s siswa=%s siswa_lain_kelas=%s siswa_sekolah_lain=%s mapel=%s asesmen=%s',
    guru is not null, cls is not null, stu is not null, stu_lain is not null, stu_sekolah_lain is not null, subj is not null, asmt is not null));

  -- A-02: nilai hanya untuk siswa terdaftar di kelas asesmen, pada periodenya
  insert into hasil_uji(k,v) values ('N1_siswa_di_kelas', pg_temp.jalan(guru, format(hasil, sid, cls, asmt, stu)));
  insert into hasil_uji(k,v) values ('N2_siswa_bukan_di_kelas', pg_temp.jalan(guru, format(hasil, sid, cls, asmt, stu_lain)));
  insert into hasil_uji(k,v) values ('N3_kelas_hasil_tidak_sama_dengan_asesmen', pg_temp.jalan(guru, format(hasil, sid, cls_lain, asmt, stu_lain)));
  insert into hasil_uji(k,v) values ('N4_siswa_sekolah_lain', pg_temp.jalan(guru, format(hasil, sid, cls, asmt, stu_sekolah_lain)));
  insert into hasil_uji(k,v) values ('N5_koreksi_nilai_baris_yang_ada', pg_temp.jalan(guru, format('update assessment_results set nilai = 90 where assessment_id = %L and student_id = %L returning ''ok''', asmt, stu)));
  update class_enrollments set withdrawn_at = now() where student_id = stu and class_id = cls and academic_year = yr and semester = sm;
  insert into hasil_uji(k,v) values ('N6_koreksi_setelah_siswa_pindah', pg_temp.jalan(guru, format('update assessment_results set nilai = 95 where assessment_id = %L and student_id = %L returning ''ok''', asmt, stu)));
  insert into hasil_uji(k,v) values ('N7_hasil_tersimpan', (select count(*)::text from assessment_results where assessment_id = asmt));

  -- A-06: tanggal jurnal (WIB) tidak di masa depan dan tidak lebih dari setahun ke belakang
  insert into hasil_uji(k,v) values ('J1_hari_ini', pg_temp.jalan(guru, format(jur, jid, guru, sid, 'public.fn_hari_ini()')));
  insert into hasil_uji(k,v) values ('J2_besok', pg_temp.jalan(guru, format(jur, gen_random_uuid(), guru, sid, 'public.fn_hari_ini() + 1')));
  insert into hasil_uji(k,v) values ('J3_dua_tahun_lalu', pg_temp.jalan(guru, format(jur, gen_random_uuid(), guru, sid, 'public.fn_hari_ini() - 730')));
  insert into hasil_uji(k,v) values ('J4_sebelas_bulan_lalu', pg_temp.jalan(guru, format(jur, gen_random_uuid(), guru, sid, 'public.fn_hari_ini() - 330')));
  insert into hasil_uji(k,v) values ('J5_ubah_isi_tanpa_ubah_tanggal', pg_temp.jalan(guru, format('update teacher_journals set content = ''isi diubah uji'' where journal_id = %L returning ''ok''', jid)));
  insert into hasil_uji(k,v) values ('J6_ubah_tanggal_ke_masa_depan', pg_temp.jalan(guru, format('update teacher_journals set entry_date = public.fn_hari_ini() + 3 where journal_id = %L returning ''ok''', jid)));
end $$;
select k, v from hasil_uji order by no;
