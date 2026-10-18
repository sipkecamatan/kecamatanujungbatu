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
  sid uuid; cls uuid; stu uuid; creator uuid; kep uuid; waka uuid; wali uuid; guru_lain uuid; cid uuid; yr text; sm semester;
  titel text := 'JUDUL-RAHASIA-KEPSEK'; q_kasus text; q_event text; r_sum text; j jsonb;
begin
  select school_id into sid from schools where slug='smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id=sid;
  select u.user_id into creator from users u where u.school_id=sid and u.teacher_code='ABA';
  select ce.class_id into cls from class_enrollments ce join classes c on c.class_id=ce.class_id where ce.school_id=sid and c.name='XI AKL 1' and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id=cls and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select u.user_id into kep from users u where u.school_id=sid and u.role_type='KEPSEK' and u.is_active limit 1;
  select u.user_id into waka from users u where u.school_id=sid and u.role_type='WAKA_KESISWAAN' and u.is_active limit 1;
  select u.user_id into wali from users u where u.school_id=sid and u.wali_kelas_class_id=cls limit 1;
  select u.user_id into guru_lain from users u where u.school_id=sid and u.role_type='GURU' and u.teacher_code is not null and u.user_id not in (creator, coalesce(wali,creator)) order by u.user_id limit 1;
  insert into hasil_uji(k,v) values ('persona', 'creator='||(creator is not null)||' kepsek='||(kep is not null)||' waka='||(waka is not null)||' wali='||(wali is not null)||' guru_lain='||(guru_lain is not null));

  insert into coaching_cases (school_id, student_id, title, description, track, status, created_by_user_id, current_handler_user_id)
    values (sid, stu, titel, 'Deskripsi kasus uji kepsek yang cukup panjang untuk lolos pemeriksaan.', 'SEKOLAH', 'OPEN', creator, creator) returning case_id into cid;
  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (cid, sid, 'NOTE_ADDED', creator, false, '{"text":"catatan internal"}');
  q_kasus := format('select count(*)::text from coaching_cases where case_id=%L', cid);
  q_event := format('select count(*)::text from coaching_case_events where case_id=%L', cid);

  -- K1: Kepsek tidak membaca kasus, peristiwa, maupun daftar pembaca; pembuat dan Waka Kesiswaan tetap membaca
  insert into hasil_uji(k,v) values ('K1_baca', format('kepsek_kasus=%s kepsek_peristiwa=%s pembuat=%s waka=%s guru_lain=%s',
    pg_temp.jalan(kep, q_kasus), pg_temp.jalan(kep, q_event), pg_temp.jalan(creator, q_kasus), pg_temp.jalan(waka, q_kasus), pg_temp.jalan(guru_lain, q_kasus)));
  insert into hasil_uji(k,v) values ('K1b_daftar_pembaca_dan_log', format('kepsek_pembaca=%s kepsek_log=%s waka_pembaca=%s waka_log=%s pembuat_pembaca=%s',
    pg_temp.jalan(kep, format('select count(*)::text from fn_case_list_viewers(%L)', cid)), pg_temp.jalan(kep, format('select count(*)::text from fn_case_list_access_log(%L)', cid)),
    pg_temp.jalan(waka, format('select count(*)::text from fn_case_list_viewers(%L)', cid)), pg_temp.jalan(waka, format('select count(*)::text from fn_case_list_access_log(%L)', cid)),
    pg_temp.jalan(creator, format('select count(*)::text from fn_case_list_viewers(%L)', cid))));
  insert into hasil_uji(k,v) values ('K1c_jejak_pengawas', format('kepsek=%s waka=%s', pg_temp.jalan(kep, format('select fn_case_log_oversight_view(%L)::text', cid)), pg_temp.jalan(waka, format('select fn_case_log_oversight_view(%L)::text', cid))));

  -- K2: Kepsek tidak menulis apa pun pada kasus orang lain
  insert into hasil_uji(k,v) values ('K2_tulis', format('komentar=%s eskalasi=%s status=%s tutup=%s tandai=%s',
    pg_temp.jalan(kep, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'NOTE_ADDED',%L,false,'{"text":"kepsek"}') returning event_id::text$q$, cid, sid, kep)),
    pg_temp.jalan(kep, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'ESCALATED',%L,false,jsonb_build_object('new_handler_user_id', %L::text, 'note','x')) returning event_id::text$q$, cid, sid, kep, wali)),
    pg_temp.jalan(kep, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'STATUS_CHANGED',%L,false,'{"old_status":"OPEN","new_status":"UNDER_REVIEW"}') returning event_id::text$q$, cid, sid, kep)),
    pg_temp.jalan(kep, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'CLOSED',%L,false,'{"old_status":"OPEN","new_status":"CLOSED"}') returning event_id::text$q$, cid, sid, kep)),
    pg_temp.jalan(kep, format('select fn_case_add_viewer(%L,%L)::text', cid, wali))));

  -- K3: Kepsek tidak dapat ditandai dan bukan kandidat penanda maupun tujuan eskalasi
  insert into hasil_uji(k,v) values ('K3_tandai_kepsek', pg_temp.jalan(creator, format('select fn_case_add_viewer(%L,%L)::text', cid, kep)));
  insert into hasil_uji(k,v) values ('K3b_kandidat_penanda', pg_temp.jalan(creator, format('select count(*)::text from fn_case_tag_candidates(%L) where user_id=%L', cid, kep)));
  insert into hasil_uji(k,v) values ('K3c_kandidat_eskalasi', pg_temp.jalan(creator, format('select count(*)::text from fn_get_escalation_candidates(%L) where user_id=%L', cid, kep)));
  insert into hasil_uji(k,v) values ('K3d_eskalasi_ke_kepsek', pg_temp.jalan(creator, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'ESCALATED',%L,false,jsonb_build_object('new_handler_user_id', %L::text, 'note','x')) returning event_id::text$q$, cid, sid, creator, kep)));
  insert into hasil_uji(k,v) values ('K3e_kandidat_lain_tetap_ada', pg_temp.jalan(creator, format('select (count(*) > 0)::text from fn_get_escalation_candidates(%L)', cid)));

  -- K4: kasus tutup hanya dibuka kembali Waka Kesiswaan
  insert into hasil_uji(k,v) values ('K3f_status_setelah_percobaan_kepsek', (select status::text from coaching_cases where case_id = cid));
  if (select status::text from coaching_cases where case_id = cid) <> 'CLOSED' then
  insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (cid, sid, 'CLOSED', creator, false, '{"old_status":"OPEN","new_status":"CLOSED","summary":"selesai uji"}');
  end if;
  insert into hasil_uji(k,v) values ('K4_buka_kembali', format('kepsek=%s waka=%s',
    pg_temp.jalan(kep, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'STATUS_CHANGED',%L,false,'{"old_status":"CLOSED","new_status":"MONITORING","note":"dibuka kepsek"}') returning event_id::text$q$, cid, sid, kep)),
    case when pg_temp.jalan(waka, format($q$insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L,%L,'STATUS_CHANGED',%L,false,'{"old_status":"CLOSED","new_status":"MONITORING","note":"dibuka waka kesiswaan"}') returning event_id::text$q$, cid, sid, waka)) like 'GALAT%' then 'GAGAL' else 'ok' end));

  -- K5: ringkasan agregat Kepsek: hanya angka, hanya untuk Kepsek
  r_sum := pg_temp.jalan(kep, 'select fn_kepsek_case_summary()::text');
  if r_sum like 'GALAT%' then
    insert into hasil_uji(k,v) values ('K5_ringkasan_kepsek', r_sum);
  else
    j := r_sum::jsonb;
    insert into hasil_uji(k,v) values ('K5_ringkasan_kepsek', format('total_ada=%s per_status=%s per_track=%s bocor_judul=%s bocor_deskripsi=%s kunci=%s',
      (j->>'total')::int > 0, (j ? 'per_status'), (j ? 'per_track'), position('JUDUL-RAHASIA' in j::text) > 0, position('Deskripsi kasus uji' in j::text) > 0,
      (select string_agg(k2, ',' order by k2) from jsonb_object_keys(j) k2)));
  end if;
  insert into hasil_uji(k,v) values ('K5b_ringkasan_ditolak_bagi_lain', format('waka=%s guru=%s pembuat=%s',
    pg_temp.jalan(waka, 'select fn_kepsek_case_summary()::text'), pg_temp.jalan(guru_lain, 'select fn_kepsek_case_summary()::text'), pg_temp.jalan(creator, 'select fn_kepsek_case_summary()::text')));
end $$;
select k, v from hasil_uji order by no;
