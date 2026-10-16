// Matriks serangan lapisan wilayah di PGlite lokal.
// Skrip ini hanya mengukur keadaan migrasi saat ini; tidak memperbaiki apa pun.
//   SIP_ROOT=<folder repo> node tests/isolation-matrix.mjs
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const ROOT = process.env.SIP_ROOT
  ? process.env.SIP_ROOT.replace(/\\/g, '/').replace(/\/?$/, '/')
  : new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(ROOT + p, 'utf8');
const skip = /pg_net|pg_cron/;
const baseline = read('supabase/migrations/20261013000000_baseline.sql').split('\n')
  .map((l) => (/^(DO|CREATE EXTENSION)/.test(l) && skip.test(l) ? `-- ${l}` : l)).join('\n');
const migration = read('supabase/migrations/20261014000000_region_layer.sql');
const migrationSharing = read('supabase/migrations/20261014010000_region_sharing_control.sql');
const migrationHier = read('supabase/migrations/20261015000000_region_hierarchy_piket.sql');
const migrationTiga = read('supabase/migrations/20261015010000_region_three_level.sql');
const migrationPerTingkat = read('supabase/migrations/20261015020000_region_sharing_per_level.sql');
const migrationKode = read('supabase/migrations/20261015030000_region_kode.sql');
const migrationBersih = read('supabase/migrations/20261015040000_region_cleanup_parent.sql');
const migrationSandi = read('supabase/migrations/20261015050000_region_staff_must_change_password.sql');
const migrationOrtu = read('supabase/migrations/20261015060000_region_overview_orang_tua.sql');
const migrationRentang = read('supabase/migrations/20261015070000_region_range.sql');
const migrationGrup = read('supabase/migrations/20261016010000_region_group.sql');
const migrationWib = read('supabase/migrations/20261016020000_region_wib.sql');

const db = await PGlite.create({ extensions: { uuid_ossp, pgcrypto, btree_gist } });

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
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
await db.exec(migration);
await db.exec(migrationSharing);
await db.exec(migrationHier);
await db.exec(migrationTiga);
await db.exec(migrationPerTingkat);
await db.exec(migrationKode);
await db.exec(migrationBersih);
// auth.jwt() pada Supabase membaca klaim token; tiruan ini membaca setelan yang sama.
await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);
await db.exec(migrationSandi);
await db.exec(migrationOrtu);
await db.exec(migrationRentang);
await db.exec(migrationGrup);
await db.exec(migrationWib);

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOL = '00000000-0000-0000-0000-000000000000';
const secret = (key) => `RAHASIA-${key}`;
const regionNames = {
  KX: 'Kecamatan KX', KY: 'Kecamatan KY', BK1: 'Kabupaten BK1',
  BK2: 'Kabupaten BK2', PV1: 'Provinsi PV1', PV2: 'Provinsi PV2',
};
const regions = {
  KX: uuid(1), KY: uuid(2), BK1: uuid(3), BK2: uuid(4), PV1: uuid(5), PV2: uuid(6),
};
const regionLevel = { KX: 'KECAMATAN', KY: 'KECAMATAN', BK1: 'KABUPATEN', BK2: 'KABUPATEN', PV1: 'PROVINSI', PV2: 'PROVINSI' };
const regionCode = { KX: '110101', KY: '110102', BK1: '1102', BK2: '1103', PV1: '11', PV2: '12' };

let seq = 100;
const schools = {};

// Gaya fixture ini sengaja mengikuti sekolah() pada tests/region-layer.mjs.
async function sekolah({ key, jenjang, region, kabupaten, provinsi, share, active = true, sesiTercatat = 10, alpa = 0 }) {
  const sid = uuid(seq++), prog = uuid(seq++), cls = uuid(seq++), subj = uuid(seq++);
  const teacherUser = uuid(seq++), teacherAuth = uuid(seq++);
  const kepsekUser = uuid(seq++), kepsekAuth = uuid(seq++);
  const ortuUser = uuid(seq++), ortuAuth = uuid(seq++);
  await db.exec(`
    INSERT INTO schools (school_id, name, slug, region_id, kabupaten_id, provinsi_id, jenjang,
                         share_with_region, share_kabupaten, share_provinsi, is_active)
      VALUES ('${sid}', 'Sekolah ${secret(key)}', 'slug-${key}',
              ${region ? `'${regions[region]}'` : 'NULL'},
              ${kabupaten ? `'${regions[kabupaten]}'` : 'NULL'},
              ${provinsi ? `'${regions[provinsi]}'` : 'NULL'},
              '${jenjang}', ${share.kec}, ${share.kab}, ${share.prov}, ${active});
    INSERT INTO programs (program_id, code, name, school_id) VALUES ('${prog}', 'UMUM', 'Umum ${key}', '${sid}');
    INSERT INTO classes (class_id, name, program_id, academic_year, grade_level, school_id)
      VALUES ('${cls}', 'X-${key}', '${prog}', '2026/2027', 10, '${sid}');
    INSERT INTO subjects (subject_id, code, name, school_id) VALUES ('${subj}', 'MTK', 'Matematika ${key}', '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
      VALUES ('${teacherUser}', '${teacherAuth}', 'Guru ${key}', '${key}-guru@staff.internal', 'G-${key}', 'NIP', 'GURU', '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, is_kepsek, school_id)
      VALUES ('${kepsekUser}', '${kepsekAuth}', 'Kepala ${key}', '${key}-kepsek@staff.internal', 'KS-${key}', 'NIP', 'KEPSEK', true, '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
      VALUES ('${ortuUser}', '${ortuAuth}', 'Orang Tua ${key}', '${key}-ortu@ortu.internal', 'O-${key}', 'NIK', 'ORTU', '${sid}');
  `);
  const siswa = [];
  for (let i = 1; i <= 3; i++) {
    const st = uuid(seq++); siswa.push(st);
    await db.exec(`
      INSERT INTO students (student_id, nis, full_name, program_id, school_id)
        VALUES ('${st}', 'NIS-${key}-${i}', '${secret('SISWA')}-${key}-${i}', '${prog}', '${sid}');
      INSERT INTO class_enrollments (student_id, class_id, academic_year, semester, school_id)
        VALUES ('${st}', '${cls}', '2026/2027', '1', '${sid}');
    `);
  }
  // Hubungan orang tua dibuat setelah siswa pertama ada.
  await db.exec(`INSERT INTO student_parents (student_id, parent_user_id, school_id)
                 VALUES ('${siswa[0]}', '${ortuUser}', '${sid}');`);
  let alpaSisa = alpa;
  for (let d = 0; d < 10; d++) {
    const sch = uuid(seq++);
    await db.exec(`
      INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id,
                                      session_date, session_start, session_end, academic_year, semester,
                                      school_id, block_group_id)
        VALUES ('${sch}', '${cls}', '${subj}', '${teacherUser}', CURRENT_DATE - ${d}, '07:00', '08:00',
                '2026/2027', '1', '${sid}', '${sch}');
    `);
    if (d < sesiTercatat) {
      for (const st of siswa) {
        const status = alpaSisa > 0 ? (alpaSisa--, 'ALPA') : 'HADIR';
        await db.exec(`INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)
                       VALUES ('${sch}', '${st}', '${status}', 'TEACHER_DECLARED', '${teacherUser}', '${sid}');`);
      }
    }
  }
  for (let i = 0; i < 2; i++) {
    await db.exec(`INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
                   VALUES ('${uuid(seq++)}', '${uuid(seq++)}', 'Orang Tua tambahan ${key} ${i}',
                           '${key}-ortu-${i}@ortu.internal', 'O-${key}-${i}', 'NIK', 'ORTU', '${sid}');`);
  }
  schools[key] = { key, sid, teacherAuth, kepsekAuth, ortuAuth, teacherUser, expected: [] };
  return schools[key];
}

await db.exec(`
  INSERT INTO regions (region_id, name, level, kode) VALUES
    ('${regions.KX}', '${regionNames.KX}', '${regionLevel.KX}', '${regionCode.KX}'),
    ('${regions.KY}', '${regionNames.KY}', '${regionLevel.KY}', '${regionCode.KY}'),
    ('${regions.BK1}', '${regionNames.BK1}', '${regionLevel.BK1}', '${regionCode.BK1}'),
    ('${regions.BK2}', '${regionNames.BK2}', '${regionLevel.BK2}', '${regionCode.BK2}'),
    ('${regions.PV1}', '${regionNames.PV1}', '${regionLevel.PV1}', '${regionCode.PV1}'),
    ('${regions.PV2}', '${regionNames.PV2}', '${regionLevel.PV2}', '${regionCode.PV2}');
`);

await sekolah({ key: 'S_A', jenjang: 'SMA', region: 'KX', share: { kec: true, kab: false, prov: false }, sesiTercatat: 10, alpa: 1 });
await sekolah({ key: 'S_B', jenjang: 'SMK', kabupaten: 'BK1', share: { kec: false, kab: true, prov: false }, sesiTercatat: 9 });
await sekolah({ key: 'S_C', jenjang: 'SMP', provinsi: 'PV1', share: { kec: false, kab: false, prov: true }, sesiTercatat: 8 });
await sekolah({ key: 'S_D', jenjang: 'SMA', region: 'KX', kabupaten: 'BK1', provinsi: 'PV1', share: { kec: true, kab: false, prov: true }, sesiTercatat: 10 });
await sekolah({ key: 'S_E', jenjang: 'SMK', region: 'KX', share: { kec: false, kab: false, prov: false }, sesiTercatat: 10 });
await sekolah({ key: 'S_F', jenjang: 'SMP', region: 'KX', kabupaten: 'BK1', provinsi: 'PV1', share: { kec: true, kab: true, prov: true }, active: false, sesiTercatat: 10 });
await sekolah({ key: 'S_G', jenjang: 'SMK', region: 'KY', kabupaten: 'BK2', provinsi: 'PV2', share: { kec: true, kab: true, prov: true }, sesiTercatat: 10 });

const staff = {};
for (const [i, key] of ['KX', 'KY', 'BK1', 'BK2', 'PV1', 'PV2'].entries()) {
  const auth = uuid(9001 + i);
  staff[key] = { key: `staff_${key}`, auth, dbRole: 'authenticated', regionKey: key, schoolId: null };
  await db.exec(`INSERT INTO region_staff (auth_user_id, region_id, full_name) VALUES ('${auth}', '${regions[key]}', 'Pegawai ${key}');`);
}

const actors = [
  ...['KX', 'KY', 'BK1', 'BK2', 'PV1', 'PV2'].map((key) => staff[key]),
  { key: 'guru_S_G', auth: schools.S_G.teacherAuth, dbRole: 'authenticated', regionKey: null, schoolId: schools.S_G.sid },
  { key: 'kepsek_S_G', auth: schools.S_G.kepsekAuth, dbRole: 'authenticated', regionKey: null, schoolId: schools.S_G.sid },
  { key: 'ortu_S_G', auth: schools.S_G.ortuAuth, dbRole: 'authenticated', regionKey: null, schoolId: schools.S_G.sid },
  { key: 'anon', auth: null, dbRole: 'anon', regionKey: null, schoolId: null },
];

const expected = {
  KX: ['S_A', 'S_D'], KY: ['S_G'], BK1: ['S_B'], BK2: ['S_G'], PV1: ['S_C', 'S_D'], PV2: ['S_G'],
};
const allSchoolKeys = Object.keys(schools);
const cells = [];
const leaks = [];
const controls = [];

function addCell(actor, method, status, detail = '', involved = []) {
  const cell = { actor: actor.key, method, status, detail, involved };
  cells.push(cell);
  if (status === 'BOCOR') leaks.push(cell);
}

function outcome(value) {
  return { ok: true, value };
}
function errorOutcome(error) {
  return { ok: false, code: error?.code || null, message: String(error?.message || error) };
}
function sameOutcome(a, b) {
  if (a.ok !== b.ok) return false;
  if (!a.ok) return a.code === b.code && a.message === b.message;
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}
function jsonText(value) {
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
}
function markersIn(value) {
  const text = jsonText(value);
  return allSchoolKeys.filter((key) => text.includes(secret(key)));
}
function unauthorizedMarkers(value, actor) {
  const allowed = new Set(expected[actor.regionKey] || []);
  return markersIn(value).filter((key) => !allowed.has(key));
}
function forbiddenRegionNames(value, actor) {
  const text = jsonText(value);
  const own = actor.regionKey ? regionNames[actor.regionKey] : null;
  return Object.entries(regionNames).filter(([, name]) => name !== own && text.includes(name)).map(([key]) => key);
}
function safeSnippet(value) {
  return jsonText(value)
    .replace(/RAHASIA[^",}]*/gi, '[data rahasia disamarkan]')
    .replace(/NIS-[^",}]*/gi, '[NIS disamarkan]')
    .replace(/"(?:full_name|nama_siswa|student_id|nis)"\s*:\s*[^,}]+,?/gi, '[identitas siswa disamarkan]')
    .slice(0, 240);
}
function tableDetail(table, result) {
  if (!result.ok) return `${table}: ditolak (${result.code || result.message})`;
  return `${table}: ${result.rows.length} baris`;
}

async function as(actor, sql, params = []) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [actor.auth ?? '']);
  await db.exec(`SET ROLE ${actor.dbRole}`);
  try {
    return outcome(await db.query(sql, params));
  } catch (error) {
    return errorOutcome(error);
  } finally {
    await db.exec('RESET ROLE');
  }
}
async function valueAs(actor, sql, params = []) {
  const result = await as(actor, sql, params);
  if (!result.ok) return result;
  return outcome(result.value.rows[0]?.o ?? result.value.rows[0]?.v ?? null);
}
async function local(sql, params = []) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  return db.query(sql, params);
}

async function overview(actor) {
  return valueAs(actor, 'SELECT public.fn_region_overview(30) AS o');
}
async function overviewRange(actor, full, group = null) {
  return valueAs(actor,
    `SELECT public.fn_region_overview_range(public.fn_hari_ini() - 29, public.fn_hari_ini(), $1::uuid, $2::boolean) AS o`,
    [group, full]);
}
async function trend(actor, schoolId) {
  return as(actor, `SELECT * FROM public.fn_region_school_trend($1::uuid, 4)`, [schoolId]);
}
async function trendRange(actor, schoolId) {
  return as(actor, `SELECT * FROM public.fn_region_school_trend_range($1::uuid, public.fn_hari_ini() - 60, public.fn_hari_ini(), 'MINGGU')`, [schoolId]);
}

function regionOutside(actor) {
  if (actor.regionKey === 'KX') return regions.KY;
  if (actor.regionKey === 'KY') return regions.KX;
  if (actor.regionKey === 'BK1') return regions.BK2;
  if (actor.regionKey === 'BK2') return regions.BK1;
  if (actor.regionKey === 'PV1') return regions.PV2;
  if (actor.regionKey === 'PV2') return regions.PV1;
  return regions.KY;
}
function statusForDeniedOrSafe(actor, method, result, expectedValue = null) {
  if (!result.ok) {
    addCell(actor, method, 'AMAN', `ditolak (${result.code || result.message})`);
    return;
  }
  const bad = unauthorizedMarkers(result.value, actor);
  if (bad.length) addCell(actor, method, 'BOCOR', `marker sekolah tidak berhak: ${bad.join(', ')}; potongan=${safeSnippet(result.value)}`, bad);
  else if (expectedValue !== null && expectedValue(result.value)) addCell(actor, method, 'BOCOR', `keluaran tak terduga: ${safeSnippet(result.value)}`);
  else addCell(actor, method, 'AMAN', `sekolah terlihat: ${(markersIn(result.value)).join(', ') || '(tidak ada)'}`);
}

// M1: overview penuh.
for (const actor of actors) {
  const result = await overview(actor);
  if (!result.ok) {
    addCell(actor, 'M1 overview', 'AMAN', `ditolak (${result.code || result.message})`);
    continue;
  }
  const bad = [...new Set([...unauthorizedMarkers(result.value, actor), ...forbiddenRegionNames(result.value, actor)])];
  const missing = actor.regionKey ? expected[actor.regionKey].filter((key) => !markersIn(result.value).includes(key)) : [];
  if (bad.length) addCell(actor, 'M1 overview', 'BOCOR', `marker/wilayah tak berhak: ${bad.join(', ')}; potongan=${safeSnippet(result.value)}`, bad);
  else addCell(actor, 'M1 overview', missing.length ? 'AMAN' : 'AMAN', `sekolah terlihat: ${markersIn(result.value).join(', ') || '(tidak ada)'}`);
  if (actor.regionKey && missing.length) controls.push(`M1 ${actor.key}: kontrol positif gagal (${missing.join(', ')})`);
}

// M2: rentang penuh dan mode berkelompok/daftar.
for (const actor of actors) {
  for (const full of [true, false]) {
    const result = await overviewRange(actor, full);
    if (!result.ok) {
      addCell(actor, `M2 range full=${full}`, 'AMAN', `ditolak (${result.code || result.message})`);
      continue;
    }
    const bad = [...new Set([...unauthorizedMarkers(result.value, actor), ...forbiddenRegionNames(result.value, actor)])];
    if (bad.length) addCell(actor, `M2 range full=${full}`, 'BOCOR', `marker/wilayah tak berhak: ${bad.join(', ')}; potongan=${safeSnippet(result.value)}`, bad);
    else addCell(actor, `M2 range full=${full}`, 'AMAN', `sekolah terlihat: ${markersIn(result.value).join(', ') || '(tidak ada)'}`);
  }
}

// M3: kelompok palsu dan UUID nol.
for (const actor of actors) {
  for (const [label, group] of [['asing', regionOutside(actor)], ['nol', NOL]]) {
    const result = await overviewRange(actor, false, group);
    if (!result.ok) {
      addCell(actor, `M3 kelompok ${label}`, 'AMAN', `ditolak (${result.code || result.message})`);
      continue;
    }
    const bad = [...new Set([...unauthorizedMarkers(result.value, actor), ...forbiddenRegionNames(result.value, actor)])];
    if (bad.length) addCell(actor, `M3 kelompok ${label}`, 'BOCOR', `kelompok/sekolah terungkap: ${bad.join(', ')}; potongan=${safeSnippet(result.value)}`, bad);
    else addCell(actor, `M3 kelompok ${label}`, 'AMAN', 'tidak ada sekolah atau nama wilayah asing');
  }
}

// M4: tren sekolah yang tidak boleh dilihat harus kosong dan identik dengan UUID tak ada.
for (const actor of actors) {
  const positive = expected[actor.regionKey]?.[0];
  if (positive) {
    const p = await trend(actor, schools[positive].sid);
    if (!p.ok || p.value.rows.length === 0) controls.push(`M4 ${actor.key}: kontrol positif gagal (${positive})`);
  }
  for (const [key, school] of Object.entries(schools)) {
    if (expected[actor.regionKey]?.includes(key)) continue;
    for (const [label, fn] of [['trend', trend], ['trend_range', trendRange]]) {
      const actual = await fn(actor, school.sid);
      const absent = await fn(actor, uuid(999999));
      const actualRows = actual.ok ? actual.value.rows : null;
      const absentRows = absent.ok ? absent.value.rows : null;
      if (actual.ok && actualRows.length > 0) {
        addCell(actor, `M4 ${label} ${key}`, 'BOCOR', `tren sekolah tak berhak mengembalikan ${actualRows.length} baris`, [key]);
      } else if (!sameOutcome(actual, absent)) {
        addCell(actor, `M4 ${label} ${key}`, 'BOCOR', `hasil berbeda dari UUID tak ada (${actual.ok ? `${actualRows.length} baris` : actual.code} vs ${absent.ok ? `${absentRows.length} baris` : absent.code})`, [key]);
      } else {
        addCell(actor, `M4 ${label} ${key}`, 'AMAN', 'kosong/galat identik dengan UUID tak ada');
      }
    }
  }
}

// M5: pembacaan langsung. Nilai baris tidak dicetak agar nama siswa tidak masuk laporan.
const directTables = ['schools', 'students', 'attendance', 'users', 'regions', 'region_staff', 'region_sharing_log', 'late_arrivals', 'student_exits'];
for (const actor of actors) {
  const findings = [];
  for (const table of directTables) {
    const result = await as(actor, `SELECT * FROM public.${table}`);
    if (!result.ok) {
      findings.push(tableDetail(table, result));
      continue;
    }
    const rows = result.value.rows;
    let leaked = false;
    if (['regions', 'region_staff'].includes(table)) leaked = rows.length > 0;
    else if (rows.length > 0) {
      leaked = rows.some((row) => row.school_id == null ? true : String(row.school_id) !== String(actor.schoolId));
    }
    if (leaked) findings.push(`${table}: ${rows.length} baris [LINTAS_SCOPE]`);
    else findings.push(`${table}: ${rows.length} baris [AMAN]`);
  }
  const leaked = findings.filter((x) => /\[LINTAS_SCOPE\]/.test(x));
  if (leaked.length) addCell(actor, 'M5 SELECT langsung', 'BOCOR', leaked.join('; '));
  else addCell(actor, 'M5 SELECT langsung', 'AMAN', findings.join('; '));
}

// M6: fungsi perubahan persetujuan. Kepala sekolah sekolah lain tidak bisa menargetkan sekolah lain
// karena fungsi ini tidak menerima school_id; pengamatan self-target dicatat sebagai TIDAK TERUJI.
const snapshotShares = async () => (await local(`SELECT school_id, share_with_region, share_kabupaten, share_provinsi FROM schools ORDER BY school_id`)).rows;
for (const actor of [staff.KX, actors.find((a) => a.key === 'guru_S_G'), actors.find((a) => a.key === 'kepsek_S_G')]) {
  const before = await snapshotShares();
  const result = await as(actor, `SELECT public.fn_set_region_sharing_level('KABUPATEN', false)`);
  const after = await snapshotShares();
  const changed = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i])).map((row) => row.school_id);
  if (actor.key === 'kepsek_S_G') {
    // Pulihkan fixture lokal; ini bukan basis data nyata dan menjaga sel-sel berikut tetap independen.
    await local(`UPDATE schools SET share_with_region = true, share_kabupaten = true, share_provinsi = true WHERE school_id = $1`, [schools.S_G.sid]);
    addCell(actor, 'M6 ubah persetujuan lintas sekolah', 'TIDAK TERUJI',
      result.ok ? `fungsi berhasil dan mengubah sekolahnya sendiri (${changed.length} baris); tidak ada parameter school_id untuk mencoba target lain` : `fungsi ditolak (${result.code || result.message}), tetapi tidak ada parameter school_id untuk membuktikan target lain`);
  } else if (!result.ok && changed.length === 0) {
    addCell(actor, 'M6 ubah persetujuan', 'AMAN', `ditolak (${result.code || result.message}); nilai tidak berubah`);
  } else {
    addCell(actor, 'M6 ubah persetujuan', 'BOCOR', `${result.ok ? 'berhasil' : `galat ${result.code}`}; perubahan sintetis: ${changed.length}`);
  }
}

// M7: metadata jumlah terdaftar dibandingkan dengan sekolah yang benar-benar tampil.
for (const actor of actors) {
  if (!actor.regionKey) {
    addCell(actor, 'M7 metadata jumlah', 'TIDAK TERUJI', 'bukan pegawai wilayah');
    continue;
  }
  const result = await overview(actor);
  if (!result.ok) {
    addCell(actor, 'M7 metadata jumlah', 'TIDAK TERUJI', `overview ditolak (${result.code || result.message})`);
    continue;
  }
  const value = result.value;
  const visible = markersIn(value).filter((key) => expected[actor.regionKey].includes(key)).length;
  const shared = Number(value.jumlah_sekolah_dibagikan ?? -1);
  const registered = Number(value.jumlah_sekolah_terdaftar ?? -1);
  if (shared !== visible || registered !== visible) {
    const involved = registered > visible ? allSchoolKeys.filter((key) => !expected[actor.regionKey].includes(key) && ((actor.regionKey === 'KX' && ['S_E', 'S_F'].includes(key)) || (actor.regionKey === 'BK1' && ['S_D', 'S_F'].includes(key)) || (actor.regionKey === 'PV1' && ['S_D', 'S_F'].includes(key)))) : [];
    addCell(actor, 'M7 metadata jumlah', 'BOCOR', `tampil=${visible}, dibagikan=${shared}, terdaftar=${registered}`, involved);
  } else addCell(actor, 'M7 metadata jumlah', 'AMAN', `semua hitungan=${visible}`);
}

// M8: bentuk keluaran untuk pegawai kabupaten/provinsi.
for (const key of ['BK1', 'PV1']) {
  const actor = staff[key];
  const outputs = [];
  const resultSet = [
    ['overview', await overview(actor)],
    ['range-full', await overviewRange(actor, true)],
    ['range-group', await overviewRange(actor, false)],
  ];
  for (const [label, result] of resultSet) {
    if (!result.ok) outputs.push(`${label}: ditolak`);
    else outputs.push(`${label}: ${safeSnippet(result.value)}`);
  }
  const rawObjects = resultSet.filter(([, result]) => result.ok).map(([, result]) => result.value);
  const combined = outputs.join(' ');
  const badKeys = ['region_id', 'kabupaten_id', 'provinsi_id'].filter((k) => rawObjects.some((value) => jsonText(value).includes(`"${k}"`)));
  const grouped = rawObjects.some((value) => value.mode_kelompok === 'KAB' || value.mode_kelompok === 'KEC' || (Array.isArray(value.kelompok) && value.kelompok.length > 0));
  if (badKeys.length || grouped) addCell(actor, 'M8 bentuk keluaran', 'BOCOR', `kolom=${badKeys.join(',') || '-'}; pengelompokan=${grouped}; potongan=${combined.slice(0, 240)}`);
  else addCell(actor, 'M8 bentuk keluaran', 'AMAN', 'tidak ada penanda wilayah/pengelompokan terdeteksi');
}

// M9: konsistensi galat/hasil antara sekolah tak ada dan sekolah ada tetapi tak berhak.
for (const actor of actors) {
  const actual = await trend(actor, schools.S_E.sid);
  const absent = await trend(actor, uuid(999999));
  if (sameOutcome(actual, absent)) addCell(actor, 'M9 keseragaman galat', 'AMAN', 'S_E dan UUID tak ada identik');
  else addCell(actor, 'M9 keseragaman galat', 'BOCOR', `S_E=${actual.ok ? `${actual.value.rows.length} baris` : actual.code}; UUID tak ada=${absent.ok ? `${absent.value.rows.length} baris` : absent.code}`, ['S_E']);
}

// M10: parameter palsu tidak boleh memperluas cakupan atau mengubah keadaan.
for (const actor of actors) {
  if (!actor.regionKey) {
    addCell(actor, 'M10 parameter dipalsukan', 'TIDAK TERUJI', 'bukan pegawai wilayah');
    continue;
  }
  const before = await overview(actor);
  const beforeMarkers = before.ok ? markersIn(before.value).sort().join(',') : '';
  const forged = await overviewRange(actor, false, regionOutside(actor));
  const forgedZero = await overviewRange(actor, false, NOL);
  const bad = [...new Set([
    ...unauthorizedMarkers(forged.ok ? forged.value : null, actor),
    ...unauthorizedMarkers(forgedZero.ok ? forgedZero.value : null, actor),
    ...forbiddenRegionNames(forged.ok ? forged.value : null, actor),
    ...forbiddenRegionNames(forgedZero.ok ? forgedZero.value : null, actor),
  ])];
  const after = await overview(actor);
  const afterMarkers = after.ok ? markersIn(after.value).sort().join(',') : '';
  if (bad.length || beforeMarkers !== afterMarkers) addCell(actor, 'M10 parameter dipalsukan', 'BOCOR', `cakupan berubah/terbuka: ${bad.join(', ') || `${beforeMarkers} -> ${afterMarkers}`}`, bad);
  else addCell(actor, 'M10 parameter dipalsukan', 'AMAN', 'cakupan tetap dan parameter asing tidak mengungkap data');
}

console.log('\nISOLATION MATRIX — PGlite lokal, migrasi apa adanya');
console.log('Aktor | Cara | Status | Catatan');
console.log('--- | --- | --- | ---');
for (const cell of cells) console.log(`${cell.actor} | ${cell.method} | ${cell.status} | ${cell.detail}`);

console.log('\nDAFTAR BOCOR TERINCI');
if (!leaks.length) console.log('(tidak ada)');
else for (const leak of leaks) console.log(`- aktor=${leak.actor}; cara=${leak.method}; sekolah=${leak.involved.join(',') || '-'}; ${leak.detail}`);

const counts = { AMAN: 0, BOCOR: 0, 'TIDAK TERUJI': 0 };
for (const cell of cells) counts[cell.status]++;
console.log(`\nPENGHITUNG AKHIR: AMAN=${counts.AMAN}; BOCOR=${counts.BOCOR}; TIDAK TERUJI=${counts['TIDAK TERUJI']}`);
console.log(`SUPERADMIN: TIDAK TERUJI — berjalan lewat fungsi edge dengan kunci layanan, bukan sebagai baris basis data PGlite.`);
if (controls.length) {
  console.log('KONTROL POSITIF: GAGAL — matriks tidak sahih untuk sel berikut:');
  for (const item of controls) console.log(`- ${item}`);
} else console.log('KONTROL POSITIF: LULUS — setiap pegawai wilayah melihat minimal satu sekolah yang memang berhak.');

await db.close();
