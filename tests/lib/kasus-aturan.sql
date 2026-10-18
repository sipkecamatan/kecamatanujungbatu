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
  sid uuid; stu uuid; creator uuid; wali uuid; lain uuid; kep uuid; waka uuid; cls uuid; yr text; sm semester; cid uuid; kand text;
  ev text := 'insert into coaching_case_events (case_id, school_id, event_type, author_user_id, is_visible_to_student, payload) values (%L, %L, %L, %L, %s, %L) returning ''ok''';
  stat text := 'select status::text||''/closed_at=''||coalesce(closed_at::text,''null'') from coaching_cases where case_id=%L';
begin
  select school_id into sid from schools where slug='smkuji1';
  select current_academic_year, current_semester into yr, sm from school_config where school_id=sid;
  select u.user_id into creator from users u where u.school_id=sid and u.teacher_code='ABA';
  select ce.class_id into cls from class_enrollments ce join classes c on c.class_id=ce.class_id where ce.school_id=sid and c.name='XI AKL 1' and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null limit 1;
  select ce.student_id into stu from class_enrollments ce where ce.class_id=cls and ce.academic_year=yr and ce.semester=sm and ce.withdrawn_at is null order by ce.student_id limit 1;
  select u.user_id into wali from users u where u.school_id=sid and u.wali_kelas_class_id=cls limit 1;
  select u.user_id into kep from users u where u.school_id=sid and (u.role_type='KEPSEK' or u.is_kepsek) and u.is_active limit 1;
  select u.user_id into waka from users u where u.school_id=sid and (u.role_type='WAKA_KESISWAAN' or u.is_waka_kesiswaan) and u.is_active limit 1;
  insert into coaching_cases (school_id, student_id, title, description, track, status, created_by_user_id, current_handler_user_id)
    values (sid, stu, 'UJI-ATURAN', 'Deskripsi kasus uji aturan lanjutan yang cukup panjang.', 'SEKOLAH', 'OPEN', creator, creator) returning case_id into cid;
  -- "lain": guru aktif yang BUKAN kandidat eskalasi kasus ini
  kand := pg_temp.jalan(creator, format('select string_agg(user_id::text, '','') from fn_get_escalation_candidates(%L)', cid));
  select u.user_id into lain from users u where u.school_id=sid and u.is_active and u.role_type='GURU' and u.user_id <> creator
    and position(u.user_id::text in coalesce(kand,'')) = 0 order by u.user_id limit 1;
  insert into hasil_uji(k,v) values ('persona', 'creator='||(creator is not null)||' wali='||(wali is not null)||' lain='||(lain is not null)||' kepsek='||(kep is not null)||' waka='||(waka is not null)||' wali_kandidat='||(position(wali::text in coalesce(kand,''))>0));

  -- STATUS: maju bebas; event status tidak pernah terlihat oleh siswa/ortu walau diminta
  insert into hasil_uji(k,v) values ('A1_maju_open_ke_review', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'true', '{"new_status":"UNDER_REVIEW"}')));
  insert into hasil_uji(k,v) values ('A1b_event_status_dipaksa_tak_terlihat', (select (not is_visible_to_student)::text from coaching_case_events where case_id=cid and event_type='STATUS_CHANGED' order by created_at desc limit 1));
  -- mundur: tanpa catatan ditolak; satu langkah bercatatan diterima
  insert into hasil_uji(k,v) values ('A2_mundur_tanpa_catatan', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"OPEN"}')));
  insert into hasil_uji(k,v) values ('A2b_mundur_satu_langkah_bercatatan', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"OPEN","note":"salah klasifikasi"}')));
  -- mundur dua langkah ditolak
  perform pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"INTERVENTION"}'));
  insert into hasil_uji(k,v) values ('A3_mundur_dua_langkah', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"OPEN","note":"mundur dua langkah"}')));
  -- status sama / langsung CLOSED lewat STATUS_CHANGED ditolak
  insert into hasil_uji(k,v) values ('A4_status_sama', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"INTERVENTION"}')));
  insert into hasil_uji(k,v) values ('A4b_tutup_lewat_status', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"CLOSED"}')));
  -- NOTE_ADDED boleh terlihat
  insert into hasil_uji(k,v) values ('A5_note_terlihat_tetap_terlihat', pg_temp.jalan(creator, format(ev, cid, sid, 'NOTE_ADDED', creator, 'true', '{"note":"catatan terlihat"}')));
  insert into hasil_uji(k,v) values ('A5b_note_terlihat_tersimpan', (select is_visible_to_student::text from coaching_case_events where case_id=cid and event_type='NOTE_ADDED' order by created_at desc limit 1));

  -- ESKALASI: hanya ke kandidat terkait
  insert into hasil_uji(k,v) values ('B1_eskalasi_ke_non_kandidat', pg_temp.jalan(creator, format(ev, cid, sid, 'ESCALATED', creator, 'false', jsonb_build_object('new_handler_user_id', lain)::text)));
  insert into hasil_uji(k,v) values ('B2_eskalasi_ke_kandidat', pg_temp.jalan(creator, format(ev, cid, sid, 'ESCALATED', creator, 'false', jsonb_build_object('new_handler_user_id', wali)::text)));
  insert into hasil_uji(k,v) values ('B2b_penangan_sekarang_wali', (select (current_handler_user_id = wali)::text from coaching_cases where case_id=cid));
  -- pembuat bukan penangan lagi: tak bisa menulis event status
  insert into hasil_uji(k,v) values ('B3_bekas_penangan_tak_bisa_ubah_status', pg_temp.jalan(creator, format(ev, cid, sid, 'STATUS_CHANGED', creator, 'false', '{"new_status":"MONITORING"}')));

  -- TUTUP dan BUKA KEMBALI
  insert into hasil_uji(k,v) values ('C1_tutup_oleh_penangan', pg_temp.jalan(wali, format(ev, cid, sid, 'CLOSED', wali, 'false', '{"new_status":"CLOSED","summary":"selesai"}')));
  insert into hasil_uji(k,v) values ('C1b_status_tertutup', pg_temp.jalan(wali, format('select status::text from coaching_cases where case_id=%L', cid)));
  insert into hasil_uji(k,v) values ('C2_buka_kembali_oleh_penangan', pg_temp.jalan(wali, format(ev, cid, sid, 'STATUS_CHANGED', wali, 'false', '{"new_status":"MONITORING","note":"buka lagi oleh penangan"}')));
  insert into hasil_uji(k,v) values ('C3_waka_tanpa_catatan', pg_temp.jalan(waka, format(ev, cid, sid, 'STATUS_CHANGED', waka, 'false', '{"new_status":"MONITORING"}')));
  insert into hasil_uji(k,v) values ('C3b_waka_ke_status_selain_monitoring', pg_temp.jalan(waka, format(ev, cid, sid, 'STATUS_CHANGED', waka, 'false', '{"new_status":"OPEN","note":"bukan ke monitoring"}')));
  insert into hasil_uji(k,v) values ('C4_waka_bercatatan', pg_temp.jalan(waka, format(ev, cid, sid, 'STATUS_CHANGED', waka, 'false', '{"new_status":"MONITORING","note":"ada perkembangan baru"}')));
  insert into hasil_uji(k,v) values ('C4b_status_dan_penutupan_setelah_buka', pg_temp.jalan(waka, format(stat, cid)));
  insert into hasil_uji(k,v) values ('C5_kasus_dibuka_kembali_menerima_catatan', pg_temp.jalan(wali, format(ev, cid, sid, 'NOTE_ADDED', wali, 'false', '{"note":"masih bisa"}')));

  -- Tutup lagi lalu Kepsek membuka kembali; event non-status pada kasus tertutup ditolak
  perform pg_temp.jalan(wali, format(ev, cid, sid, 'CLOSED', wali, 'false', '{"new_status":"CLOSED","summary":"selesai lagi"}'));
  insert into hasil_uji(k,v) values ('D1_catatan_pada_kasus_tertutup', pg_temp.jalan(kep, format(ev, cid, sid, 'NOTE_ADDED', kep, 'false', '{"note":"tidak boleh"}')));
  insert into hasil_uji(k,v) values ('D2_kepsek_tak_dapat_buka_kembali', pg_temp.jalan(kep, format(ev, cid, sid, 'STATUS_CHANGED', kep, 'false', '{"new_status":"MONITORING","note":"dibuka kepala sekolah"}')));
  insert into hasil_uji(k,v) values ('D2b_waka_buka_kembali', pg_temp.jalan(waka, format(ev, cid, sid, 'STATUS_CHANGED', waka, 'false', '{"new_status":"MONITORING","note":"dibuka waka kesiswaan"}')));
  insert into hasil_uji(k,v) values ('D3_tutup_dua_kali', (select pg_temp.jalan(creator, format(ev, cid, sid, 'CLOSED', creator, 'false', '{"new_status":"CLOSED"}'))||'/'||pg_temp.jalan(creator, format(ev, cid, sid, 'CLOSED', creator, 'false', '{"new_status":"CLOSED"}'))));

  -- student_updates: tidak ada kebijakan baca staf lagi
  insert into hasil_uji(k,v) values ('E1_student_updates_tanpa_kebijakan_baca', (select count(*)::text from pg_policies where tablename='student_updates' and policyname='rls_student_updates_read_staff'));
end $$;
select k, v from hasil_uji order by no;
