create temp table hasil_uji(no serial, k text, v text) on commit drop;
-- Mencoba menghapus pengguna dan mengembalikan 'dihapus' atau 'GALAT:<sqlstate> <nama constraint>'
create or replace function pg_temp.hapus_pengguna(p_user uuid) returns text language plpgsql as $f$
declare n int;
begin
  begin
    delete from users where user_id = p_user;
    get diagnostics n = row_count;
    -- kembalikan baris agar pengujian berikutnya tetap punya pengguna: dibatalkan lewat savepoint di bawah
    raise exception 'ROLLBACK_UJI:%', n;
  exception
    when others then
      if sqlerrm like 'ROLLBACK_UJI:%' then return 'dihapus:' || split_part(sqlerrm, ':', 2); end if;
      return 'GALAT:' || sqlstate || ' ' || coalesce(
        (select c.conname from pg_constraint c where sqlerrm like '%' || c.conname || '%' and c.conrelid::regclass::text like 'forum%' limit 1), 'bukan-forum');
  end;
end $f$;
do $$
declare sid uuid; yr text; x uuid; y uuid; p_lain uuid; p_tarik uuid; p_aktif uuid; n_notif int;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select current_academic_year into yr from school_config where school_id = sid;
  select user_id into y from users where school_id = sid and role_type = 'GURU' and is_active order by user_id limit 1;
  -- pengguna uji (hanya baris di dalam transaksi ini; tanpa akun Auth; dibatalkan di akhir)
  insert into users(auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
    values (gen_random_uuid(), 'UJI hapus pengguna', 'uji-hapus-forum@uji.invalid', 'uji-hapus-forum-1', 'NIP', 'GURU', sid) returning user_id into x;
  insert into forum_posts(school_id, author_user_id, academic_year, title, body, scope_type) values (sid, y, yr, 'UJI posting orang lain', 'isi', 'SEKOLAH') returning post_id into p_lain;
  insert into forum_post_audience(post_id, school_id, user_id) values (p_lain, sid, x);
  insert into forum_post_acknowledgements(post_id, school_id, user_id) values (p_lain, sid, x);
  insert into forum_post_comments(post_id, school_id, author_user_id, body) values (p_lain, sid, x, 'komentar X'), (p_lain, sid, y, 'komentar Y');
  insert into forum_posts(school_id, author_user_id, academic_year, title, body, scope_type, is_withdrawn, attachment_path)
    values (sid, x, yr, 'UJI posting X ditarik', 'isi', 'SEKOLAH', true, sid::text || '/uji-x.pdf') returning post_id into p_tarik;
  insert into forum_post_comments(post_id, school_id, author_user_id, body) values (p_tarik, sid, y, 'komentar Y pada posting X');

  insert into hasil_uji(k,v) values ('H1_sebelum_pembersihan_ditolak_FK_komentar_atau_posting', pg_temp.hapus_pengguna(x));

  -- langkah pembersihan (cerminan SQL dari supabase/functions/_shared/forum-cleanup.ts, mode onlyWithdrawn)
  delete from notifications where forum_post_id in (select post_id from forum_posts where author_user_id = x and is_withdrawn);
  delete from forum_posts where author_user_id = x and is_withdrawn;
  delete from forum_post_comments where author_user_id = x;
  -- komentar Y pada posting X memicu notifikasi untuk X (trg_notify_forum_comment); notifications.recipient_user_id berkunci NO ACTION
  insert into hasil_uji(k,v) values ('H1b_notifikasi_penerima_juga_menghalangi', pg_temp.hapus_pengguna(x));
  delete from notifications where recipient_user_id = x;   -- langkah yang sudah ada di delete-user dan DITAMBAHKAN ke purge-user
  insert into hasil_uji(k,v) values ('H2_sesudah_pembersihan_penghapusan_pengguna_lolos', pg_temp.hapus_pengguna(x));
  insert into hasil_uji(k,v) values ('H3_data_orang_lain_utuh', format('posting_Y=%s komentar_Y=%s komentar_X=%s posting_X=%s',
    (select count(*) from forum_posts where post_id = p_lain), (select count(*) from forum_post_comments where post_id = p_lain and author_user_id = y),
    (select count(*) from forum_post_comments where author_user_id = x), (select count(*) from forum_posts where post_id = p_tarik)));

  -- posting AKTIF milik pengguna tetap menghalangi (itu sebabnya delete-user menolak lebih awal dengan pesan "nonaktifkan staf")
  insert into forum_posts(school_id, author_user_id, academic_year, title, body, scope_type) values (sid, x, yr, 'UJI posting X aktif', 'isi', 'SEKOLAH') returning post_id into p_aktif;
  insert into hasil_uji(k,v) values ('H4_posting_aktif_tetap_menghalangi', pg_temp.hapus_pengguna(x));
  -- mode purge: seluruh posting ikut dihapus
  delete from notifications where forum_post_id in (select post_id from forum_posts where author_user_id = x);
  delete from forum_posts where author_user_id = x;
  delete from forum_post_comments where author_user_id = x;
  delete from notifications where recipient_user_id = x;
  insert into hasil_uji(k,v) values ('H5_mode_purge_lolos', pg_temp.hapus_pengguna(x));
end $$;
select k, v from hasil_uji order by no;
