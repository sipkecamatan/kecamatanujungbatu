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
declare sid uuid; guru uuid; kelas uuid; mapel uuid; siswa uuid; wali uuid; waka_kes uuid; yr text; smt int;
        rumus_ok text := '{"metode":"BOBOT","bobot":{"asm-1":40,"asm-2":60}}';
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select ta.user_id, ta.class_id, ta.subject_id, ta.academic_year, ta.semester into guru, kelas, mapel, yr, smt from teaching_assignments ta join users u on u.user_id = ta.user_id
   where ta.school_id = sid and u.role_type = 'GURU' and u.is_active and ta.is_active and ta.academic_year = (select current_academic_year from school_config where school_id = sid)
   order by ta.user_id, ta.class_id limit 1;
  select ce.student_id into siswa from class_enrollments ce where ce.class_id = kelas and ce.withdrawn_at is null
     and not exists (select 1 from grade_final g where g.student_id = ce.student_id and g.subject_id = mapel and g.academic_year = yr and g.semester = smt)
   order by ce.student_id limit 1;
  select user_id into wali from users where school_id = sid and wali_kelas_class_id = kelas limit 1;
  select user_id into waka_kes from users where school_id = sid and role_type = 'WAKA_KESISWAAN' and is_active limit 1;
  insert into hasil_uji(k,v) values ('persona', format('guru=%s kelas=%s siswa=%s wali=%s waka_kes=%s', guru is not null, kelas is not null, siswa is not null, wali is not null, waka_kes is not null));

  insert into hasil_uji(k,v) values ('R1_guru_menyimpan_rumus', pg_temp.jalan(guru, format($q$with i as (insert into grade_final(school_id,class_id,subject_id,student_id,teacher_id,academic_year,semester,nilai_rapor,metode,rumus)
     values (%L,%L,%L,%L,%L,%L,%s,80,'BOBOT',%L::jsonb) returning rumus) select (rumus->>'metode') || '/' || (rumus->'bobot'->>'asm-2') from i$q$, sid, kelas, mapel, siswa, guru, yr, smt, rumus_ok)));
  insert into hasil_uji(k,v) values ('R2_rumus_terbaca_ulang_oleh_guru', pg_temp.jalan(guru, format($q$select (rumus->>'metode') || '/' || (rumus->'bobot'->>'asm-1') from grade_final where student_id=%L and academic_year=%L$q$, siswa, yr)));
  insert into hasil_uji(k,v) values ('R3_wali_kelas_membaca_baris', pg_temp.jalan(wali, format($q$select count(*)::text from grade_final where student_id=%L and academic_year=%L$q$, siswa, yr)));
  insert into hasil_uji(k,v) values ('R4_Waka_Kesiswaan_tidak_membaca', pg_temp.jalan(waka_kes, format($q$select count(*)::text from grade_final where student_id=%L and academic_year=%L$q$, siswa, yr)));
  insert into hasil_uji(k,v) values ('R5_rumus_bukan_objek_ditolak_23514', pg_temp.jalan(guru, format($q$update grade_final set rumus='[1,2]'::jsonb where student_id=%L and academic_year=%L returning 'diterima'$q$, siswa, yr)));
  insert into hasil_uji(k,v) values ('S1_saran_saat_simpan_tersimpan', pg_temp.jalan(guru, format($q$update grade_final set saran_saat_simpan=65.4 where student_id=%L and academic_year=%L returning saran_saat_simpan::text$q$, siswa, yr)));
  insert into hasil_uji(k,v) values ('S2_saran_di_luar_0_100_ditolak', pg_temp.jalan(guru, format($q$update grade_final set saran_saat_simpan=150 where student_id=%L and academic_year=%L returning 'diterima'$q$, siswa, yr)));
  insert into hasil_uji(k,v) values ('J1_judul_penilaian_tersimpan', pg_temp.jalan(guru, format($q$with i as (insert into assessments(school_id,class_id,subject_id,teacher_id,academic_year,semester,jenis,teknik,instrumen,judul) values (%L,%L,%L,%L,%L,%s,'SUMATIF','TES','Pilihan Ganda','UH 1 Jurnal Umum') returning judul) select judul from i$q$, sid, kelas, mapel, guru, yr, smt)));
  insert into hasil_uji(k,v) values ('J2_judul_121_karakter_ditolak', pg_temp.jalan(guru, format($q$insert into assessments(school_id,class_id,subject_id,teacher_id,academic_year,semester,jenis,teknik,instrumen,judul) values (%L,%L,%L,%L,%L,%s,'SUMATIF','TES','Pilihan Ganda',repeat('x',121)) returning 'diterima'$q$, sid, kelas, mapel, guru, yr, smt)));
  insert into hasil_uji(k,v) values ('J3_judul_kosong_ditolak', pg_temp.jalan(guru, format($q$insert into assessments(school_id,class_id,subject_id,teacher_id,academic_year,semester,jenis,teknik,instrumen,judul) values (%L,%L,%L,%L,%L,%s,'SUMATIF','TES','Pilihan Ganda','') returning 'diterima'$q$, sid, kelas, mapel, guru, yr, smt)));
  insert into hasil_uji(k,v) values ('R6_rumus_boleh_kosong', pg_temp.jalan(guru, format($q$update grade_final set rumus=null where student_id=%L and academic_year=%L returning 'ok'$q$, siswa, yr)));
end $$;
select k, v from hasil_uji order by no;
