// Uji perilaku penanda must_change_password (jalur resmi fn_confirm_password_changed).
// Berjalan lokal di PGlite: baseline + data sintetis. Tidak menyentuh Supabase.
//   SIP_ROOT=<folder repo> node tests/must-change-password.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const ROOT = process.env.SIP_ROOT ? process.env.SIP_ROOT.replace(/\\/g, '/').replace(/\/?$/, '/') : new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const skip = /pg_net|pg_cron/;
const baseline = readFileSync(ROOT + 'supabase/migrations/20261013000000_baseline.sql', 'utf8').split('\n')
  .map((l) => (/^(DO|CREATE EXTENSION)/.test(l) && skip.test(l) ? `-- ${l}` : l)).join('\n');

const db = await PGlite.create({ extensions: { uuid_ossp, pgcrypto, btree_gist } });
let passed = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS MCP ${++passed}: ${name}`); };
const as = async (authId, sql) => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [authId ?? '']);
  return db.query(sql);
};
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text, owner uuid, owner_id text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$ SELECT (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'),1)-1,0)] $f$;
  CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $f$;
  SET search_path = public, extensions;
`);
await db.exec(baseline);

const S = uuid(1), A = uuid(11), B = uuid(12), AUTH_A = uuid(21), AUTH_B = uuid(22);
await db.exec(`
  INSERT INTO schools (school_id, name, slug) VALUES ('${S}', 'Sekolah Uji', 'uji');
  INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id, must_change_password) VALUES
    ('${A}', '${AUTH_A}', 'Guru A', 'a@staff.internal', 'G-A', 'NIP', 'GURU', '${S}', true),
    ('${B}', '${AUTH_B}', 'Guru B', 'b@staff.internal', 'G-B', 'NIP', 'GURU', '${S}', true);
`);
const flag = async (id) => (await db.query(`SELECT must_change_password AS f, password_changed_at AS t FROM users WHERE user_id = '${id}'`)).rows[0];

await test('akun baru: penanda true dan password_changed_at kosong', async () => {
  const r = await flag(A);
  assert.equal(r.f, true); assert.equal(r.t, null);
});
await test('pengguna biasa TIDAK bisa mematikan penanda lewat UPDATE langsung (42501)', async () => {
  await as(AUTH_A, `SELECT 1`);
  let code = 'OK';
  try { await db.exec(`UPDATE users SET must_change_password = false WHERE user_id = '${A}'`); } catch (e) { code = e.code; }
  assert.equal(code, '42501');
  assert.equal((await flag(A)).f, true);
});
await test('jalur resmi: fn_confirm_password_changed mematikan penanda sendiri dan mengisi waktu', async () => {
  await as(AUTH_A, `SELECT public.fn_confirm_password_changed()`);
  const r = await flag(A);
  assert.equal(r.f, false); assert.notEqual(r.t, null);
});
await test('hanya akun pemanggil yang terpengaruh (akun B tetap true)', async () => {
  assert.equal((await flag(B)).f, true);
});
await test('dipanggil ulang aman (idempoten): tetap false, tanpa galat', async () => {
  await as(AUTH_A, `SELECT public.fn_confirm_password_changed()`);
  assert.equal((await flag(A)).f, false);
});
await test('tanpa sesi (auth.uid kosong) tidak mengubah apa pun', async () => {
  await as(null, `SELECT public.fn_confirm_password_changed()`);
  assert.equal((await flag(B)).f, true);
});
await test('reset admin: penanda bisa dinyalakan lagi (service) lalu dimatikan lagi sekali', async () => {
  // Jalur set-user-password: edge function berjalan sebagai service_role.
  await db.exec(`BEGIN; SET LOCAL ROLE service_role; UPDATE users SET must_change_password = true WHERE user_id = '${A}'; COMMIT;`);
  assert.equal((await flag(A)).f, true);
  await as(AUTH_A, `SELECT public.fn_confirm_password_changed()`);
  assert.equal((await flag(A)).f, false);
});
await test('hak akses: anon tidak boleh memanggil fn_confirm_password_changed', async () => {
  const g = (await db.query(`SELECT has_function_privilege('anon', 'public.fn_confirm_password_changed()', 'EXECUTE') AS v`)).rows[0].v;
  assert.equal(g, false);
});
console.log(`MUST_CHANGE_PASSWORD_COMPLETE ${passed}`);
await db.close();
