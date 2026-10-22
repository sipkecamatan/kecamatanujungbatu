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
-- Angka nilai rapor kini DITETAPKAN SERVER (migrasi 20261020150000; diuji khusus di nilai-rapor-server.sql). Uji ini menulis angka sembarang untuk menguji hal lain
-- (izin, kunci periode, hak peran), jadi pemicu hitung dimatikan DI DALAM transaksi uji ini (transaksi selalu dibatalkan).
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'trg_grade_final_hitung') then execute 'alter table public.grade_final disable trigger trg_grade_final_hitung'; end if;
end $$;
do $$
declare
  sid uuid; yr text; sm semester; guru uuid; cls uuid; subj uuid; stu uuid; stu2 uuid; ortu uuid; siswa_u uuid; kep uuid; wakur uuid; wakes uuid; bk uuid; adm uuid; guru_flag uuid;
  lo1 uuid; lo2 uuid; lo3 uuid; stu3d uuid; asmt2 uuid; lo_lain uuid; kelas_lain uuid; asmt uuid; q text; ringkas text; kaprodi uuid; wakhum uuid; qa text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id = sid;
  select ta.user_id, ta.class_id, ta.subject_id into guru, cls, subj
    from teaching_assignments ta join users u on u.user_id = ta.user_id and u.teacher_code is not null and u.is_active and u.role_type = 'GURU'
    where ta.school_id = sid and ta.is_active and ta.academic_year = yr and ta.semester::text = sm::text
      and (select count(*) from class_enrollments ce where ce.class_id = ta.class_id and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null) >= 2
    order by ta.user_id, ta.class_id limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select ce.student_id into stu2 from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null and ce.student_id <> stu order by ce.student_id limit 1;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = stu limit 1;
  select user_id into siswa_u from students where student_id = stu;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into wakur from users where school_id = sid and role_type = 'WAKA_KURIKULUM' and is_active limit 1;
  select user_id into wakes from users where school_id = sid and role_type = 'WAKA_KESISWAAN' and is_active limit 1;
  select user_id into bk from users where school_id = sid and role_type = 'BK' and teacher_code is not null and is_active limit 1;
  select user_id into adm from users where school_id = sid and role_type = 'ADMINISTRATIVE' and is_active limit 1;
  select user_id into guru_flag from users where school_id = sid and role_type = 'GURU' and is_active and user_id <> guru order by user_id limit 1;
  select user_id into kaprodi from users where school_id = sid and role_type = 'KAPRODI' and is_active limit 1;
  select user_id into wakhum from users where school_id = sid and role_type = 'WAKA_HUMAS' and is_active limit 1;
  insert into hasil_uji(k,v) values ('persona', format('guru=%s kelas=%s siswa=%s siswa2=%s ortu=%s siswa_akun=%s kepsek=%s wakur=%s wakes=%s bk_mengajar=%s admin=%s guru_lain=%s',
    guru is not null, cls is not null, stu is not null, stu2 is not null, ortu is not null, siswa_u is not null, kep is not null, wakur is not null, wakes is not null, bk is not null, adm is not null, guru_flag is not null));

  -- 1. Peran ganda: pengajar berperan BK (bukan GURU) tetap dapat membuat dan membaca TP/penilaian miliknya
  insert into hasil_uji(k,v) values ('M1_pengajar_non_guru_membuat_tp', pg_temp.jalan(bk, format(
    'insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp) values (%L,%L,%L,%L,%L,%s,''UJI-BK'',''TP uji peran ganda'') returning ''ok''', sid, bk, cls, subj, yr, sm::text)));
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis) values (sid, bk, cls, subj, yr, sm::text::int, 'FORMATIF');
  insert into hasil_uji(k,v) values ('M2_pengajar_non_guru_membaca_penilaian_sendiri', pg_temp.jalan(bk, format('select count(*)::text from assessments where teacher_id = %L', bk)));
  insert into hasil_uji(k,v) values ('M3_guru_lain_tidak_membaca_milik_bk', pg_temp.jalan(guru_flag, format('select count(*)::text from assessments where teacher_id = %L', bk)));

  -- data nilai per TP: TP + KKTP (BSH >= 70) + penilaian sumatif + dua hasil (80 dan 60)
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp)
    values (sid, guru, cls, subj, yr, sm::text::int, 'UJI-TP1', 'TP uji nilai per TP') returning id into lo1;
  insert into assessment_criteria (learning_objective_id, school_id, urutan, rentang)
    values (lo1, sid, 1, '{"SB":[90,100],"BSH":[70,89],"MB":[56,69],"BB":[0,55]}'::jsonb);
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis)
    values (sid, guru, cls, subj, yr, sm::text::int, 'SUMATIF') returning id into asmt;
  insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (asmt, lo1, sid);
  insert into assessment_results (school_id, class_id, assessment_id, student_id, nilai) values (sid, cls, asmt, stu, 80), (sid, cls, asmt, stu2, 60);

  -- 2. Waka Kurikulum dan Kepala Sekolah melihat nilai setiap TP otomatis; peran lain ditolak
  q := format('select rata_rata::text||''/''||tercapai||''/''||belum_tercapai||''/''||jumlah_siswa||''/''||ada_kktp from fn_nilai_per_tp(%L, %s) where tp_id = %L', yr, sm::text, lo1);
  insert into hasil_uji(k,v) values ('P1_kepsek', pg_temp.jalan(kep, q));
  insert into hasil_uji(k,v) values ('P2_waka_kurikulum', pg_temp.jalan(wakur, q));
  insert into hasil_uji(k,v) values ('P3_peran_lain_ditolak', format('wakes=%s bk=%s guru=%s guru_penyimpan=%s admin=%s ortu=%s siswa=%s',
    pg_temp.jalan(wakes, q), pg_temp.jalan(bk, q), pg_temp.jalan(guru_flag, q), pg_temp.jalan(guru, q), pg_temp.jalan(adm, q), pg_temp.jalan(ortu, q), pg_temp.jalan(siswa_u, q)));
  insert into hasil_uji(k,v) values ('P4_rincian_per_siswa', pg_temp.jalan(wakur, format('select string_agg(nilai::text||'':''||tercapai::text, '','' order by nilai) from fn_nilai_per_tp_siswa(%L)', lo1)));
  insert into hasil_uji(k,v) values ('P5_rincian_ditolak_bagi_guru', pg_temp.jalan(guru, format('select count(*)::text from fn_nilai_per_tp_siswa(%L)', lo1)));
  insert into hasil_uji(k,v) values ('P6_tp_tidak_ada', pg_temp.jalan(kep, 'select count(*)::text from fn_nilai_per_tp_siswa(gen_random_uuid())'));
  -- Satu penilaian untuk beberapa TP (20 Okt 2026): nilai berlaku di tiap TP yang ditautkan
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp)
    values (sid, guru, cls, subj, yr, sm::text::int, 'UJI-TP2', 'TP uji kedua') returning id into lo2;
  insert into assessment_criteria (learning_objective_id, school_id, urutan, rentang)
    values (lo2, sid, 1, '{"SB":[90,100],"BSH":[70,89],"MB":[56,69],"BB":[0,55]}'::jsonb);
  select class_id into kelas_lain from classes where school_id = sid and class_id <> cls limit 1;
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp)
    values (sid, guru, coalesce(kelas_lain, cls), subj, yr, sm::text::int, 'UJI-TP-LAIN', 'TP kelas lain') returning id into lo_lain;
  insert into hasil_uji(k,v) values ('B1_guru_menautkan_tp_kedua', pg_temp.jalan(guru, format('insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (%L,%L,%L) returning ''ok''', asmt, lo2, sid)));
  q := format('select rata_rata::text||''/''||tercapai||''/''||belum_tercapai||''/''||jumlah_siswa||''/''||ada_kktp from fn_nilai_per_tp(%L, %s) where tp_id = %L', yr, sm::text, lo2);
  insert into hasil_uji(k,v) values ('B2_nilai_berlaku_di_tp_kedua', pg_temp.jalan(wakur, q));
  insert into hasil_uji(k,v) values ('B3_guru_lain_tak_menautkan', pg_temp.jalan(guru_flag, format('insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (%L,%L,%L) returning ''ok''', asmt, lo2, sid)));
  insert into hasil_uji(k,v) values ('B4_tp_kelas_lain_ditolak', case when kelas_lain is null then 'GALAT:P0001' else pg_temp.jalan(guru, format('insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (%L,%L,%L) returning ''ok''', asmt, lo_lain, sid)) end);
  insert into hasil_uji(k,v) values ('B5_guru_dan_kepsek_membaca_tautan', format('guru=%s kepsek=%s lain=%s', pg_temp.jalan(guru, format('select count(*)::text from assessment_tps where assessment_id = %L', asmt)),
    pg_temp.jalan(kep, format('select count(*)::text from assessment_tps where assessment_id = %L', asmt)), pg_temp.jalan(guru_flag, format('select count(*)::text from assessment_tps where assessment_id = %L', asmt))));
  insert into hasil_uji(k,v) values ('B6_guru_melepas_tautan', pg_temp.jalan(guru, format('with d as (delete from assessment_tps where assessment_id = %L and learning_objective_id = %L returning 1) select count(*)::text from d', asmt, lo2)));
  insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (asmt, lo2, sid);   -- pasang lagi lalu hapus TP-nya
  delete from learning_objectives where id = lo2;
  q := format('select rata_rata::text||''/''||tercapai||''/''||belum_tercapai||''/''||jumlah_siswa||''/''||ada_kktp from fn_nilai_per_tp(%L, %s) where tp_id = %L', yr, sm::text, lo1);
  insert into hasil_uji(k,v) values ('B7_hapus_tp_tautan_hilang_penilaian_tetap', format('tautan=%s penilaian=%s', (select count(*) from assessment_tps where assessment_id = asmt), (select count(*) from assessments where id = asmt)));
  -- (1) Nilai non-TES mengikuti predikat + KKTP: mengubah/menghapus KKTP menyelaraskan nilai yang sudah tersimpan; TES tidak disentuh
  insert into learning_objectives (school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp)
    values (sid, guru, cls, subj, yr, sm::text::int, 'UJI-TP3', 'TP uji ketiga') returning id into lo3;
  insert into assessment_criteria (learning_objective_id, school_id, urutan, rentang)
    values (lo3, sid, 1, '{"SB":[85,100],"BSH":[70,84],"MB":[55,69],"BB":[0,54]}'::jsonb);
  insert into assessments (school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik)
    values (sid, guru, cls, subj, yr, sm::text::int, 'SUMATIF', 'PROYEK') returning id into asmt2;
  insert into assessment_tps (assessment_id, learning_objective_id, school_id) values (asmt2, lo3, sid);
  insert into assessment_results (school_id, class_id, assessment_id, student_id, nilai, status) values (sid, cls, asmt2, stu, 77, 'BSH'), (sid, cls, asmt2, stu2, 62, 'MB');
  update assessment_criteria set rentang = '{"SB":[90,100],"BSH":[80,89],"MB":[60,79],"BB":[0,59]}'::jsonb where learning_objective_id = lo3;
  insert into hasil_uji(k,v) values ('N1_ubah_kktp_nilai_non_tes_ikut', (select string_agg(nilai::int::text, '/' order by student_id = stu desc) from assessment_results where assessment_id = asmt2));
  insert into hasil_uji(k,v) values ('N2_nilai_tes_tidak_disentuh', (select string_agg(nilai::int::text, '/' order by nilai) from assessment_results where assessment_id = asmt));
  delete from assessment_criteria where learning_objective_id = lo3;
  insert into hasil_uji(k,v) values ('N3_hapus_kktp_kembali_ke_bawaan', (select string_agg(nilai::int::text, '/' order by student_id = stu desc) from assessment_results where assessment_id = asmt2));
  -- (2) Menghapus TP membuang id-nya dari tanda T/R nilai rapor tersimpan, dan mengosongkan deskripsi yang DISUSUN OTOMATIS dari TP itu (yang disunting guru tidak disentuh)
  select ce.student_id into stu3d from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null and ce.student_id not in (stu, stu2) order by ce.student_id limit 1;
  insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode, tp_optimal, tp_perlu, deskripsi_tertinggi, deskripsi_terendah)
    values (sid, cls, subj, stu, guru, yr, sm::text::int, 80, 'MANUAL', array[lo3], array[lo1], 'Menunjukkan penguasaan yang baik dalam TP uji ketiga.', 'Catatan guru sendiri tentang kelemahan');
  insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode, tp_optimal, tp_perlu, deskripsi_tertinggi, deskripsi_terendah)
    values (sid, cls, subj, stu2, guru, yr, sm::text::int, 70, 'MANUAL', array[lo1], array[lo3], 'Kuat pada TP uji ketiga dan TP lain.', 'Perlu peningkatan dalam TP uji ketiga.');
  if stu3d is not null then
    insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode, tp_optimal, tp_perlu, deskripsi_tertinggi)
      values (sid, cls, subj, stu3d, guru, yr, sm::text::int, 75, 'MANUAL', array[lo3], '{}', 'Menunjukkan penguasaan yang baik dalam TP uji ketiga dan praktik mandiri.');
  end if;
  delete from learning_objectives where id = lo3;
  insert into hasil_uji(k,v) values ('N4_hapus_tp_tanda_bersih', (select coalesce(cardinality(tp_optimal),0)::text || '/' || coalesce(cardinality(tp_perlu),0)::text from grade_final where student_id = stu and class_id = cls and subject_id = subj));
  insert into hasil_uji(k,v) values ('N5_deskripsi_otomatis_tertinggi_kosong_catatan_guru_tetap', (select coalesce(deskripsi_tertinggi, 'NULL') || '|' || coalesce(deskripsi_terendah, 'NULL') from grade_final where student_id = stu and class_id = cls and subject_id = subj));
  insert into hasil_uji(k,v) values ('N6_deskripsi_otomatis_terendah_kosong_catatan_guru_tetap', (select coalesce(deskripsi_tertinggi, 'NULL') || '|' || coalesce(deskripsi_terendah, 'NULL') from grade_final where student_id = stu2 and class_id = cls and subject_id = subj));
  insert into hasil_uji(k,v) values ('N7_teks_disunting_yang_menyebut_tp_tetap', case when stu3d is null then 'TIDAK_ADA_SISWA_KETIGA_KASUS_TIDAK_DIUJI' else (select coalesce(deskripsi_tertinggi, 'NULL') from grade_final where student_id = stu3d and class_id = cls and subject_id = subj) end);
  delete from grade_final where student_id in (stu, stu2) and class_id = cls and subject_id = subj;
  delete from grade_final where student_id = stu3d and class_id = cls and subject_id = subj;
  -- dikenali lewat TANDA peran tambahan (akun GURU yang juga Waka Kurikulum), bukan hanya peran tunggal
  perform set_config('app.bypass_users_guard', 'on', true);
  update users set role_type = 'GURU', is_waka_kurikulum = true where user_id = wakur;   -- Waka Kurikulum yang tercatat sebagai GURU + tanda peran tambahan
  perform set_config('app.bypass_users_guard', 'off', true);
  insert into hasil_uji(k,v) values ('P7_guru_dengan_tanda_waka_kurikulum', pg_temp.jalan(wakur, q));

  -- 2b. Akses baca nilai dipersempit (migrasi 20261017160000): hanya Kepsek dan Waka Kurikulum; Kaprodi, Waka Humas, Waka Kesiswaan ditolak
  qa := format('select (select count(*) from assessments where id = %L)::text||''/''||(select count(*) from assessment_results where assessment_id = %L)::text', asmt, asmt);
  insert into hasil_uji(k,v) values ('R1_pimpinan_akademik_membaca', format('kepsek=%s waka_kurikulum=%s', pg_temp.jalan(kep, qa), pg_temp.jalan(wakur, qa)));
  insert into hasil_uji(k,v) values ('R2_peran_lain_dicabut', format('kaprodi=%s waka_humas=%s waka_kesiswaan=%s', coalesce(pg_temp.jalan(kaprodi, qa), 'tanpa_akun'), coalesce(pg_temp.jalan(wakhum, qa), 'tanpa_akun'), pg_temp.jalan(wakes, qa)));
  insert into hasil_uji(k,v) values ('R3_guru_pemilik_tetap_membaca', pg_temp.jalan(guru, qa));
  insert into hasil_uji(k,v) values ('R4_kebijakan_wali_kelas_lama_hilang', (select count(*)::text from pg_policies where schemaname='public' and policyname in ('rls_assessments_select_wali','rls_assessment_results_select_wali','rls_grade_recap_select_wali')));

  -- 3. Nilai rapor: terlihat siswa/orang tua hanya atas izin guru (bawaan tidak terlihat)
  insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode)
    values (sid, cls, subj, stu, guru, yr, sm::text::int, 88, 'RATA');
  q := format('select count(*)::text from grade_final where student_id = %L', stu);
  ringkas := 'select count(*)::text from jsonb_array_elements(fn_get_all_grades_summary(%s, null, null)->''grades'') g where g->>''kind'' = ''RAPOR''';
  insert into hasil_uji(k,v) values ('V1_bawaan_tidak_terlihat', format('tabel: siswa=%s ortu=%s | portal: siswa=%s ortu=%s',
    pg_temp.jalan(siswa_u, q), pg_temp.jalan(ortu, q), pg_temp.jalan(siswa_u, format(ringkas, 'null')), pg_temp.jalan(ortu, format(ringkas, quote_literal(stu) || '::uuid'))));
  update grade_final set is_visible_siswa = true where student_id = stu;
  insert into hasil_uji(k,v) values ('V2_izin_siswa_saja', format('tabel: siswa=%s ortu=%s | portal: siswa=%s ortu=%s',
    pg_temp.jalan(siswa_u, q), pg_temp.jalan(ortu, q), pg_temp.jalan(siswa_u, format(ringkas, 'null')), pg_temp.jalan(ortu, format(ringkas, quote_literal(stu) || '::uuid'))));
  update grade_final set is_visible_siswa = false, is_visible_ortu = true where student_id = stu;
  insert into hasil_uji(k,v) values ('V3_izin_ortu_saja', format('tabel: siswa=%s ortu=%s | portal: siswa=%s ortu=%s',
    pg_temp.jalan(siswa_u, q), pg_temp.jalan(ortu, q), pg_temp.jalan(siswa_u, format(ringkas, 'null')), pg_temp.jalan(ortu, format(ringkas, quote_literal(stu) || '::uuid'))));
  update grade_final set is_visible_siswa = true where student_id = stu;
  insert into hasil_uji(k,v) values ('V4_izin_keduanya', format('tabel: siswa=%s ortu=%s | portal: siswa=%s ortu=%s',
    pg_temp.jalan(siswa_u, q), pg_temp.jalan(ortu, q), pg_temp.jalan(siswa_u, format(ringkas, 'null')), pg_temp.jalan(ortu, format(ringkas, quote_literal(stu) || '::uuid'))));
  insert into hasil_uji(k,v) values ('V5_siswa_tak_dapat_mengubah_izin', pg_temp.jalan(siswa_u, format('with u as (update grade_final set nilai_rapor = 100 where student_id = %L returning 1) select count(*)::text from u', stu)));
  insert into hasil_uji(k,v) values ('V6_nilai_tetap', (select nilai_rapor::text from grade_final where student_id = stu));
end $$;
select k, v from hasil_uji order by no;
