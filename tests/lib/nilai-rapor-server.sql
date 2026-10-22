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
    return 'GALAT:' || sqlstate || ':' || left(sqlerrm, 40);
  end;
end $f$;
do $$
declare
  sid uuid; yr text; sm semester; guru uuid; guru_lain uuid; cls uuid; subj uuid; stu uuid; stu2 uuid; stu3 uuid;
  lo_a uuid; lo_b uuid; lo_c uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid; a_lain uuid; a_form uuid; smi int;
  rm text; ins text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id = sid;
  smi := sm::text::int;
  -- guru + kelas + mapel yang BELUM punya penilaian sumatif pada periode ini (hitungan tangan tidak boleh tercampur data lain)
  select ta.user_id, ta.class_id, ta.subject_id into guru, cls, subj
    from teaching_assignments ta join users u on u.user_id = ta.user_id and u.teacher_code is not null and u.is_active and u.role_type = 'GURU'
    where ta.school_id = sid and ta.is_active and ta.academic_year = yr and ta.semester::text = sm::text
      and (select count(*) from class_enrollments ce where ce.class_id = ta.class_id and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null) >= 3
      and not exists (select 1 from assessments a where a.teacher_id = ta.user_id and a.class_id = ta.class_id and a.subject_id = ta.subject_id and a.academic_year = yr and a.semester::text = sm::text)
      and not exists (select 1 from learning_objectives l where l.teacher_id = ta.user_id and l.class_id = ta.class_id and l.subject_id = ta.subject_id and l.academic_year = yr and l.semester::text = sm::text)
      and not exists (select 1 from grade_final g where g.teacher_id = ta.user_id and g.class_id = ta.class_id and g.subject_id = ta.subject_id and g.academic_year = yr and g.semester::text = sm::text)
    order by ta.user_id, ta.class_id limit 1;
  insert into hasil_uji(k,v) values ('persona', 'guru_bersih=' || (guru is not null)::text);
  if guru is null then return; end if;
  select ce.student_id into stu  from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select ce.student_id into stu2 from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null and ce.student_id <> stu order by ce.student_id limit 1;
  select ce.student_id into stu3 from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null and ce.student_id not in (stu, stu2) order by ce.student_id limit 1;
  select user_id into guru_lain from users where school_id = sid and role_type = 'GURU' and is_active and user_id <> guru order by user_id limit 1;

  -- TP A (batas 70), TP B (batas 80), TP C (batas 70; tanpa penilaian), urutan 1..3
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp, urutan) values (sid, guru, cls, subj, yr, smi, 'UJI-A', 'TP A', 1) returning id into lo_a;
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp, urutan) values (sid, guru, cls, subj, yr, smi, 'UJI-B', 'TP B', 2) returning id into lo_b;
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp, urutan) values (sid, guru, cls, subj, yr, smi, 'UJI-C', 'TP C', 3) returning id into lo_c;
  insert into assessment_criteria (learning_objective_id, school_id, urutan, rentang) values
    (lo_a, sid, 1, '{"SB":[85,100],"BSH":[70,84],"MB":[55,69],"BB":[0,54]}'::jsonb),
    (lo_b, sid, 1, '{"SB":[90,100],"BSH":[80,89],"MB":[60,79],"BB":[0,59]}'::jsonb),
    (lo_c, sid, 1, '{"SB":[85,100],"BSH":[70,84],"MB":[55,69],"BB":[0,54]}'::jsonb);
  -- empat penilaian sumatif: a1 -> A; a2 -> A dan B; a3 -> B; a4 -> tanpa TP
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik) values (sid, guru, cls, subj, yr, smi, 'SUMATIF', 'TES') returning id into a1;
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik) values (sid, guru, cls, subj, yr, smi, 'SUMATIF', 'TES') returning id into a2;
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik) values (sid, guru, cls, subj, yr, smi, 'SUMATIF', 'TES') returning id into a3;
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik) values (sid, guru, cls, subj, yr, smi, 'SUMATIF', 'TES') returning id into a4;
  insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (a1, lo_a, sid), (a2, lo_a, sid), (a2, lo_b, sid), (a3, lo_b, sid);
  -- stu: 80, 60, 90, 100 | stu2: 50, -, 70, - | stu3: tanpa nilai
  insert into assessment_results (school_id, class_id, assessment_id, student_id, nilai) values
    (sid, cls, a1, stu, 80), (sid, cls, a2, stu, 60), (sid, cls, a3, stu, 90), (sid, cls, a4, stu, 100),
    (sid, cls, a1, stu2, 50), (sid, cls, a3, stu2, 70);
  -- gangguan yang TIDAK boleh ikut hitung: penilaian sumatif milik guru lain, dan penilaian formatif milik guru ini (nilai 0 untuk stu)
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik) values (sid, guru_lain, cls, subj, yr, smi, 'SUMATIF', 'TES') returning id into a_lain;
  insert into assessment_results (school_id, class_id, assessment_id, student_id, nilai) values (sid, cls, a_lain, stu, 0);
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik) values (sid, guru, cls, subj, yr, smi, 'FORMATIF', 'TES') returning id into a_form;
  insert into assessment_results (school_id, class_id, assessment_id, student_id, nilai) values (sid, cls, a_form, stu, 0);

  -- Simpan sebagai guru: angka kiriman 100 harus DIABAIKAN; yang tersimpan hasil hitung database
  ins := 'insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode, rumus) values (%L,%L,%L,%L,%L,%L,%s,100,%L,%L::jsonb) returning nilai_rapor::int::text||''/''||metode';
  -- stu: RATA 83 (82,5 dibulatkan), BOBOT 85, PERSEN 50, TERAKHIR 75; satu per satu pada baris yang sama (upsert via update setelah insert pertama)
  insert into hasil_uji(k,v) values ('S1_rata_stu', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu, guru, yr, smi::text, 'MANUAL', '{"metode":"RATA"}')));
  for rm in select unnest(array['BOBOT','PERSEN','TERAKHIR']) loop
    insert into hasil_uji(k,v) values ('S1_' || lower(rm) || '_stu', pg_temp.jalan(guru, format(
      'update grade_final set nilai_rapor = 100, metode = ''MANUAL'', rumus = %L::jsonb where student_id = %L and class_id = %L and subject_id = %L and teacher_id = %L returning nilai_rapor::int::text||''/''||metode',
      case when rm = 'BOBOT' then json_build_object('metode','BOBOT','bobot', json_build_object(a1::text,20,a2::text,20,a3::text,30,a4::text,30))::text else json_build_object('metode', rm)::text end,
      stu, cls, subj, guru)));
  end loop;
  -- stu2: RATA 60, BOBOT 62 (bobot dinormalkan atas penilaian yang bernilai), PERSEN 0, TERAKHIR 70
  insert into hasil_uji(k,v) values ('S2_rata_stu2', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu2, guru, yr, smi::text, 'MANUAL', '{"metode":"RATA"}')));
  for rm in select unnest(array['BOBOT','PERSEN','TERAKHIR']) loop
    insert into hasil_uji(k,v) values ('S2_' || lower(rm) || '_stu2', pg_temp.jalan(guru, format(
      'update grade_final set nilai_rapor = 100, metode = ''MANUAL'', rumus = %L::jsonb where student_id = %L and class_id = %L and subject_id = %L and teacher_id = %L returning nilai_rapor::int::text||''/''||metode',
      case when rm = 'BOBOT' then json_build_object('metode','BOBOT','bobot', json_build_object(a1::text,20,a2::text,20,a3::text,30,a4::text,30))::text else json_build_object('metode', rm)::text end,
      stu2, cls, subj, guru)));
  end loop;
  -- Ditolak: bobot belum 100%, siswa tanpa nilai, tanpa rumus / angka manual
  insert into hasil_uji(k,v) values ('T1_bobot_90_ditolak', pg_temp.jalan(guru, format(
    'update grade_final set rumus = %L::jsonb where student_id = %L and class_id = %L and teacher_id = %L returning nilai_rapor::text',
    json_build_object('metode','BOBOT','bobot', json_build_object(a1::text,20,a2::text,20,a3::text,30,a4::text,20))::text, stu, cls, guru)));
  insert into hasil_uji(k,v) values ('T2_siswa_tanpa_nilai_ditolak', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu3, guru, yr, smi::text, 'RATA', '{"metode":"RATA"}')));
  insert into hasil_uji(k,v) values ('T3_tanpa_rumus_ditolak', pg_temp.jalan(guru, format(
    'insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode) values (%L,%L,%L,%L,%L,%L,%s,77,''MANUAL'') returning nilai_rapor::text', sid, cls, subj, stu3, guru, yr, smi::text)));
  insert into hasil_uji(k,v) values ('T4_metode_asing_ditolak', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu3, guru, yr, smi::text, 'RATA', '{"metode":"MANUAL"}')));
  -- Percobaan mengubah angka langsung pada baris yang ada: diabaikan (dihitung ulang dari rumus tersimpan: RATA stu = 83)
  insert into hasil_uji(k,v) values ('U1_ubah_angka_langsung_diabaikan', pg_temp.jalan(guru, format(
    'update grade_final set nilai_rapor = 100, rumus = ''{"metode":"RATA"}''::jsonb where student_id = %L and class_id = %L and teacher_id = %L returning nilai_rapor::int::text', stu, cls, guru)));
  -- Perubahan yang tidak menyentuh angka/metode/rumus (izin tampil) tidak memicu hitung ulang: angka (yang diatur lewat jalur tanpa pengguna) tetap
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);   -- tanpa pengguna (seperti migrasi/service role)
  update grade_final set nilai_rapor = 55 where student_id = stu and class_id = cls and teacher_id = guru;   -- tidak dipaksa
  insert into hasil_uji(k,v) values ('U2_izin_tampil_tak_hitung_ulang', pg_temp.jalan(guru, format(
    'update grade_final set is_visible_siswa = true where student_id = %L and class_id = %L and teacher_id = %L returning nilai_rapor::int::text', stu, cls, guru)));
  -- Jalur tanpa pengguna (migrasi/service role/wizard) tidak dipaksa
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode)
    values (sid, cls, subj, stu3, guru, yr, smi, 99, 'MANUAL');
  insert into hasil_uji(k,v) values ('V1_jalur_tanpa_pengguna_tidak_dipaksa', (select nilai_rapor::int::text || '/' || metode from grade_final where student_id = stu3 and class_id = cls and teacher_id = guru));
  -- Semua penilaian hasil sumatif guru lain dan formatif tidak ikut: RATA stu tetap 83 (bukan (80+60+90+100+0+0)/6)
  insert into hasil_uji(k,v) values ('W1_hanya_sumatif_milik_guru_ini', pg_temp.jalan(guru, format(
    'update grade_final set nilai_rapor = 1, rumus = ''{"metode":"RATA"}''::jsonb where student_id = %L and class_id = %L and teacher_id = %L returning nilai_rapor::int::text', stu, cls, guru)));
end $$;
select k, v from hasil_uji order by no;
