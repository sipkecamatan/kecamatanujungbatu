// Uji penjadwalan harian penandaan kehadiran guru (migrasi 20261016080000) di PGlite: perintah cron dijalankan terhadap sesi sintetis.
//   SIP_ROOT=<folder repo> node tests/evaluasi-kehadiran-guru-pglite.mjs
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

const migrationCron = read('supabase/migrations/20261016080000_cron_evaluasi_kehadiran_guru.sql');
const perintah = migrationCron.match(/\$cmd\$([\s\S]*?)\$cmd\$/)[1];
const U = (n) => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, '0')}`;
const SID = U(1), PID = U(2), CID = U(3), MID = U(4), GURU = U(5), ADM = U(6);
const hari = (g) => `((now() AT TIME ZONE 'Asia/Jakarta')::date - ${g})`;   // g=0 hari ini (WIB), 1 kemarin, ...
const sesi = [   // [kode, selisih hari, status pertemuan, indikator awal, ada log guru, ada pengganti, harapan setelah evaluasi]
  ['S1', 1, 'NORMAL', 'PENDING_EVALUATION', true, false, 'HADIR'],
  ['S2', 1, 'NORMAL', 'PENDING_EVALUATION', false, false, 'TIDAK_HADIR'],
  ['S3', 1, 'NORMAL', 'PENDING_EVALUATION', false, true, 'PENDING_EVALUATION'],
  ['S4', 0, 'NORMAL', 'PENDING_EVALUATION', false, false, 'PENDING_EVALUATION'],
  ['S5', 2, 'NORMAL', 'PENDING_EVALUATION', false, false, 'TIDAK_HADIR'],
  ['S6', 3, 'NORMAL', 'PENDING_EVALUATION', false, false, 'PENDING_EVALUATION'],
  ['S7', 1, 'NORMAL', 'HADIR', false, false, 'HADIR'],
  ['S8', 1, 'KEGIATAN_SEKOLAH', 'PENDING_EVALUATION', false, false, 'PENDING_EVALUATION'],
];
await db.exec(migrationCron);   // tanpa pg_cron di PGlite: harus dilewati tanpa galat
await db.exec(`
  INSERT INTO regions (region_id, name) VALUES ('${U(9)}', 'CRON-UJI');
  INSERT INTO schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active) VALUES ('${SID}', 'Cron Uji', 'cron-uji', '${U(9)}', 'SMA', false, true);
  INSERT INTO programs (program_id, code, name, school_id) VALUES ('${PID}', 'UMUM', 'Umum', '${SID}');
  INSERT INTO classes (class_id, name, program_id, academic_year, grade_level, school_id) VALUES ('${CID}', 'X', '${PID}', '2026/2027', 10, '${SID}');
  INSERT INTO subjects (subject_id, code, name, school_id) VALUES ('${MID}', 'MTK', 'Matematika', '${SID}');
  INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id, is_kepsek) VALUES
    ('${GURU}', '${U(7)}', 'Guru Cron', 'guru-cron@staff.internal', 'CRON-GURU', 'NIP', 'GURU', '${SID}', false),
    ('${ADM}', '${U(8)}', 'Admin Cron', 'adm-cron@staff.internal', 'CRON-ADM', 'NIP', 'ADMINISTRATIVE', '${SID}', false);
`);
for (const [kode, g, status, awal, log, peng] of sesi) {
  const id = U(100 + Number(kode.slice(1)));
  await db.exec(
    `INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end, academic_year, semester, school_id, block_group_id, meeting_status, teacher_indicator)
     VALUES ('${id}', '${CID}', '${MID}', '${GURU}', ${hari(g)}, '0${kode.slice(1)}:00', '0${kode.slice(1)}:45', '2026/2027', '1', '${SID}', '${id}', '${status}', '${awal}');` +
    (log ? `INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type, school_id) VALUES ('${id}', '${GURU}', 'ATTENDANCE_SUBMITTED', '${SID}');` : '') +
    (peng ? `INSERT INTO substitute_schedules (schedule_id, substitute_user_id, granted_by_user_id, sync_token_expires_at, school_id) VALUES ('${id}', '${ADM}', '${ADM}', now() + interval '1 day', '${SID}');` : ''));
}
const kini = async () => Object.fromEntries((await db.query(`SELECT 'S' || right(schedule_id::text, 1) AS k, teacher_indicator::text AS v FROM teaching_schedules WHERE school_id = '${SID}'`)).rows.map((r) => [r.k, r.v]));
await test('migrasi cron dilewati tanpa galat bila pg_cron tidak ada', async () => assert.ok(true));
await test('perintah cron terbaca dari migrasi dan memakai tanggal WIB', async () => { assert.ok(perintah.includes('Asia/Jakarta') && perintah.includes('fn_evaluate_teacher_indicators')); });
await test('awal: semua sesi sesuai fixture (uji tidak vacuous)', async () => {
  const a = await kini();
  for (const [kode, , , awal] of sesi) assert.equal(a[kode], awal, kode);
});
await db.exec(perintah);
await test('setelah perintah cron: setiap sesi bernilai sesuai aturan', async () => {
  const a = await kini();
  for (const [kode, , , , , , harap] of sesi) assert.equal(a[kode], harap, `${kode}: terukur ${a[kode]}, harapan ${harap}`);
});
await test('dijalankan lagi tidak mengubah apa pun (idempoten)', async () => {
  const a = await kini(); await db.exec(perintah); const b = await kini(); assert.deepEqual(b, a);
});
console.log(`\nCRON_EVALUASI_PGLITE: ${passed} lulus`);
await db.close();
