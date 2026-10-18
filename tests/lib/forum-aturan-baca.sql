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
declare
  sid uuid; yr text; penulis uuid; penerima uuid; kelas uuid; p_kelas uuid; p_sek uuid; p_tarik uuid; p_mod uuid; siswa_id uuid; p_s1 uuid; p_s2 uuid;
  guru_kelas uuid; wali uuid; kaprodi uuid; kepsek uuid; waka_kes uuid; tu uuid; admin uuid; ortu uuid; siswa_u uuid; peran text; u uuid;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select c.class_id into kelas from classes c where c.school_id = sid and c.name = 'XI AKL 1';
  select user_id into penulis  from users where school_id = sid and full_name ilike 'Anwar Batubara%';
  select user_id into penerima from users where school_id = sid and full_name ilike 'Aisyah Ginting%';
  select ta.user_id into guru_kelas from teaching_assignments ta join users u on u.user_id = ta.user_id where ta.class_id = kelas and ta.is_active and ta.academic_year = yr and ta.user_id not in (penulis, penerima) and u.role_type = 'GURU' limit 1;
  select user_id into wali from users where school_id = sid and wali_kelas_class_id = kelas limit 1;
  select u.user_id into kaprodi from users u join classes c on c.class_id = kelas where u.school_id = sid and u.kaprodi_program_id = c.program_id limit 1;
  select user_id into kepsek   from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select user_id into waka_kes from users where school_id = sid and role_type = 'WAKA_KESISWAAN' and is_active limit 1;
  select user_id into tu       from users where school_id = sid and role_type = 'TU' and is_active limit 1;
  select user_id into admin    from users where school_id = sid and role_type = 'ADMINISTRATIVE' and is_active limit 1;
  select sp.parent_user_id into ortu from student_parents sp join class_enrollments ce on ce.student_id = sp.student_id and ce.class_id = kelas and ce.withdrawn_at is null limit 1;
  select st.user_id, st.student_id into siswa_u, siswa_id from students st join class_enrollments ce on ce.student_id = st.student_id and ce.class_id = kelas and ce.withdrawn_at is null where st.user_id is not null limit 1;
  insert into hasil_uji(k,v) values ('persona', format('guru_kelas=%s wali=%s kaprodi=%s kepsek=%s waka_kes=%s tu=%s admin=%s ortu=%s siswa=%s', guru_kelas is not null, wali is not null, kaprodi is not null, kepsek is not null, waka_kes is not null, tu is not null, admin is not null, ortu is not null, siswa_u is not null));

  -- posting KELAS (visibility PARENT_VISIBLE: dulu dibaca semua orang tua kelas) dan posting SEKOLAH, keduanya hanya untuk Aisyah
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type,class_id,visibility,audience_type) values (sid,penulis,yr,'UJI aturan kelas','isi rahasia','KELAS',kelas,'PARENT_VISIBLE','ORANG_TERTENTU') returning post_id into p_kelas;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_kelas,sid,penerima);
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI aturan sekolah','isi rahasia','SEKOLAH') returning post_id into p_sek;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_sek,sid,penerima);

  foreach peran in array array['penulis','penerima','guru_kelas_lain','wali_kelas','kaprodi','kepsek','waka_kesiswaan','tu','admin','ortu','siswa'] loop
    u := case peran when 'penulis' then penulis when 'penerima' then penerima when 'guru_kelas_lain' then guru_kelas when 'wali_kelas' then wali when 'kaprodi' then kaprodi when 'kepsek' then kepsek
         when 'waka_kesiswaan' then waka_kes when 'tu' then tu when 'admin' then admin when 'ortu' then ortu else siswa_u end;
    if u is null then continue; end if;
    insert into hasil_uji(k,v) values ('baca_' || peran, format('KELAS=%s SEKOLAH=%s',
      pg_temp.jalan(u, format('select count(*)::text from forum_posts where post_id=%L', p_kelas)),
      pg_temp.jalan(u, format('select count(*)::text from forum_posts where post_id=%L', p_sek))));
  end loop;
  -- komentar dan daftar penerima mengikuti aturan yang sama (TU tidak lagi membaca)
  insert into forum_post_comments(post_id,school_id,author_user_id,body) values (p_sek,sid,penerima,'balasan uji');
  insert into hasil_uji(k,v) values ('komentar_dan_penerima_dibaca_tu', case when tu is null then 'tanpa_tu' else
    format('komentar=%s penerima=%s', pg_temp.jalan(tu, format('select count(*)::text from forum_post_comments where post_id=%L', p_sek)), pg_temp.jalan(tu, format('select count(*)::text from forum_post_audience where post_id=%L', p_sek))) end);

  -- posting ditarik: penerima tidak lagi membacanya, penulis tetap
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type,is_withdrawn) values (sid,penulis,yr,'UJI ditarik','isi','SEKOLAH',true) returning post_id into p_tarik;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_tarik,sid,penerima);
  insert into hasil_uji(k,v) values ('ditarik', format('penulis=%s penerima=%s', pg_temp.jalan(penulis, format('select count(*)::text from forum_posts where post_id=%L', p_tarik)), pg_temp.jalan(penerima, format('select count(*)::text from forum_posts where post_id=%L', p_tarik))));

  -- hapus: moderator hanya bila posting ditujukan kepadanya
  insert into hasil_uji(k,v) values ('hapus_kepsek_posting_bukan_untuknya', pg_temp.jalan(kepsek, format('select count(*)::text from fn_delete_forum_post(%L)', p_sek)));
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI untuk kepsek','isi','SEKOLAH') returning post_id into p_mod;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_mod,sid,kepsek);
  insert into hasil_uji(k,v) values ('hapus_kepsek_posting_untuknya', pg_temp.jalan(kepsek, format('select count(*)::text from fn_delete_forum_post(%L)', p_mod)));
  insert into hasil_uji(k,v) values ('hapus_penulis_miliknya', pg_temp.jalan(penulis, format('select count(*)::text from fn_delete_forum_post(%L)', p_sek)));
  insert into hasil_uji(k,v) values ('hapus_guru_lain_ditolak', pg_temp.jalan(guru_kelas, format('select count(*)::text from fn_delete_forum_post(%L)', p_kelas)));

  -- siswa sebagai PENERIMA: aktif dan terdaftar membaca; enrollment ditarik tidak membaca posting kelas; status KELUAR tidak membaca apa pun (regresi pasca db push 050000)
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type,class_id,visibility,audience_type) values (sid,penulis,yr,'UJI siswa kelas','isi','KELAS',kelas,'INTERNAL','ORANG_TERTENTU') returning post_id into p_s1;
  insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (sid,penulis,yr,'UJI siswa sekolah','isi','SEKOLAH') returning post_id into p_s2;
  insert into forum_post_audience(post_id,school_id,user_id) values (p_s1,sid,siswa_u),(p_s2,sid,siswa_u);
  insert into hasil_uji(k,v) values ('siswa_penerima_aktif', format('KELAS=%s SEKOLAH=%s', pg_temp.jalan(siswa_u, format('select count(*)::text from forum_posts where post_id=%L', p_s1)), pg_temp.jalan(siswa_u, format('select count(*)::text from forum_posts where post_id=%L', p_s2))));
  update class_enrollments set withdrawn_at = now() where student_id = siswa_id and class_id = kelas;
  insert into hasil_uji(k,v) values ('siswa_enrollment_ditarik', format('KELAS=%s SEKOLAH=%s', pg_temp.jalan(siswa_u, format('select count(*)::text from forum_posts where post_id=%L', p_s1)), pg_temp.jalan(siswa_u, format('select count(*)::text from forum_posts where post_id=%L', p_s2))));
  update students set student_status = 'KELUAR' where student_id = siswa_id;
  insert into hasil_uji(k,v) values ('siswa_status_keluar', format('KELAS=%s SEKOLAH=%s', pg_temp.jalan(siswa_u, format('select count(*)::text from forum_posts where post_id=%L', p_s1)), pg_temp.jalan(siswa_u, format('select count(*)::text from forum_posts where post_id=%L', p_s2))));
end $$;
select k, v from hasil_uji order by no;
