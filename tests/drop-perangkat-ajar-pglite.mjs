// Uji migrasi 20261016070000_drop_perangkat_ajar.sql di PGlite: tabel/fungsi/tipe perangkat ajar hilang, objek fitur lain tetap.
//   SIP_ROOT=<folder repo> node tests/drop-perangkat-ajar-pglite.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const ROOT = process.env.SIP_ROOT
  ? process.env.SIP_ROOT.replace(/\\/g, '/').replace(/\/?$/, '/')
  : decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(ROOT + p, 'utf8');
const skip = /pg_net|pg_cron/;
const baseline = read('supabase/migrations/20261013000000_baseline.sql').split('\n')
  .map((l) => (/^(DO|CREATE EXTENSION)/.test(l) && skip.test(l) ? `-- ${l}` : l)).join('\n');
const migrationFiles = [
  '20261014000000_region_layer.sql',
  '20261014010000_region_sharing_control.sql',
  '20261015000000_region_hierarchy_piket.sql',
  '20261015010000_region_three_level.sql',
  '20261015020000_region_sharing_per_level.sql',
  '20261015030000_region_kode.sql',
  '20261015040000_region_cleanup_parent.sql',
  '20261015050000_region_staff_must_change_password.sql',
  '20261015060000_region_overview_orang_tua.sql',
  '20261015070000_region_range.sql',
  '20261016010000_region_group.sql',
  '20261016020000_region_wib.sql',
  '20261016030000_region_visibility.sql',
];
const migrations = migrationFiles.map((f) => read(`supabase/migrations/${f}`));
const migrationAbsensi = read('supabase/migrations/20261016040000_attendance_breakdown.sql');
const migrationGuard = read('supabase/migrations/20261016050000_wizard_reset_guard.sql');
const migrationJadwal = read('supabase/migrations/20261016060000_wizard_reset_schedules_fix.sql');
const migrationDrop = read('supabase/migrations/20261016070000_drop_perangkat_ajar.sql');

const db = await PGlite.create({ extensions: { uuid_ossp, pgcrypto, btree_gist } });
let passed = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS GUARD ${++passed}: ${name}`); };
const as = async (authId, sql) => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [authId ?? '']);
  return db.query(sql);
};
const code = async (authId, sql) => {
  try { await as(authId, sql); return 'OK'; } catch (e) { return e.code || String(e.message); }
};
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let seq = 1000;

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
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
for (const migration of migrations) await db.exec(migration);
await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);

await db.exec(migrationAbsensi);
if (!process.env.TANPA_PERBAIKAN) { await db.exec(migrationGuard); if (!process.env.TANPA_JADWAL) await db.exec(migrationJadwal); }

await db.exec(migrationAbsensi);
if (!process.env.TANPA_PERBAIKAN) { await db.exec(migrationGuard); if (!process.env.TANPA_JADWAL) await db.exec(migrationJadwal); }
// auth.uid() Supabase membaca klaim JWT; tiruan harus mengenali request.jwt.claims seperti di produksi.
await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;`);

const ada = async (sql) => (await db.query(sql)).rows[0].v;
const daftar = (a) => 'array[' + a.map((x) => "'" + x + "'").join(',') + ']';
const TABEL = ['evaluation_logs', 'generation_jobs', 'teacher_document_classes', 'teacher_document_approvals', 'teacher_documents', 'teacher_profiles',
  'teaching_contexts', 'ld_context_snapshots', 'ld_document_nodes', 'ld_document_tp_links', 'ld_document_versions', 'ld_documents',
  'ld_program_knowledge_national', 'ld_program_knowledge_school', 'ld_prompt_templates', 'ld_teacher_knowledge'];
const FUNGSI = ['fn_delete_teacher_document', 'fn_waka_approve_doc', 'fn_ld_doc_in_caller_school', 'fn_ld_doc_owned_by_caller',
  'fn_guard_teacher_doc_status_transition', 'update_ld_updated_at'];
const TIPE = ['ld_document_status', 'ld_document_type', 'ld_generation_source', 'ld_node_type'];
const cekAda = async () => ({
  tabel: await ada(`select count(*)::int v from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname = any(${daftar(TABEL)})`),
  fungsi: await ada(`select count(*)::int v from pg_proc where pronamespace='public'::regnamespace and proname = any(${daftar(FUNGSI)})`),
  tipe: await ada(`select count(*)::int v from pg_type where typnamespace='public'::regnamespace and typname = any(${daftar(TIPE)})`),
});
const sebelum = await cekAda();
await test('sebelum migrasi: 16 tabel, 6 fungsi, 4 tipe masih ada (uji tidak vacuous)', async () => assert.deepEqual(sebelum, { tabel: 16, fungsi: 6, tipe: 4 }));
await db.exec(migrationDrop);
const sesudah = await cekAda();
await test('sesudah migrasi: semuanya hilang', async () => assert.deepEqual(sesudah, { tabel: 0, fungsi: 0, tipe: 0 }));
await test('v_core_subjects tetap ada dan dapat dibaca', async () => { await db.query('select * from public.v_core_subjects limit 1'); });
await test('subject_cp_mapping, teaching_assignments, subjects tetap ada', async () =>
  assert.equal(await ada(`select count(*)::int v from pg_class where relnamespace='public'::regnamespace and relname in ('subject_cp_mapping','teaching_assignments','subjects')`), 3));
await test('fn_resolve_teacher_names tetap ada', async () =>
  assert.equal(await ada(`select count(*)::int v from pg_proc where pronamespace='public'::regnamespace and proname='fn_resolve_teacher_names'`), 1));
await test('fn_wizard_reset_schedules tetap ada dan dapat dipanggil (galat penjaga, bukan objek hilang)', async () => {
  const c = await code(null, "select public.fn_wizard_reset_schedules('00000000-0000-0000-0000-000000000001'::uuid)");
  assert.equal(c, 'P0001');
});
await test('dijalankan dua kali ditolak jelas (tabel sudah tidak ada), tidak merusak apa pun', async () => {
  let galat = null;
  try { await db.exec(migrationDrop); } catch (e) { galat = e.code || String(e.message); }
  assert.equal(galat, '42P01');
});
console.log(`\nDROP_PERANGKAT_AJAR_PGLITE: ${passed} lulus`);
await db.close();
