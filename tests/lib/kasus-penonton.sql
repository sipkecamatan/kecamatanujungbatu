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
  exception when others then
    reset role;
    return 'GALAT:' || sqlstate;
  end;
end $f$;
do $$
declare
  sid uuid; cls uuid; stu uuid; creator uuid; wali uuid; gwali uuid; bk uuid; lain uuid; adm uuid; kep uuid; waka uuid;
  ortu uuid; ortu_lain uuid; siswa_user uuid; cid uuid; yr text; sm semester; titel text := 'JUDUL-RAHASIA-XYZ';
  qkasus text; qevent text;
begin
  select school_id into sid from schools where slug='smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id=sid;
  select u.user_id into creator from users u where u.school_id=sid and u.teacher_code='ABA';
  select ce.class_id into cls from class_enrollments ce join classes c on c.class_id=ce.class_id where ce.school_id=sid and c.name='XI AKL 1' and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id=cls and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select u.user_id into wali from users u where u.school_id=sid and u.wali_kelas_class_id=cls limit 1;
  select g.guru_user_id into gwali from guru_wali_assignments g where g.school_id=sid and g.student_id=stu and g.is_active limit 1;
  select u.user_id into bk from users u where u.school_id=sid and u.role_type='BK' order by u.user_id limit 1;
  select u.user_id into lain from users u where u.school_id=sid and u.role_type='GURU' and u.user_id not in (creator, coalesce(wali,creator), coalesce(gwali,creator)) order by u.user_id limit 1;
  select u.user_id into adm from users u where u.school_id=sid and u.role_type='ADMINISTRATIVE' limit 1;
  select u.user_id into kep from users u where u.school_id=sid and u.role_type='KEPSEK' limit 1;
  select u.user_id into waka from users u where u.school_id=sid and u.role_type='WAKA_KESISWAAN' limit 1;
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id=stu limit 1;
  select sp.parent_user_id into ortu_lain from student_parents sp where sp.student_id<>stu and sp.parent_user_id<>ortu limit 1;
  select s.user_id into siswa_user from students s where s.student_id=stu;
  insert into hasil_uji(k,v) values ('persona', 'creator='||(creator is not null)||' wali='||(wali is not null)||' guruwali='||(gwali is not null)||' bk='||(bk is not null)||' lain='||(lain is not null)||' admin='||(adm is not null)||' kepsek='||(kep is not null)||' waka='||(waka is not null)||' ortu='||(ortu is not null)||' ortu_lain='||(ortu_lain is not null)||' siswa='||(siswa_user is not null));
  insert into coaching_cases (school_id, student_id, title, description, track, status, created_by_user_id, current_handler_user_id)
    values (sid, stu, titel, 'Deskripsi kasus uji yang cukup panjang untuk lolos pemeriksaan.', 'SEKOLAH', 'OPEN', creator, creator) returning case_id into cid;
  qkasus := format('select count(*)::text from coaching_cases where case_id=%L', cid);
  qevent := format('select count(*)::text from coaching_case_events where case_id=%L', cid);

  insert into hasil_uji(k,v) values ('S1_awal_lihat_kasus', format('pembuat=%s wali=%s guruwali=%s bk=%s lain=%s admin=%s kepsek=%s waka=%s ortu=%s siswa=%s',
    pg_temp.jalan(creator, qkasus), pg_temp.jalan(wali, qkasus), pg_temp.jalan(gwali, qkasus), pg_temp.jalan(bk, qkasus), pg_temp.jalan(lain, qkasus),
    pg_temp.jalan(adm, qkasus), pg_temp.jalan(kep, qkasus), pg_temp.jalan(waka, qkasus), pg_temp.jalan(ortu, qkasus), pg_temp.jalan(siswa_user, qkasus)));

  insert into hasil_uji(k,v) values ('S2_kandidat', pg_temp.jalan(creator, format($q$select string_agg(relation_label||':'||n, ', ') from (select relation_label, count(*)::text n, min(priority) p from fn_case_tag_candidates(%L) group by relation_label order by min(priority)) x$q$, cid)));
  insert into hasil_uji(k,v) values ('S2b_kandidat_tanpa_pembuat', pg_temp.jalan(creator, format('select (not exists(select 1 from fn_case_tag_candidates(%L) where user_id=%L))::text', cid, creator)));
  insert into hasil_uji(k,v) values ('S2c_kandidat_ditolak_bagi_lain', pg_temp.jalan(lain, format('select count(*)::text from fn_case_tag_candidates(%L)', cid)));

  insert into hasil_uji(k,v) values ('S3_tandai', format('wali=%s guruwali=%s ortu=%s siswa=%s',
    pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, wali)),
    pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, gwali)),
    pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, ortu)),
    pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, siswa_user))));
  insert into hasil_uji(k,v) values ('S3b_lihat_setelah_tandai', format('wali=%s guruwali=%s bk=%s lain=%s admin=%s ortu=%s siswa=%s',
    pg_temp.jalan(wali, qkasus), pg_temp.jalan(gwali, qkasus), pg_temp.jalan(bk, qkasus), pg_temp.jalan(lain, qkasus),
    pg_temp.jalan(adm, qkasus), pg_temp.jalan(ortu, qkasus), pg_temp.jalan(siswa_user, qkasus)));

  insert into hasil_uji(k,v) values ('S4_notifikasi', (select count(*)::text||' notifikasi CASE_TAGGED; mengandung judul kasus='||coalesce(bool_or(position(titel in (title||' '||body))>0),false)::text from notifications where case_id=cid and type='CASE_TAGGED'));

  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (cid, sid, 'NOTE_ADDED', creator, false, '{"note":"internal"}'), (cid, sid, 'NOTE_ADDED', creator, true, '{"note":"terlihat"}');
  insert into hasil_uji(k,v) values ('S5_event_dilihat_total_2', format('wali=%s ortu=%s siswa=%s', pg_temp.jalan(wali, qevent), pg_temp.jalan(ortu, qevent), pg_temp.jalan(siswa_user, qevent)));
  insert into hasil_uji(k,v) values ('S5b_penonton_tak_bisa_menulis_event', pg_temp.jalan(wali, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'NOTE_ADDED',%L,false,'{}'::jsonb) returning event_id::text$q$, cid, sid, wali)));
  insert into hasil_uji(k,v) values ('S5c_penonton_tak_bisa_menambah_penonton', pg_temp.jalan(wali, format('select fn_case_add_viewer(%L,%L)::text', cid, bk)));
  insert into hasil_uji(k,v) values ('S5d_penonton_tak_bisa_mencabut', pg_temp.jalan(wali, format('select fn_case_remove_viewer(%L,%L)::text', cid, gwali)));
  insert into hasil_uji(k,v) values ('S5e_bukan_penonton_tak_bisa_melihat_daftar', pg_temp.jalan(lain, format('select count(*)::text from fn_case_list_viewers(%L)', cid)));
  insert into hasil_uji(k,v) values ('S5f_pembuat_melihat_daftar', pg_temp.jalan(creator, format('select count(*)::text from fn_case_list_viewers(%L)', cid)));

  insert into hasil_uji(k,v) values ('S6_sasaran_tidak_sah', format('admin=%s ortu_siswa_lain=%s',
    pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, adm)),
    pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, ortu_lain))));

  insert into hasil_uji(k,v) values ('S7_cabut_oleh_pembuat', pg_temp.jalan(creator, format('select fn_case_remove_viewer(%L,%L)::text', cid, wali)));
  insert into hasil_uji(k,v) values ('S7b_wali_setelah_dicabut', pg_temp.jalan(wali, qkasus));

  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (cid, sid, 'ESCALATED', creator, false, jsonb_build_object('new_handler_user_id', wali, 'note', 'uji'));
  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (cid, sid, 'ESCALATED', wali, false, jsonb_build_object('new_handler_user_id', bk, 'note', 'uji'));
  insert into hasil_uji(k,v) values ('S8_setelah_eskalasi', format('pembuat=%s penangan_sebelumnya_wali=%s penangan_baru_bk=%s lain=%s',
    pg_temp.jalan(creator, qkasus), pg_temp.jalan(wali, qkasus), pg_temp.jalan(bk, qkasus), pg_temp.jalan(lain, qkasus)));
  insert into hasil_uji(k,v) values ('S8b_penangan_baru_boleh_menandai', pg_temp.jalan(bk, format('select fn_case_add_viewer(%L,%L)::text', cid, lain)));
  insert into hasil_uji(k,v) values ('S8c_penangan_baru_tak_boleh_mencabut', pg_temp.jalan(bk, format('select fn_case_remove_viewer(%L,%L)::text', cid, lain)));
  insert into hasil_uji(k,v) values ('S8d_pembuat_masih_boleh_mencabut', pg_temp.jalan(creator, format('select fn_case_remove_viewer(%L,%L)::text', cid, lain)));

  insert into hasil_uji(k,v) values ('S9_log_pengawas', format('kepsek_pertama=%s kepsek_kedua=%s waka=%s pembuat=%s penonton=%s',
    pg_temp.jalan(kep, format('select fn_case_log_oversight_view(%L)::text', cid)),
    pg_temp.jalan(kep, format('select fn_case_log_oversight_view(%L)::text', cid)),
    pg_temp.jalan(waka, format('select fn_case_log_oversight_view(%L)::text', cid)),
    pg_temp.jalan(creator, format('select fn_case_log_oversight_view(%L)::text', cid)),
    pg_temp.jalan(gwali, format('select fn_case_log_oversight_view(%L)::text', cid))));
  insert into hasil_uji(k,v) values ('S9b_log_dibaca_pembuat', pg_temp.jalan(creator, format('select count(*)::text from fn_case_list_access_log(%L)', cid)));
  insert into hasil_uji(k,v) values ('S9c_log_ditolak_bagi_guru_lain', pg_temp.jalan(lain, format('select count(*)::text from fn_case_list_access_log(%L)', cid)));

  insert into hasil_uji(k,v) values ('S10_admin', format('hitungan=%s aktivitas_baris=%s baca_langsung_kasus=%s baca_langsung_event=%s guru_memanggil_fungsi_admin=%s',
    pg_temp.jalan(adm, 'select fn_admin_case_counts()::text'),
    pg_temp.jalan(adm, 'select count(*)::text from fn_admin_case_activity(50)'),
    pg_temp.jalan(adm, qkasus), pg_temp.jalan(adm, qevent),
    pg_temp.jalan(creator, 'select fn_admin_case_counts()::text')));
  insert into hasil_uji(k,v) values ('S10c_hitungan_kasus_admin', format('semua=%s siswa_kasus=%s siswa_lain=%s guru=%s',
    pg_temp.jalan(adm, 'select fn_admin_case_count_for_students(null)::text'),
    pg_temp.jalan(adm, format('select fn_admin_case_count_for_students(array[%L]::uuid[])::text', stu)),
    pg_temp.jalan(adm, format('select fn_admin_case_count_for_students(array[%L]::uuid[])::text', (select student_id from students where school_id=sid and student_id<>stu limit 1))),
    pg_temp.jalan(creator, 'select fn_admin_case_count_for_students(null)::text')));
  insert into hasil_uji(k,v) values ('S10b_aktivitas_admin_tanpa_judul', pg_temp.jalan(adm, $q$select (not exists(select 1 from fn_admin_case_activity(50) a where a::text like '%JUDUL-RAHASIA%'))::text$q$));
end $$;
select no, k, v from hasil_uji order by no;
