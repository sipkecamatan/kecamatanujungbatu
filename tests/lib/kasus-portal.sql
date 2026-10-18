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
do $$
declare
  sid uuid; cls uuid; stu uuid; creator uuid; wali uuid; gwali uuid; ortu uuid; ortu_lain uuid; siswa_user uuid; siswa_lain uuid; stu_lain uuid; cid uuid; yr text; sm semester;
  judul text := 'JUDUL-RAHASIA-XYZ'; desk text := 'DESKRIPSI-RAHASIA-XYZ untuk staf saja dan cukup panjang untuk lolos pemeriksaan.';
  q_ortu text; q_siswa text;
begin
  select school_id into sid from schools where slug='smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id=sid;
  select u.user_id into creator from users u where u.school_id=sid and u.teacher_code='ABA';
  select ce.class_id into cls from class_enrollments ce join classes c on c.class_id=ce.class_id where ce.school_id=sid and c.name='XI AKL 1' and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id=cls and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select u.user_id into wali from users u where u.school_id=sid and u.wali_kelas_class_id=cls limit 1;
  select g.guru_user_id into gwali from guru_wali_assignments g where g.school_id=sid and g.student_id=stu and g.is_active limit 1;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id=stu limit 1;
  select s.user_id into siswa_user from students s where s.student_id=stu;
  select sp.parent_user_id, sp.student_id into ortu_lain, stu_lain from student_parents sp where sp.student_id<>stu and sp.parent_user_id<>ortu limit 1;
  select s.user_id into siswa_lain from students s where s.student_id=stu_lain;
  insert into hasil_uji(k,v) values ('persona', 'creator='||(creator is not null)||' wali='||(wali is not null)||' guruwali='||(gwali is not null)||' ortu='||(ortu is not null)||' siswa='||(siswa_user is not null)||' ortu_lain='||(ortu_lain is not null)||' siswa_lain='||(siswa_lain is not null));

  insert into coaching_cases (school_id, student_id, title, description, track, status, created_by_user_id, current_handler_user_id)
    values (sid, stu, judul, desk, 'SEKOLAH', 'OPEN', creator, creator) returning case_id into cid;
  q_ortu  := format('select fn_portal_cases(%L)::text', stu);
  q_siswa := format('select fn_portal_cases(%L)::text', stu);

  -- P1: sebelum ditandai dan belum dibagikan, siswa/ortu tidak melihat kasus
  insert into hasil_uji(k,v) values ('P1_belum_ditandai', format('ortu=%s siswa=%s',
    (select jsonb_array_length(pg_temp.jalan(ortu, q_ortu)::jsonb)::text), (select jsonb_array_length(pg_temp.jalan(siswa_user, q_siswa)::jsonb)::text)));

  perform pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, wali));
  perform pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, gwali));
  perform pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, ortu));
  perform pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, siswa_user));
  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload)
    values (cid, sid, 'NOTE_ADDED', creator, false, '{"text":"CATATAN-INTERNAL-XYZ"}'), (cid, sid, 'NOTE_ADDED', creator, true, '{"text":"komentar yang terlihat"}');

  -- P2: tabel kasus tidak dapat dibaca langsung oleh siswa/ortu (judul dan deskripsi tidak ada jalur baca)
  insert into hasil_uji(k,v) values ('P2_tabel_kasus_langsung', format('ortu=%s siswa=%s',
    pg_temp.jalan(ortu, format('select count(*)::text from coaching_cases where case_id=%L', cid)), pg_temp.jalan(siswa_user, format('select count(*)::text from coaching_cases where case_id=%L', cid))));
  insert into hasil_uji(k,v) values ('P2b_judul_lewat_kueri_langsung', format('ortu=%s siswa=%s',
    pg_temp.jalan(ortu, format('select count(*)::text from coaching_cases where title=%L', judul)), pg_temp.jalan(siswa_user, format('select count(*)::text from coaching_cases where title=%L', judul))));

  -- P3: fn_portal_cases mengembalikan kasus tanpa judul/deskripsi dan hanya komentar terlihat
  insert into hasil_uji(k,v) values ('P3_isi_untuk_ortu', (select format('kasus=%s status=%s ada_judul=%s ada_deskripsi=%s komentar=%s bocor_judul=%s bocor_deskripsi=%s bocor_internal=%s',
    jsonb_array_length(j), j->0->>'status', (j->0) ? 'title', (j->0) ? 'description', jsonb_array_length(j->0->'events'),
    position('JUDUL-RAHASIA' in j::text) > 0, position('DESKRIPSI-RAHASIA' in j::text) > 0, position('CATATAN-INTERNAL' in j::text) > 0)
    from (select pg_temp.jalan(ortu, q_ortu)::jsonb j) x));
  insert into hasil_uji(k,v) values ('P3b_isi_untuk_siswa', (select format('kasus=%s status=%s ada_judul=%s ada_deskripsi=%s komentar=%s bocor_judul=%s bocor_deskripsi=%s bocor_internal=%s',
    jsonb_array_length(j), j->0->>'status', (j->0) ? 'title', (j->0) ? 'description', jsonb_array_length(j->0->'events'),
    position('JUDUL-RAHASIA' in j::text) > 0, position('DESKRIPSI-RAHASIA' in j::text) > 0, position('CATATAN-INTERNAL' in j::text) > 0)
    from (select pg_temp.jalan(siswa_user, q_siswa)::jsonb j) x));

  -- P4: sasaran tidak sah ditolak
  insert into hasil_uji(k,v) values ('P4_ortu_siswa_lain', pg_temp.jalan(ortu_lain, q_ortu));
  insert into hasil_uji(k,v) values ('P4b_siswa_minta_siswa_lain', pg_temp.jalan(siswa_user, format('select fn_portal_cases(%L)::text', stu_lain)));
  insert into hasil_uji(k,v) values ('P4c_staf_tak_boleh_memakai', pg_temp.jalan(wali, q_ortu));
  insert into hasil_uji(k,v) values ('P4d_ortu_tanpa_siswa', pg_temp.jalan(ortu, 'select fn_portal_cases()::text'));

  -- P5: dicabut sebagai pembaca -> tidak melihat lagi; dibagikan -> melihat tanpa tanda
  perform pg_temp.jalan(creator, format('select fn_case_remove_viewer(%L,%L)::text', cid, ortu));
  perform pg_temp.jalan(creator, format('select fn_case_remove_viewer(%L,%L)::text', cid, siswa_user));
  insert into hasil_uji(k,v) values ('P5_dicabut', format('ortu=%s siswa=%s',
    (select jsonb_array_length(pg_temp.jalan(ortu, q_ortu)::jsonb)::text), (select jsonb_array_length(pg_temp.jalan(siswa_user, q_siswa)::jsonb)::text)));
  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (cid, sid, 'SHARED_TO_PARENT', creator, false, '{}'::jsonb);
  insert into hasil_uji(k,v) values ('P5b_dibagikan_ke_ortu', format('ortu=%s siswa=%s ortu_ada_judul=%s',
    (select jsonb_array_length(pg_temp.jalan(ortu, q_ortu)::jsonb)::text), (select jsonb_array_length(pg_temp.jalan(siswa_user, q_siswa)::jsonb)::text),
    (select ((pg_temp.jalan(ortu, q_ortu)::jsonb)->0) ? 'title')));

  -- L: label hubungan pembaca dari server (bukan tebakan klien)
  perform pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, ortu));
  perform pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, siswa_user));
  insert into hasil_uji(k,v) values ('L1_label_pembaca', pg_temp.jalan(creator, format($q$select string_agg(relation_label, ',' order by relation_label) from fn_case_list_viewers(%L)$q$, cid)));
  insert into hasil_uji(k,v) values ('L2_label_wali_kelas_peran_guru', pg_temp.jalan(creator, format($q$select relation_label||'/'||role_type::text from fn_case_list_viewers(%L) where user_id=%L$q$, cid, wali)));
  insert into hasil_uji(k,v) values ('L3_bukan_pembuat_tak_boleh_melihat_daftar', pg_temp.jalan(ortu, format('select count(*)::text from fn_case_list_viewers(%L)', cid)));
end $$;
select k, v from hasil_uji order by no;
