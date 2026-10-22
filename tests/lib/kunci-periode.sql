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
  sid uuid; yr text; sm semester; guru uuid; cls uuid; subj uuid; stu uuid; guru_lain uuid; kep uuid; wakur uuid; wakes uuid;
  cls2 uuid; asm uuid; per_id uuid; n_ubah integer;
  ins text := 'insert into grade_final (school_id, class_id, subject_id, student_id, teacher_id, academic_year, semester, nilai_rapor, metode, tp_optimal, tp_perlu) values (%L,%L,%L,%L,%L,%L,%s,%s,''RATA'',%L,%L) returning ''ok''';
  unl text := 'select fn_unlock_grade_period(%L,%L,%s,%L)::text';
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id = sid;
  select ta.user_id, ta.class_id, ta.subject_id into guru, cls, subj
    from teaching_assignments ta join users u on u.user_id = ta.user_id and u.teacher_code is not null and u.is_active
    where ta.school_id = sid and ta.is_active and ta.academic_year = yr and ta.semester::text = sm::text
      and exists (select 1 from class_enrollments ce where ce.class_id = ta.class_id and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null)
    order by ta.user_id, ta.class_id limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id = cls and ce.academic_year = yr and ce.semester = sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select u.user_id into guru_lain from users u where u.school_id = sid and u.teacher_code is not null and u.is_active and u.user_id <> guru order by u.user_id limit 1;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into wakur from users where school_id = sid and (role_type = 'WAKA_KURIKULUM' or is_waka_kurikulum) and is_active limit 1;
  select user_id into wakes from users where school_id = sid and (role_type = 'WAKA_KESISWAAN' or is_waka_kesiswaan) and is_active limit 1;
  select class_id into cls2 from classes where school_id = sid and class_id <> cls limit 1;
  insert into hasil_uji(k,v) values ('persona', format('guru=%s kelas=%s kelas2=%s mapel=%s siswa=%s guru_lain=%s kepsek=%s wakur=%s wakes=%s',
    guru is not null, cls is not null, cls2 is not null, subj is not null, stu is not null, guru_lain is not null, kep is not null, wakur is not null, wakes is not null));

  -- Keadaan awal: periode berjalan ACTIVE (dibuat bila belum ada). Seluruh perubahan dibatalkan di akhir.
  select id into per_id from academic_periods where school_id = sid and academic_year = yr and semester = sm;
  if per_id is null then
    insert into academic_periods(school_id, academic_year, semester, start_date, end_date, status) values (sid, yr, sm, current_date - 100, current_date + 100, 'ACTIVE') returning id into per_id;
  else
    update academic_periods set status = 'ACTIVE', closed_at = null, closed_by_user_id = null where id = per_id;
  end if;
  insert into assessments(school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik, tanggal)
    values (sid, guru, cls, subj, yr, sm::text::int, 'SUMATIF', 'TES', current_date) returning id into asm;

  -- A. Selagi periode ACTIVE guru menulis seperti biasa
  insert into hasil_uji(k,v) values ('A1_aktif_simpan_nilai_rapor', pg_temp.jalan(guru, format(ins, sid, cls, subj, stu, guru, yr, sm::text, '85', '{}'::uuid[], '{}'::uuid[])));
  insert into hasil_uji(k,v) values ('A2_aktif_hasil_asesmen', pg_temp.jalan(guru, format('insert into assessment_results(school_id, class_id, assessment_id, student_id, nilai) values (%L,%L,%L,%L,70) returning ''ok''', sid, cls, asm, stu)));

  -- Admin sekolah menutup semester (di sini: status CLOSED, seperti fn_close_semester)
  update academic_periods set status = 'CLOSED', closed_at = now() where id = per_id;

  -- B. Setelah ditutup guru TIDAK dapat menulis apa pun pada kelas itu (P0001)
  insert into hasil_uji(k,v) values ('B1_tutup_ubah_nilai_rapor', pg_temp.jalan(guru, format('update grade_final set nilai_rapor = 99 where class_id = %L and student_id = %L returning ''ok''', cls, stu)));
  insert into hasil_uji(k,v) values ('B2_tutup_hapus_nilai_rapor', pg_temp.jalan(guru, format('delete from grade_final where class_id = %L and student_id = %L returning ''ok''', cls, stu)));
  insert into hasil_uji(k,v) values ('B3_tutup_ubah_hasil_asesmen', pg_temp.jalan(guru, format('update assessment_results set nilai = 10 where assessment_id = %L returning ''ok''', asm)));
  insert into hasil_uji(k,v) values ('B4_tutup_asesmen_baru', pg_temp.jalan(guru, format('insert into assessments(school_id, teacher_id, class_id, subject_id, academic_year, semester, jenis, teknik, tanggal) values (%L,%L,%L,%L,%L,%s,''SUMATIF'',''TES'',current_date) returning ''ok''', sid, guru, cls, subj, yr, sm::text)));
  insert into hasil_uji(k,v) values ('B5_tutup_hapus_asesmen', pg_temp.jalan(guru, format('delete from assessments where id = %L returning ''ok''', asm)));
  insert into hasil_uji(k,v) values ('B6_tutup_tak_dapat_memindah_semester', pg_temp.jalan(guru, format('update assessments set semester = %s where id = %L returning ''ok''', case when sm::text = '1' then 2 else 1 end, asm)));
  insert into hasil_uji(k,v) values ('B7_nilai_tetap_85', (select nilai_rapor::text from grade_final where class_id = cls and student_id = stu and subject_id = subj));
  insert into hasil_uji(k,v) values ('B8_baca_tetap_boleh', pg_temp.jalan(guru, format('select count(*)::text from grade_final where class_id = %L', cls)));

  -- C. Pembukaan kunci: hanya Kepsek / Waka Kurikulum, dengan alasan tertulis
  insert into hasil_uji(k,v) values ('C1_guru_tak_dapat_membuka', pg_temp.jalan(guru, format(unl, cls, yr, sm::text, 'ingin koreksi nilai anak')));
  insert into hasil_uji(k,v) values ('C2_wakes_tak_dapat_membuka', pg_temp.jalan(wakes, format(unl, cls, yr, sm::text, 'ingin koreksi nilai anak')));
  insert into hasil_uji(k,v) values ('C3_alasan_terlalu_pendek', pg_temp.jalan(kep, format(unl, cls, yr, sm::text, 'salah')));
  insert into hasil_uji(k,v) values ('C4_kelas_tidak_dikenal', pg_temp.jalan(kep, format(unl, gen_random_uuid(), yr, sm::text, 'alasan cukup panjang')));
  insert into hasil_uji(k,v) values ('C5_kepsek_membuka', case when pg_temp.jalan(kep, format(unl, cls, yr, sm::text, 'koreksi salah input nilai UH 2')) like 'GALAT%' then 'GAGAL' else 'ok' end);
  insert into hasil_uji(k,v) values ('C6_buka_dua_kali', pg_temp.jalan(wakur, format(unl, cls, yr, sm::text, 'koreksi salah input nilai UH 2')));
  insert into hasil_uji(k,v) values ('C7_kelas_lain_tetap_terkunci', format('kelas=%s kelas2=%s', fn_grade_period_locked(sid, cls, yr, sm::text::int), fn_grade_period_locked(sid, cls2, yr, sm::text::int)));
  insert into hasil_uji(k,v) values ('C8_guru_menulis_saat_dibuka', pg_temp.jalan(guru, format('update grade_final set nilai_rapor = 90 where class_id = %L and student_id = %L returning ''ok''', cls, stu)));
  insert into hasil_uji(k,v) values ('C9_catatan_pembukaan', (select format('baris=%s alasan_ok=%s oleh_ok=%s', count(*), bool_and(reason like 'koreksi salah%'), bool_and(unlocked_by = kep)) from grade_period_unlocks where class_id = cls and relocked_at is null));
  insert into hasil_uji(k,v) values ('C10_baca_catatan', format('guru=%s kepsek=%s', pg_temp.jalan(guru, 'select count(*)::text from grade_period_unlocks'), pg_temp.jalan(kep, 'select count(*)::text from grade_period_unlocks')));

  -- D. Kunci kembali
  insert into hasil_uji(k,v) values ('D1_guru_tak_dapat_mengunci', pg_temp.jalan(guru, format('select fn_relock_grade_period(%L,%L,%s)::text', cls, yr, sm::text)));
  insert into hasil_uji(k,v) values ('D2_wakur_mengunci_kembali', pg_temp.jalan(wakur, format('select fn_relock_grade_period(%L,%L,%s)::text', cls, yr, sm::text)));
  insert into hasil_uji(k,v) values ('D3_terkunci_lagi', pg_temp.jalan(guru, format('update grade_final set nilai_rapor = 91 where class_id = %L and student_id = %L returning ''ok''', cls, stu)));
  insert into hasil_uji(k,v) values ('D4_riwayat_tetap_ada', (select format('baris=%s terkunci_ulang=%s', count(*), count(relocked_at)) from grade_period_unlocks where class_id = cls));

  -- F. Status untuk layar pimpinan (kelas sedang terkunci kembali)
  insert into hasil_uji(k,v) values ('F1_status_terkunci', (select format('closed=%s unlocked=%s', j->>'closed', j->>'unlocked') from (select pg_temp.jalan(kep, format('select fn_get_grade_period_status(%L,%L,%s)::text', cls, yr, sm::text))::jsonb j) x));
  insert into hasil_uji(k,v) values ('F2_guru_tak_dapat_melihat_status', pg_temp.jalan(guru, format('select fn_get_grade_period_status(%L,%L,%s)::text', cls, yr, sm::text)));
  perform pg_temp.jalan(kep, format(unl, cls, yr, sm::text, 'koreksi kedua salah input nilai'));
  insert into hasil_uji(k,v) values ('F3_status_dibuka', (select format('closed=%s unlocked=%s alasan=%s', j->>'closed', j->>'unlocked', j->>'reason') from (select pg_temp.jalan(wakur, format('select fn_get_grade_period_status(%L,%L,%s)::text', cls, yr, sm::text))::jsonb j) x));
  perform pg_temp.jalan(wakur, format('select fn_relock_grade_period(%L,%L,%s)::text', cls, yr, sm::text));

  -- E. Periode ACTIVE: tidak ada yang perlu dibuka; SQL langsung (admin/service) tidak terhalang
  update academic_periods set status = 'ACTIVE', closed_at = null where id = per_id;
  insert into hasil_uji(k,v) values ('E1_buka_saat_aktif', pg_temp.jalan(kep, format(unl, cls, yr, sm::text, 'alasan cukup panjang')));
  update academic_periods set status = 'CLOSED', closed_at = now() where id = per_id;
  update grade_final set nilai_rapor = 77 where class_id = cls and student_id = stu;
  get diagnostics n_ubah = row_count;
  insert into hasil_uji(k,v) values ('E2_sql_langsung_tidak_terhalang', n_ubah::text);
end $$;
select k, v from hasil_uji order by no;
