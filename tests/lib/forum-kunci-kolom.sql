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
  sid uuid; sid_lain uuid; yr text; g uuid; g2 uuid; kep uuid; post uuid; a_g uuid; path_ok text; path_lain text; u text;
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select school_id into sid_lain from schools where school_id <> sid limit 1;
  select current_academic_year into yr from school_config where school_id = sid;
  select user_id into g  from users where school_id = sid and role_type = 'GURU' and is_active order by user_id limit 1;
  select user_id into g2 from users where school_id = sid and role_type = 'GURU' and is_active and user_id <> g order by user_id limit 1;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  select auth_user_id into a_g from users where user_id = g;
  insert into forum_posts(school_id, author_user_id, academic_year, title, body, scope_type) values (sid, g, yr, 'UJI kunci', 'isi uji', 'SEKOLAH') returning post_id into post;

  path_ok   := sid::text || '/uji-kunci-' || post::text || '.pdf';
  path_lain := sid::text || '/uji-lain-' || post::text || '.pdf';
  insert into storage.objects(bucket_id, name, owner_id) values ('forum-attachments', path_ok, a_g::text);                                   -- milik penulis
  insert into storage.objects(bucket_id, name, owner_id) values ('forum-attachments', path_lain, (select auth_user_id::text from users where user_id = g2));   -- milik orang lain
  insert into hasil_uji(k,v) values ('persona', format('guru=%s guru2=%s kepsek=%s sekolah_lain=%s', g is not null, g2 is not null, kep is not null, sid_lain is not null));

  -- A-01: attachment_url
  insert into hasil_uji(k,v) values ('K1_url_javascript_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_url=%L where post_id=%L returning 1) select count(*)::text from u', 'javascript:alert(1)', post)));
  insert into hasil_uji(k,v) values ('K2_url_https_pun_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_url=%L where post_id=%L returning 1) select count(*)::text from u', 'https://contoh.id/x.pdf', post)));
  -- A-01/lampiran sah: berkas milik penulis, awalan sekolah
  insert into hasil_uji(k,v) values ('K3_path_milik_sendiri_diterima', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_path=%L, attachment_name=%L, attachment_url=null where post_id=%L returning 1) select count(*)::text from u', path_ok, 'surat.pdf', post)));
  insert into hasil_uji(k,v) values ('K4_path_milik_orang_lain_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_path=%L where post_id=%L returning 1) select count(*)::text from u', path_lain, post)));
  insert into hasil_uji(k,v) values ('K5_path_tidak_ada_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_path=%L where post_id=%L returning 1) select count(*)::text from u', sid::text || '/tidak-ada.pdf', post)));
  insert into hasil_uji(k,v) values ('K6_path_sekolah_lain_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_path=%L where post_id=%L returning 1) select count(*)::text from u', sid_lain::text || '/x.pdf', post)));
  insert into hasil_uji(k,v) values ('K7_path_titik_titik_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_path=%L where post_id=%L returning 1) select count(*)::text from u', sid::text || '/../x.pdf', post)));
  insert into hasil_uji(k,v) values ('K8_lampiran_dikosongkan_boleh', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_path=null, attachment_name=null, attachment_url=null where post_id=%L returning 1) select count(*)::text from u', post)));

  -- A-03: kolom yang tidak boleh disentuh penulis
  insert into hasil_uji(k,v) values ('K9_is_pinned_ditolak',   pg_temp.jalan(g, format('with u as (update forum_posts set is_pinned=true where post_id=%L returning 1) select count(*)::text from u', post)));
  insert into hasil_uji(k,v) values ('K10_is_withdrawn_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set is_withdrawn=true where post_id=%L returning 1) select count(*)::text from u', post)));
  insert into hasil_uji(k,v) values ('K11_deleted_at_ditolak',  pg_temp.jalan(g, format('with u as (update forum_posts set deleted_at=now() where post_id=%L returning 1) select count(*)::text from u', post)));
  insert into hasil_uji(k,v) values ('K12_category_id_ditolak', pg_temp.jalan(g, format('with u as (update forum_posts set category_id=gen_random_uuid() where post_id=%L returning 1) select count(*)::text from u', post)));
  insert into hasil_uji(k,v) values ('K13_author_dan_sekolah_ditolak', format('author=%s sekolah=%s',
    pg_temp.jalan(g, format('with u as (update forum_posts set author_user_id=%L where post_id=%L returning 1) select count(*)::text from u', g2, post)),
    pg_temp.jalan(g, format('with u as (update forum_posts set school_id=%L where post_id=%L returning 1) select count(*)::text from u', sid_lain, post))));

  -- yang sah tetap berjalan
  insert into hasil_uji(k,v) values ('K14_edit_judul_isi_boleh', pg_temp.jalan(g, format('with u as (update forum_posts set title=%L, body=%L, is_edited=true, edited_at=now(), updated_at=now() where post_id=%L returning 1) select count(*)::text from u', 'Judul baru', 'Isi baru', post)));
  insert into hasil_uji(k,v) values ('K15_bukan_penulis_tetap_0_baris', pg_temp.jalan(g2, format('with u as (update forum_posts set title=%L where post_id=%L returning 1) select count(*)::text from u', 'Peretas', post)));
  insert into hasil_uji(k,v) values ('K16_nama_lampiran_terlalu_panjang', pg_temp.jalan(g, format('with u as (update forum_posts set attachment_name=%L where post_id=%L returning 1) select count(*)::text from u', repeat('a', 300), post)));

  -- jalur sah lewat fungsi server tetap berfungsi (SECURITY DEFINER tidak terkena penjaga)
  insert into hasil_uji(k,v) values ('K19_penulis_hapus_via_rpc', pg_temp.jalan(g, format('select count(*)::text from fn_delete_forum_post(%L)', post)));
  insert into hasil_uji(k,v) values ('K20_baris_terhapus', (select count(*)::text from forum_posts where post_id = post));
end $$;
select k, v from hasil_uji order by no;
