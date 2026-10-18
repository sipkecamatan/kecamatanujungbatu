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
  sid uuid; yr text; sem text; kelas uuid; anak uuid; ortu uuid; ortu2 uuid; anak_lain uuid; siswa_u uuid; wali uuid; guru_biasa uuid; guru_lain_kelas uuid; bk uuid;
  tgl date; dow int; semua uuid[]; r uuid[]; ids_jadwal uuid[]; ids_piket uuid[]; p_izin text; p_izin2 uuid; p_guru uuid; n int; kunci uuid := gen_random_uuid();
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year, current_semester::text into yr, sem from school_config where school_id = sid;
  select c.class_id into kelas from classes c where c.school_id = sid and c.name = 'XI AKL 1';
  select st.student_id, st.user_id into anak, siswa_u from students st where st.nis = '2025100541';
  select sp.parent_user_id into ortu from student_parents sp where sp.student_id = anak limit 1;
  select user_id into wali from users where school_id = sid and wali_kelas_class_id = kelas limit 1;
  select user_id into guru_biasa from users where school_id = sid and role_type = 'GURU' and is_active and user_id <> wali order by user_id limit 1;
  select sp.student_id, sp.parent_user_id into anak_lain, ortu2 from student_parents sp where sp.parent_user_id <> ortu and sp.school_id = sid limit 1;
  select bca.bk_user_id into bk from bk_class_assignments bca where bca.class_id = kelas and bca.is_active limit 1;
  insert into hasil_uji(k,v) values ('persona', format('anak=%s ortu=%s wali=%s guru=%s ortu2=%s bk=%s', anak is not null, ortu is not null, wali is not null, guru_biasa is not null, ortu2 is not null, bk is not null));

  -- ── 1. Daftar penerima pada hari kerja yang punya jadwal (fungsi dihitung untuk tanggal tertentu) ──
  select min(session_date) into tgl from teaching_schedules where class_id = kelas and school_id = sid and extract(isodow from session_date) between 1 and 5 and session_date > date '2026-08-01';
  dow := extract(isodow from tgl)::int;
  r := fn_izin_ortu_penerima(anak, tgl);
  select coalesce(array_agg(distinct scheduled_teacher_id), '{}') into ids_jadwal from teaching_schedules where class_id = kelas and school_id = sid and session_date = tgl and scheduled_teacher_id is not null;
  select coalesce(array_agg(distinct user_id), '{}') into ids_piket from duty_schedules where school_id = sid and academic_year = yr and semester::text = sem and is_active and day_of_week::text = (array['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'])[dow];
  insert into hasil_uji(k,v) values ('P1_wali_termasuk', (wali = any(r))::text);
  insert into hasil_uji(k,v) values ('P2_guru_pengajar_hari_itu_semua_termasuk', (ids_jadwal <@ r and cardinality(ids_jadwal) > 0)::text);
  insert into hasil_uji(k,v) values ('P3_guru_piket_hari_itu_semua_termasuk', (ids_piket <@ r and cardinality(ids_piket) > 0)::text);
  select u.user_id into guru_lain_kelas from teaching_schedules ts join users u on u.user_id = ts.scheduled_teacher_id where ts.school_id = sid and ts.class_id <> kelas and ts.session_date = tgl and ts.scheduled_teacher_id <> all (r) limit 1;
  insert into hasil_uji(k,v) values ('P4_guru_kelas_lain_tidak_termasuk', case when guru_lain_kelas is null then 'tanpa_contoh' else (not (guru_lain_kelas = any(r)))::text end);
  insert into hasil_uji(k,v) values ('P5_bk_tidak_termasuk', case when bk is null or bk = any(ids_jadwal) or bk = any(ids_piket) or bk = wali then 'tanpa_contoh' else (not (bk = any(r)))::text end);
  insert into hasil_uji(k,v) values ('P6_hari_minggu_tanpa_piket_dan_jadwal_hanya_wali_dan_guru_wali', (select (cardinality(fn_izin_ortu_penerima(anak, date '2026-10-18')) between 1 and 3)::text));
  perform set_config('app.bypass_users_guard', 'on', true);
  update users set is_active = false where user_id = ids_jadwal[1];
  perform set_config('app.bypass_users_guard', 'off', true);
  insert into hasil_uji(k,v) values ('P7_pengguna_nonaktif_dikeluarkan', (not (ids_jadwal[1] = any(fn_izin_ortu_penerima(anak, tgl))))::text);
  perform set_config('app.bypass_users_guard', 'on', true);
  update users set is_active = true where user_id = ids_jadwal[1];
  perform set_config('app.bypass_users_guard', 'off', true);

  -- ── 2. Pengiriman izin lewat RPC (hari ini) ──
  select pg_temp.jalan(ortu, format('select fn_create_izin_ortu(%L, ''Sakit'', ''Demam sejak semalam'', %L)::text', anak, kunci)) into p_izin;
  insert into hasil_uji(k,v) values ('I1_ortu_kirim_izin', case when p_izin like 'GALAT%' then p_izin else 'ok' end);
  p_guru := p_izin::uuid;
  insert into hasil_uji(k,v) values ('I2_judul_dan_isi_disusun_server', (select (title like 'Izin ketidakhadiran - %' and body like E'Alasan: Sakit\n\nKeterangan: Demam sejak semalam' and scope_type = 'SEKOLAH' and author_user_id = ortu)::text from forum_posts where post_id = p_guru));
  insert into hasil_uji(k,v) values ('I3_penerima_otomatis_sesuai_aturan', (select (wali = any(array_agg(user_id)) and (bk is null or bk = wali or not (bk = any(array_agg(user_id)))))::text from forum_post_audience where post_id = p_guru and user_id <> ortu));
  insert into hasil_uji(k,v) values ('I4_anak_tercatat_sebagai_subjek', (select count(*)::text from forum_post_subjects where post_id = p_guru and student_id = anak));
  insert into hasil_uji(k,v) values ('I5_wali_menerima_dan_mendapat_notifikasi', (select (count(*) = 1)::text from notifications where forum_post_id = p_guru and recipient_user_id = wali));
  insert into hasil_uji(k,v) values ('I6_kirim_ulang_kunci_sama_tidak_ganda', pg_temp.jalan(ortu, format('select (fn_create_izin_ortu(%L, ''Sakit'', ''Demam sejak semalam'', %L)::text = %L)::text', anak, kunci, p_guru::text)));
  insert into hasil_uji(k,v) values ('I7_alasan_tidak_valid', pg_temp.jalan(ortu, format('select fn_create_izin_ortu(%L, ''LIBUR'', ''x'')::text', anak)));
  insert into hasil_uji(k,v) values ('I8_anak_orang_lain_ditolak', case when anak_lain is null then 'tanpa_contoh' else pg_temp.jalan(ortu, format('select fn_create_izin_ortu(%L, ''Izin'', ''x'')::text', anak_lain)) end);
  insert into hasil_uji(k,v) values ('I9_guru_tidak_dapat_memakai', pg_temp.jalan(guru_biasa, format('select fn_create_izin_ortu(%L, ''Izin'', ''x'')::text', anak)));
  insert into hasil_uji(k,v) values ('I10_siswa_tidak_dapat_memakai', pg_temp.jalan(siswa_u, format('select fn_create_izin_ortu(%L, ''Izin'', ''x'')::text', anak)));
  insert into hasil_uji(k,v) values ('I11_keterangan_1001_karakter_ditolak', pg_temp.jalan(ortu, format('select fn_create_izin_ortu(%L, ''Izin'', %L)::text', anak, repeat('k', 1001))));

  -- ── 3. Orang tua tidak dapat membuat posting dengan cara lain ──
  insert into hasil_uji(k,v) values ('J1_rpc_fn_create_forum_post_langsung_ditolak', pg_temp.jalan(ortu, format(
    'select fn_create_forum_post(null, %L, ''isi bebas'', null, ''{}''::uuid[], ''ORANG_TERTENTU'', %L::uuid[], null, ''{}''::uuid[], ''SEKOLAH'', ''Judul bebas'', gen_random_uuid())::text', yr, '{' || wali || '}')));
  insert into hasil_uji(k,v) values ('J2_insert_langsung_ditolak', pg_temp.jalan(ortu, format(
    'with i as (insert into forum_posts(school_id,author_user_id,academic_year,title,body,scope_type) values (%L,%L,%L,''Judul'',''isi'',''SEKOLAH'') returning 1) select count(*)::text from i', sid, ortu, yr)));
  insert into hasil_uji(k,v) values ('J3_guru_tetap_dapat_membuat_posting_biasa', pg_temp.jalan(guru_biasa, format(
    'select fn_create_forum_post(null, %L, ''isi guru'', null, ''{}''::uuid[], ''ORANG_TERTENTU'', %L::uuid[], null, ''{}''::uuid[], ''SEKOLAH'', ''Posting guru'', gen_random_uuid())::text like ''%%-%%''', yr, '{' || ortu || '}')));

  -- ── 4. Komentar orang tua hanya pada izin miliknya ──
  insert into hasil_uji(k,v) values ('K1_ortu_komentar_pada_izin_sendiri', pg_temp.jalan(ortu, format('with i as (insert into forum_post_comments(post_id,school_id,author_user_id,body) values (%L,%L,%L,''terima kasih'') returning 1) select count(*)::text from i', p_guru, sid, ortu)));
  insert into hasil_uji(k,v) values ('K2_wali_membalas_izin', pg_temp.jalan(wali, format('with i as (insert into forum_post_comments(post_id,school_id,author_user_id,body) values (%L,%L,%L,''semoga lekas sembuh'') returning 1) select count(*)::text from i', p_guru, sid, wali)));
  select post_id into p_izin2 from forum_posts where title = 'Posting guru' and author_user_id = guru_biasa limit 1;
  insert into hasil_uji(k,v) values ('K3_ortu_tidak_dapat_komentar_di_pesan_guru', pg_temp.jalan(ortu, format('with i as (insert into forum_post_comments(post_id,school_id,author_user_id,body) values (%L,%L,%L,''balas'') returning 1) select count(*)::text from i', p_izin2, sid, ortu)));
  insert into hasil_uji(k,v) values ('K4_ortu_masih_membaca_pesan_guru_untuknya', pg_temp.jalan(ortu, format('select count(*)::text from forum_posts where post_id=%L', p_izin2)));

  -- ── 5. Tanpa penerima sama sekali ──
  perform set_config('app.bypass_users_guard', 'on', true);
  update users set wali_kelas_class_id = null where wali_kelas_class_id = kelas;
  perform set_config('app.bypass_users_guard', 'off', true);
  delete from guru_wali_assignments where student_id = anak;
  insert into hasil_uji(k,v) values ('Z1_tanpa_penerima_ditolak_dengan_pesan', pg_temp.jalan(ortu, format('select fn_create_izin_ortu(%L, ''Izin'', ''x'')::text', anak)));
end $$;
select k, v from hasil_uji order by no;
