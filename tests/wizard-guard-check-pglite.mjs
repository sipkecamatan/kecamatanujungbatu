// Menjalankan CHECK 21 (tests/lib/wizard-guard-check.mjs) di PGlite lokal: modul YANG SAMA dengan uji live
// tests/tenant-isolation.mjs, dengan mgmtQuery tiruan. Tujuannya memastikan uji live itu sendiri benar sebelum dijalankan
// terhadap produksi (yang butuh token). Semua 16 pemeriksaan harus lulus.
//   SIP_ROOT=<folder repo> node tests/wizard-guard-check-pglite.mjs
//   TANPA_PERBAIKAN=1 ... -> tanpa migrasi perbaikan; pemeriksaan HARUS gagal (bukti uji menangkap celah).
//   TANPA_JADWAL=1 ...    -> penjaga saja, tanpa perbaikan reset jadwal; W6 HARUS gagal.
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

// mgmtQuery tiruan: jalankan SQL multi-pernyataan; kembalikan baris dari pernyataan terakhir yang menghasilkan baris.
async function mgmtQuery(sql) {
  const hasil = await db.exec(sql);
  for (let i = hasil.length - 1; i >= 0; i--) if (hasil[i].fields && hasil[i].fields.length) return hasil[i].rows;
  return [];
}
let gagal = 0, lulus = 0;
const log = {
  pass: (m) => { lulus++; console.log('  PASS ' + m); },
  fail: (m) => { gagal++; console.log('  FAIL ' + m); },
  head: (m) => console.log('\n== ' + m),
  warn: (m) => console.log('  WARN ' + m),
};
const { checkWizardGuard } = await import(pathToFileURL(ROOT + 'tests/lib/wizard-guard-check.mjs').href);
await checkWizardGuard({ mgmtQuery, log });
console.log(`\nCHECK21_PGLITE: ${lulus} lulus, ${gagal} gagal`);
await db.close();
process.exit(gagal ? 1 : 0);
