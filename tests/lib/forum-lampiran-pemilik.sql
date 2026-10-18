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
declare sid uuid; g uuid; g2 uuid; a_g uuid; a_g2 uuid; kep uuid; p1 text; p2 text; p3 text; tag text := to_char(clock_timestamp(), 'HH24MISSUS');
begin
  select school_id into sid from schools where slug = 'smkuji1';
  select user_id, auth_user_id into g, a_g from users where school_id = sid and role_type = 'GURU' and is_active order by user_id limit 1;
  select user_id, auth_user_id into g2, a_g2 from users where school_id = sid and role_type = 'GURU' and is_active and user_id <> g order by user_id limit 1;
  select user_id into kep from users where school_id = sid and (role_type = 'KEPSEK' or is_kepsek) and is_active limit 1;
  p1 := sid::text || '/uji-pemilik-' || tag || '-1.pdf';   -- milik g, tanpa posting yang merujuk (yatim)
  p2 := sid::text || '/uji-pemilik-' || tag || '-2.pdf';   -- milik g2
  p3 := sid::text || '/uji-pemilik-' || tag || '-3.pdf';   -- milik g, folder sekolah lain
  insert into storage.objects(bucket_id, name, owner_id) values ('forum-attachments', p1, a_g::text), ('forum-attachments', p2, a_g2::text);
  insert into hasil_uji(k,v) values ('persona', format('guru=%s guru2=%s kepsek=%s', g is not null, g2 is not null, kep is not null));

  -- Penghapusan langsung di storage.objects diblokir Supabase untuk semua orang (harus lewat Storage API), jadi yang diuji di sini adalah KETERLIHATAN berkas:
  -- storage.remove() hanya dapat menghapus baris yang lolos kebijakan SELECT (forum_attachments_download).
  insert into hasil_uji(k,v) values ('L1_pemilik_melihat_berkas_yatim_sendiri', pg_temp.jalan(g, format('select count(*)::text from storage.objects where bucket_id=%L and name=%L', 'forum-attachments', p1)));
  insert into hasil_uji(k,v) values ('L2_guru_lain_tidak_melihat_berkas_itu', pg_temp.jalan(g2, format('select count(*)::text from storage.objects where bucket_id=%L and name=%L', 'forum-attachments', p1)));
  insert into hasil_uji(k,v) values ('L3_pemilik_lain_melihat_berkasnya_sendiri', pg_temp.jalan(g2, format('select count(*)::text from storage.objects where bucket_id=%L and name=%L', 'forum-attachments', p2)));
  insert into hasil_uji(k,v) values ('L4_guru_tidak_melihat_berkas_guru_lain', pg_temp.jalan(g, format('select count(*)::text from storage.objects where bucket_id=%L and name=%L', 'forum-attachments', p2)));
  insert into hasil_uji(k,v) values ('L5_moderator_tetap_melihat_semua', pg_temp.jalan(kep, format('select count(*)::text from storage.objects where bucket_id=%L and name in (%L,%L)', 'forum-attachments', p1, p2)));
end $$;
select k, v from hasil_uji order by no;
