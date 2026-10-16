/*
 * Audit permukaan API lokal. Semua SQL berjalan di PGlite; skrip ini sengaja
 * hanya membaca migrasi dan membuat fixture sementara di database in-memory.
 * Jalankan: SIP_ROOT=<worktree> node tests/api-surface-audit.mjs
 * Sabotase: UJI_SABOTASE=1 SIP_ROOT=<worktree> node tests/api-surface-audit.mjs
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const ROOT = process.env.SIP_ROOT
  ? process.env.SIP_ROOT.replace(/\\/g, '/').replace(/\/?$/, '/')
  : decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(ROOT + p, 'utf8');
const qid = (s) => '"' + String(s).replaceAll('"', '""') + '"';
const lit = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();
const skip = /pg_net|pg_cron/;
const baseline = read('supabase/migrations/20261013000000_baseline.sql')
  .split('\n').map((l) => (/^(DO|CREATE EXTENSION)/.test(l) && skip.test(l) ? `-- ${l}` : l)).join('\n');
const migrationFiles = [
  '20261014000000_region_layer.sql',
  '20261014010000_region_sharing_control.sql',
  '20261014020000_region_service_role_grants.sql',
  '20261014030000_grade_level_smp.sql',
  '20261014040000_fix_close_semester_actor.sql',
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
const migrationTexts = migrationFiles.map((f) => read(`supabase/migrations/${f}`));
const migrationAbsensi = read('supabase/migrations/20261016040000_attendance_breakdown.sql');
const migrationGuard = read('supabase/migrations/20261016050000_wizard_reset_guard.sql');
const migrationJadwal = read('supabase/migrations/20261016060000_wizard_reset_schedules_fix.sql');
const migrationPiket = read('supabase/migrations/20261016065000_piket_policy_row_scope.sql');
const allMigrationText = [baseline, ...migrationTexts, migrationAbsensi, migrationGuard, migrationJadwal, migrationPiket].join('\n');

const db = await PGlite.create({ extensions: { uuid_ossp, pgcrypto, btree_gist } });
const report = [];
const red = [];
const notTested = [];
const whiteList = [
  { pattern: /^fn_school_branding$/, reason: 'branding publik memang menerima slug dan mengembalikan metadata sekolah yang diminta.' },
  { pattern: /^fn_resolve_login_email$/, reason: 'resolver login memang perlu mengembalikan email untuk identifier yang dicari.' },
];
const log = (s = '') => { report.push(String(s)); console.log(String(s)); };
const errText = (e) => `${e?.code || 'ERR'} ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 180)}`;
const isWhite = (name) => whiteList.find((x) => x.pattern.test(name));
const safeRows = (x) => Array.isArray(x?.rows) ? x.rows : [];

await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text)
  $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY, name text, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text,
    owner uuid, owner_id text
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
    SELECT (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'),1)-1,0)]
  $f$;
  CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
    SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)]
  $f$;
  SET search_path = public, extensions;
`);
await db.exec(baseline);
for (const migration of migrationTexts) await db.exec(migration);
await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;`);
await db.exec(migrationAbsensi);
await db.exec(migrationGuard);
await db.exec(migrationJadwal);
if (!process.env.TANPA_PIKET) await db.exec(migrationPiket);   // TANPA_PIKET=1: bukti alat menangkap cacat kebijakan piket

const nextId = (() => { let n = 1000; return () => uuid(n++); })();
const A = { key: 'audit-a', name: 'Sekolah A RAHASIA-AUDIT-A', slug: 'audit-a', ids: {} };
const B = { key: 'audit-b', name: 'Sekolah B RAHASIA-B', slug: 'audit-b', ids: {} };
const REGION_A = uuid(1), REGION_B = uuid(2), REGION_OUT = uuid(3);
const actors = {};
const CORE = { level: uuid(20), version: uuid(21), phase: uuid(22), subject: uuid(23), subjectPhase: uuid(24) };
const SABOTAGE_STUDENT = uuid(900000);

async function setClaims(sub, role = 'authenticated') {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)`, [sub ?? '', role]);
}
async function asActor(actor, fn) {
  await db.exec('RESET ROLE');
  await setClaims(actor.sub, actor.role);
  await db.exec(`SET ROLE ${qid(actor.role)}`);
  try { return await fn(); } finally { await db.exec('RESET ROLE').catch(() => {}); }
}
function actor(name, role, sub, school = null, userId = null) {
  return { name, role, sub, school, userId };
}

await db.exec(`
  INSERT INTO regions (region_id, name) VALUES
    (${lit(REGION_A)}, 'Wilayah A'), (${lit(REGION_B)}, 'Wilayah B'), (${lit(REGION_OUT)}, 'Wilayah Terpisah');
  INSERT INTO storage.buckets (id, name, public) VALUES
    ('audit-private', 'audit-private', false), ('audit-public', 'audit-public', true);
  INSERT INTO core.education_levels (level_id, code, name)
    VALUES (${lit(CORE.level)}, 'SMA', 'Sekolah Menengah Atas') ON CONFLICT DO NOTHING;
  INSERT INTO core.curriculum_versions (version_id, version_code, name, regulation_ref, effective_from)
    VALUES (${lit(CORE.version)}, 'AUDIT-1', 'Kurikulum Audit', 'synthetic', CURRENT_DATE) ON CONFLICT DO NOTHING;
  INSERT INTO core.phases (phase_id, level_id, code, name)
    VALUES (${lit(CORE.phase)}, ${lit(CORE.level)}, 'E', 'Fase E') ON CONFLICT DO NOTHING;
  INSERT INTO core.subjects (subject_id, code, name, subject_type)
    VALUES (${lit(CORE.subject)}, 'AUDIT', 'Mapel Audit', 'UMUM') ON CONFLICT DO NOTHING;
  INSERT INTO core.subject_phases (subject_phase_id, subject_id, phase_id, version_id)
    VALUES (${lit(CORE.subjectPhase)}, ${lit(CORE.subject)}, ${lit(CORE.phase)}, ${lit(CORE.version)}) ON CONFLICT DO NOTHING;
`);

async function ensureAuth(id, email) {
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, email]);
}
async function insertUser(school, roleType, key, authId = nextId(), options = {}) {
  const uid = nextId();
  const email = `${key}@audit.invalid`;
  await ensureAuth(authId, email);
  const flags = roleType === 'KEPSEK' ? 'true' : 'false';
  await db.query(`INSERT INTO public.users
      (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type,
       school_id, is_kepsek, is_active)
    VALUES ($1,$2,$3,$4,$5,'NIP',$6,$7,${flags},true)`,
  [uid, authId, `${key} RAHASIA-${school.key.toUpperCase()}`, email, key.toUpperCase(), roleType, school.ids.school_id]);
  const a = actor(`${roleType} ${school.key.toUpperCase()}`, 'authenticated', authId, school, uid);
  actors[`${school.key}:${roleType}`] = a;
  if (options.student) actors[`${school.key}:SISWA`] = a;
  return { uid, authId, email };
}

await db.query(`INSERT INTO public.schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)
  VALUES ($1,$2,$3,$4,'SMA',true,true), ($5,$6,$7,$8,'SMA',true,true)`,
  [nextId(), A.name, A.slug, REGION_A, nextId(), B.name, B.slug, REGION_B]);
const schoolRows = safeRows(await db.query(`SELECT school_id, slug FROM public.schools ORDER BY slug`));
A.ids.school_id = schoolRows.find((x) => x.slug === A.slug)?.school_id;
B.ids.school_id = schoolRows.find((x) => x.slug === B.slug)?.school_id;
if (!A.ids.school_id || !B.ids.school_id) throw new Error('fixture sekolah gagal dibuat');

await db.query(`INSERT INTO public.school_config (school_name, setup_completed, current_academic_year, current_semester, school_id)
  VALUES ($1,true,'2026/2027','1',$2), ($3,true,'2026/2027','1',$4)`,
  [A.name, A.ids.school_id, B.name, B.ids.school_id]);
const aAdmin = await insertUser(A, 'ADMINISTRATIVE', 'admin-a');
const aGuru = await insertUser(A, 'GURU', 'guru-a');
const aKepsek = await insertUser(A, 'KEPSEK', 'kepsek-a');
const aOrtu = await insertUser(A, 'ORTU', 'ortu-a');
const bAdmin = await insertUser(B, 'ADMINISTRATIVE', 'admin-b');
const bGuru = await insertUser(B, 'GURU', 'guru-b');
const bKepsek = await insertUser(B, 'KEPSEK', 'kepsek-b');
const bOrtu = await insertUser(B, 'ORTU', 'ortu-b');
const noUsers = actor('akun tanpa baris users', 'authenticated', nextId());
const staff = actor('pegawai wilayah', 'authenticated', nextId());
await db.query(`INSERT INTO public.region_staff (auth_user_id, region_id, full_name)
  VALUES ($1,$2,'Pegawai Wilayah Terpisah')`, [staff.sub, REGION_OUT]);
actors.staff = staff; actors.noUsers = noUsers;
actors.anon = actor('anon', 'anon', null);
actors.aAdmin = actors['audit-a:ADMINISTRATIVE'];
actors.aGuru = actors['audit-a:GURU'];
actors.aKepsek = actors['audit-a:KEPSEK'];
actors.aOrtu = actors['audit-a:ORTU'];
actors.bAdmin = actors['audit-b:ADMINISTRATIVE'];
actors.bGuru = actors['audit-b:GURU'];
actors.bKepsek = actors['audit-b:KEPSEK'];
actors.bOrtu = actors['audit-b:ORTU'];

if (process.env.UJI_SABOTASE === '1') {
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.fn_audit_sabotase(p_school_id uuid, p_student_ids uuid[])
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
    DECLARE n integer;
    BEGIN
      IF fn_current_school_id() <> p_school_id THEN
        RAISE EXCEPTION 'akses ditolak';
      END IF;
      DELETE FROM public.students
       WHERE school_id = p_school_id
         AND student_id = ${lit(SABOTAGE_STUDENT)}::uuid
         AND (p_student_ids IS NULL OR student_id = ANY(p_student_ids));
      GET DIAGNOSTICS n = ROW_COUNT;
      RETURN n;
    END;
    $f$;
    REVOKE ALL ON FUNCTION public.fn_audit_sabotase(uuid, uuid[]) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.fn_audit_sabotase(uuid, uuid[]) TO authenticated;
  `);
  log('MODE SABOTASE: fn_audit_sabotase dimuat sebelum audit.');
}

const publicTables = safeRows(await db.query(`
  SELECT c.oid::int AS oid, c.relname, c.relrowsecurity AS rls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`));
const tableNames = new Set(publicTables.map((x) => x.relname));
const tableMeta = new Map();
for (const t of publicTables) {
  const cols = safeRows(await db.query(`
    SELECT a.attnum::int AS attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS typ,
           a.atttypid::int AS typoid, a.attnotnull AS notnull,
           pg_get_expr(ad.adbin,ad.adrelid) AS def, a.attidentity AS identity,
           a.attgenerated AS generated,
           EXISTS (SELECT 1 FROM pg_constraint pk WHERE pk.conrelid=a.attrelid AND pk.contype='p' AND a.attnum=ANY(pk.conkey)) AS pk
    FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [t.oid]));
  tableMeta.set(t.relname, { ...t, cols });
}
const fks = safeRows(await db.query(`
  SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent,
         con.conkey::int[] AS child_keys, con.confkey::int[] AS parent_keys
  FROM pg_constraint con WHERE con.contype='f'`));
const fkByColumn = new Map();
for (const fk of fks) {
  const child = String(fk.child).replace(/^public\./, '').replaceAll('"', '');
  const parent = String(fk.parent).replace(/^public\./, '').replaceAll('"', '');
  if (!tableMeta.has(child)) continue;
  const cm = tableMeta.get(child), pm = tableMeta.get(parent);
  const ckeys = Array.isArray(fk.child_keys) ? fk.child_keys : String(fk.child_keys).replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
  const pkeys = Array.isArray(fk.parent_keys) ? fk.parent_keys : String(fk.parent_keys).replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
  ckeys.forEach((n, i) => {
    const cc = cm.cols.find((x) => x.attnum === Number(n));
    const pc = pm?.cols.find((x) => x.attnum === Number(pkeys[i]));
    if (cc) fkByColumn.set(`${child}.${cc.attname}`, { parent, parentCol: pc?.attname, parentHasSchool: Boolean(pm?.cols.some((x) => x.attname === 'school_id')) });
  });
}
const enumLabels = new Map();
for (const r of safeRows(await db.query(`SELECT t.oid::int AS oid, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid ORDER BY t.oid,e.enumsortorder`))) {
  if (!enumLabels.has(r.oid)) enumLabels.set(r.oid, []);
  enumLabels.get(r.oid).push(r.enumlabel);
}
const pkByTable = new Map();
for (const [name, meta] of tableMeta) pkByTable.set(name, meta.cols.find((x) => x.pk)?.attname || meta.cols.find((x) => x.attname === 'id')?.attname);

const seeded = new Map();
const seedFailures = new Map();
const idByColumn = new Map();
const idByTable = new Map();
let seedSeq = 1;
function rememberRow(table, sid, row) {
  if (!seeded.has(table)) seeded.set(table, new Map());
  seeded.get(table).set(sid || 'global', row);
  const pk = pkByTable.get(table);
  if (pk && row[pk] != null) {
    if (!idByColumn.has(pk)) idByColumn.set(pk, []);
    idByColumn.get(pk).push({ sid, value: row[pk], table });
    idByTable.set(`${table}:${sid || 'global'}`, row[pk]);
  }
  for (const [k, v] of Object.entries(row)) {
    if (/_id$/i.test(k) && v != null) {
      if (!idByColumn.has(k)) idByColumn.set(k, []);
      idByColumn.get(k).push({ sid, value: v, table });
    }
  }
}
function firstId(column, sid) {
  const a = idByColumn.get(column) || [];
  return a.find((x) => x.sid === sid)?.value ?? a.find((x) => x.sid == null)?.value ?? a[0]?.value;
}
function commonId(name, sid) {
  const n = String(name || '').toLowerCase().replace(/^p_/, '');
  const direct = firstId(n, sid);
  if (direct) return direct;
  const aliases = { teacher_id: ['teacher_user_id','user_id'], teacher_user_id: ['teacher_id','user_id'], author_user_id: ['user_id'], created_by_user_id: ['user_id'], owner_user_id: ['user_id'], recorded_by_user_id: ['user_id'], parent_user_id: ['user_id'], scheduled_teacher_id: ['user_id'], bk_user_id: ['user_id'], guru_user_id: ['user_id'], user_id: ['teacher_user_id'] };
  for (const k of aliases[n] || []) { const v = firstId(k, sid); if (v) return v; }
  return undefined;
}
function refValue(table, col, sid) {
  const fk = fkByColumn.get(`${table}.${col}`);
  if (!fk) return undefined;
  const row = seeded.get(fk.parent)?.get(fk.parentHasSchool ? (sid || 'global') : 'global')
    || seeded.get(fk.parent)?.get(sid || 'global');
  return row?.[fk.parentCol];
}
function valueFor(table, col, sid, attempt) {
  const t = String(col.typ).toLowerCase();
  const n = col.attname.toLowerCase();
  if (n === 'school_id') return sid;
  if (n === 'parent_user_id') return { value: sid === A.ids.school_id ? actors.aOrtu.userId : actors.bOrtu.userId };
  if (n === 'teacher_user_id' || n === 'scheduled_teacher_id' || n === 'guru_user_id') return { value: sid === A.ids.school_id ? actors.aGuru.userId : actors.bGuru.userId };
  if (n === 'author_user_id' || n === 'created_by_user_id' || n === 'recorded_by_user_id' || n === 'owner_user_id') return { value: sid === A.ids.school_id ? actors.aGuru.userId : actors.bGuru.userId };
  if (n === 'start_date') return { value: new Date(Date.now() - 86400000).toISOString().slice(0, 10) };
  if (n === 'end_date') return { value: new Date(Date.now() + 86400000).toISOString().slice(0, 10) };
  if (n === 'start_time' || n === 'session_start') return { value: '07:00:00' };
  if (n === 'end_time' || n === 'session_end') return { value: '08:00:00' };
  if (n === 'fase') return { value: 'E' };
  if (n === 'grup' && table === 'student_groups') return { value: 'A' };
  if (n === 'activity_type' && table === 'teacher_attendance_log') return { value: 'ATTENDANCE_SUBMITTED' };
  if (n === 'type' && table === 'notifications') return { value: 'OBSERVATION_NEW' };
  if (n === 'jenis' && table === 'assessments') return { value: 'FORMATIF' };
  if (n === 'document_type' && table === 'teacher_documents') return { value: 'ATP' };
  if (n === 'scope_type' && table === 'teacher_documents') return { value: 'SEMUA_KELAS' };
  if (n === 'scope_type' && table === 'forum_posts') return { value: 'KELAS' };
  if (n === 'status' && table === 'teacher_document_approvals') return { value: 'APPROVED' };
  const ref = refValue(table, col.attname, sid);
  if (ref != null) return { value: ref };
  if (n === 'core_subject_id' || (n === 'subject_id' && table.startsWith('core_'))) return { value: CORE.subject };
  if (n === 'phase_id') return { value: CORE.phase };
  if (n === 'subject_phase_id') return { value: CORE.subjectPhase };
  if (n === 'version_id') return { value: CORE.version };
  if (n === 'level_id') return { value: CORE.level };
  const known = commonId(col.attname, sid);
  if (known && (t === 'uuid' || t.endsWith('[]'))) return { value: known };
  if (t === 'uuid') return { value: uuid(700000 + seedSeq++) };
  if (t.endsWith('[]')) return { array: true };
  if (enumLabels.has(col.typoid)) return { value: enumLabels.get(col.typoid)[attempt % enumLabels.get(col.typoid).length] };
  if (t === 'boolean') return { value: attempt > 1 };
  if (t === 'date') return { value: today };
  if (t.includes('timestamp')) return { value: now };
  if (t === 'time without time zone') return { value: attempt > 1 ? '08:00:00' : '07:00:00' };
  if (/^numeric|^decimal|^real|^double|^money/.test(t)) return { value: n.includes('bobot') ? 1 : (attempt > 1 ? 10 : 1) };
  if (/^smallint|^integer|^bigint/.test(t)) {
    if (n.includes('grade')) return { value: 10 };
    if (n.includes('day_of_week')) return { value: 1 };
    if (n.includes('semester')) return { value: 1 };
    return { value: attempt > 1 ? 10 : 1 };
  }
  if (n.includes('academic_year') || n.includes('tahun')) return { value: '2026/2027' };
  if (t === 'jsonb' || t === 'json') return { literal: "'{}'" };
  const short = t.match(/(?:character varying|character|varchar)\((\d+)\)/);
  if (short) return { value: (`A${seedSeq++}`).slice(0, Number(short[1])) };
  if (n === 'email' || n.includes('email')) return { value: `audit-${sid === A.ids.school_id ? 'a' : 'b'}-${table}-${seedSeq++}@example.invalid` };
  if (n.includes('slug')) return { value: `${table}-${sid === A.ids.school_id ? 'a' : 'b'}-${seedSeq++}` };
  if (n === 'code' || n.includes('kode') || n.includes('identifier') || n.includes('idempotency')) return { value: `X-${table.slice(0, 12)}-${seedSeq++}` };
  if (n.includes('phone')) return { value: '081234567890' };
  if (n.includes('color')) return { value: '#123456' };
  if (n === 'url' || n.endsWith('_url')) return { value: 'https://example.invalid/audit' };
  if (n.includes('type') || n.includes('status') || n.includes('scope') || n.includes('visibility') || n.includes('polarity') || n.includes('reason') || n.includes('provider') || n.includes('model')) return { value: attempt > 1 ? 'MANUAL' : 'INTERNAL' };
  return { value: `${attempt > 1 ? 'ALT' : 'RAHASIA-AUDIT-A'} ${table}.${col.attname}`.slice(0, 190) };
}
function sqlValue(x, col, params) {
  if (x.array) return `ARRAY[]::${col.typ}`;
  if (x.literal) return `${x.literal}::${col.typ}`;
  params.push(x.value);
  return `$${params.length}`;
}
async function trySeed(table, sid, attempt = 0) {
  const meta = tableMeta.get(table);
  if (!meta) throw new Error(`metadata ${table} tidak ada`);
  const cols = [], vals = [], params = [];
  for (const c of meta.cols) {
    if (c.attname === 'school_id') continue;
    if (c.def || c.identity || c.generated || c.typ.toLowerCase() === '"char"') continue;
    if (!c.notnull && !c.pk) continue;
    const x = valueFor(table, c, sid, attempt);
    cols.push(qid(c.attname)); vals.push(sqlValue(x, c, params));
  }
  if (sid != null && meta.cols.some((x) => x.attname === 'school_id')) {
    cols.push(qid('school_id')); vals.push(`$${params.push(sid)}`);
  }
  if (!cols.length) return null;
  const sql = `INSERT INTO public.${qid(table)} (${cols.join(',')}) VALUES (${vals.join(',')}) RETURNING *`;
  const row = safeRows(await db.query(sql, params))[0];
  if (row) rememberRow(table, sid, row);
  return row;
}
function topoOrder() {
  const names = [...tableMeta.keys()];
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const fk of fks) {
    const child = String(fk.child).replace(/^public\./, '').replaceAll('"', '');
    const parent = String(fk.parent).replace(/^public\./, '').replaceAll('"', '');
    if (deps.has(child) && deps.has(parent) && child !== parent) deps.get(child).add(parent);
  }
  const out = [];
  while (deps.size) {
    const ready = [...deps].filter(([, v]) => ![...v].some((p) => deps.has(p))).map(([k]) => k);
    if (!ready.length) { out.push(...deps.keys()); break; }
    for (const n of ready) { out.push(n); deps.delete(n); }
  }
  return out;
}

// Catat baris fixture inti yang dibuat manual sebelum generator berjalan.
for (const table of tableMeta.keys()) {
  const pk = pkByTable.get(table);
  if (!pk) continue;
  for (const school of [A, B]) {
    const rows = safeRows(await db.query(`SELECT * FROM public.${qid(table)} WHERE school_id=$1 LIMIT 1`, [school.ids.school_id]).catch(() => ({ rows: [] })));
    if (rows[0]) rememberRow(table, school.ids.school_id, rows[0]);
  }
}

// Seed global parents first, then every school-scoped table for A and B.
const order = topoOrder();
for (const table of order.filter((x) => !tableMeta.get(x).cols.some((c) => c.attname === 'school_id'))) {
  if (table === 'schools' || table === 'regions') continue;
  for (let attempt = 0; attempt < 3 && !seeded.get(table)?.has('global'); attempt++) {
    try { await trySeed(table, null, attempt); } catch (e) { if (attempt === 2) seedFailures.set(`${table}:global`, errText(e)); }
  }
}
const schoolScoped = order.filter((x) => tableMeta.get(x).cols.some((c) => c.attname === 'school_id'));
for (const table of schoolScoped) {
  if (table === 'schools') {
    const rows = safeRows(await db.query(`SELECT * FROM public.schools WHERE school_id IN ($1,$2)`, [A.ids.school_id, B.ids.school_id]));
    for (const row of rows) rememberRow(table, row.school_id, row);
    continue;
  }
  for (const [school, sid] of [[A, A.ids.school_id], [B, B.ids.school_id]]) {
    if (seeded.get(table)?.has(sid)) continue;
    let ok = false, why = '';
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try { const row = await trySeed(table, sid, attempt); ok = Boolean(row); }
      catch (e) { why = errText(e); }
    }
    if (!ok) seedFailures.set(`${table}:${school.key}`, why || 'INSERT tidak menghasilkan baris');
  }
}
// Re-read successful rows so metadata/FK lookup juga mencakup fixture inti yang dibuat manual.
for (const table of tableMeta.keys()) {
  for (const school of [A, B]) {
    const pk = pkByTable.get(table);
    if (!pk || seeded.get(table)?.has(school.ids.school_id)) continue;
    const rows = safeRows(await db.query(`SELECT * FROM public.${qid(table)} WHERE school_id=$1 LIMIT 1`, [school.ids.school_id]).catch(() => ({ rows: [] })));
    if (rows[0]) rememberRow(table, school.ids.school_id, rows[0]);
  }
}

// Fixture anchors required by the audit: students/accounts and a representative API surface.
async function ensureCoreSchool(school, teacher, parent) {
  const sid = school.ids.school_id;
  const p = await db.query(`SELECT program_id FROM public.programs WHERE school_id=$1 LIMIT 1`, [sid]);
  const program = p.rows[0]?.program_id;
  const c = await db.query(`SELECT class_id FROM public.classes WHERE school_id=$1 LIMIT 1`, [sid]);
  const cls = c.rows[0]?.class_id;
  const subj = (await db.query(`SELECT subject_id FROM public.subjects WHERE school_id=$1 LIMIT 1`, [sid])).rows[0]?.subject_id;
  if (!program || !cls || !subj) return;
  const studentAuth = nextId(), studentUser = nextId(), student = nextId();
  await ensureAuth(studentAuth, `siswa-${school.key}@audit.invalid`);
  try {
    await db.query(`INSERT INTO public.users (user_id,auth_user_id,full_name,email,login_identifier,identifier_type,role_type,school_id)
      VALUES ($1,$2,$3,$4,$5,'NIS','SISWA',$6)`, [studentUser, studentAuth, `Siswa ${school.key} RAHASIA-AUDIT-A`, `siswa-${school.key}@audit.invalid`, `SISWA-${school.key}`, sid]);
    await db.query(`INSERT INTO public.students (student_id,nis,full_name,program_id,user_id,school_id)
      VALUES ($1,$2,$3,$4,$5,$6)`, [student, `NIS-${school.key}`, `Siswa ${school.key} RAHASIA-AUDIT-A`, program, studentUser, sid]);
    school.ids.student_id = student; school.ids.student_user_id = studentUser;
    actors[`${school.key}:SISWA`] = actor(`SISWA ${school.key.toUpperCase()}`, 'authenticated', studentAuth, school, studentUser);
    await db.query(`INSERT INTO public.class_enrollments (student_id,class_id,academic_year,semester,school_id) VALUES ($1,$2,'2026/2027','1',$3) ON CONFLICT DO NOTHING`, [student, cls, sid]);
  } catch (e) { notTested.push(`student fixture ${school.key}: ${errText(e)}`); }
}
await ensureCoreSchool(A, aGuru, aOrtu);
await ensureCoreSchool(B, bGuru, bOrtu);
const aStudents = safeRows(await db.query(`SELECT student_id FROM public.students WHERE school_id=$1 ORDER BY student_id`, [A.ids.school_id]));
A.ids.student_ids = aStudents.map((x) => x.student_id);
const aProgramForSabotage = (await db.query(`SELECT program_id FROM public.programs WHERE school_id=$1 LIMIT 1`, [A.ids.school_id])).rows[0]?.program_id;
if (aProgramForSabotage) {
  await db.query(`INSERT INTO public.students (student_id,nis,full_name,program_id,school_id)
    VALUES ($1,'NIS-SABOTAGE','Siswa Sabotase RAHASIA-AUDIT-A',$2,$3) ON CONFLICT DO NOTHING`,
  [SABOTAGE_STUDENT, aProgramForSabotage, A.ids.school_id]);
  if (!A.ids.student_ids.includes(SABOTAGE_STUDENT)) A.ids.student_ids.push(SABOTAGE_STUDENT);
}
const bStudents = safeRows(await db.query(`SELECT student_id FROM public.students WHERE school_id=$1 ORDER BY student_id`, [B.ids.school_id]));
B.ids.student_ids = bStudents.map((x) => x.student_id);
const allAIds = [...new Set(Object.values(A.ids).flat().filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))];

function seedCoverage() {
  const m = schoolScoped.length;
  const ok = schoolScoped.filter((t) => seeded.get(t)?.has(A.ids.school_id) || seeded.get(t)?.has(B.ids.school_id)).length;
  return { ok, total: m, pct: m ? Math.round(ok * 100 / m) : 0 };
}
const coverage = seedCoverage();
log('\n=== SEED ===');
log(`tabel ber-school_id terseed=${coverage.ok}/${coverage.total} (${coverage.pct}%)`);
for (const [k, v] of seedFailures) log(`TIDAK DISEED ${k}: ${v}`);
if (coverage.pct < 70) log('PENGHALANG TERBESAR: FK/check/unique yang tidak dapat dipenuhi oleh generator metadata; tabel gagal dirinci di atas.');

const schoolTables = schoolScoped;
async function snapshotA() {
  const result = {};
  const sql = schoolTables.map((t) => `SELECT ${lit(t)} AS t, count(*)::int AS n FROM public.${qid(t)} WHERE school_id=${lit(A.ids.school_id)}`).join(' UNION ALL ');
  try { for (const row of safeRows(await db.query(sql))) result[row.t] = Number(row.n || 0); }
  catch { for (const t of schoolTables) result[t] = null; }
  return result;
}
function diffSnapshot(before, after) {
  return schoolTables.filter((t) => before[t] !== after[t]).map((t) => `${t}:${before[t]}->${after[t]}`);
}

const tableReport = {};
const outsiders = [actors.staff, actors.noUsers, actors.bGuru, actors.bAdmin, actors.bKepsek, actors.bOrtu, actors.anon];
const controls = [actors.aAdmin, actors.aGuru, actors.aKepsek];
async function readCount(actorInfo, table, where = '') {
  try {
    return await asActor(actorInfo, async () => Number((await db.query(`SELECT count(*)::int AS n FROM public.${qid(table)} ${where}`)).rows[0]?.n || 0));
  } catch (e) { return `ERR:${e?.code || 'ERR'}`; }
}
log('\n=== PENYAPUAN TABEL public ===');
for (const a of [...outsiders, ...controls]) {
  const row = { all: 0, schoolA: 0, global: 0, errors: 0, visibleA: [] };
  for (const t of publicTables) {
    const hasSid = tableMeta.get(t.relname)?.cols.some((c) => c.attname === 'school_id');
    const n = await readCount(a, t.relname, hasSid ? `WHERE school_id=${lit(A.ids.school_id)}` : '');
    if (typeof n === 'string') { row.errors++; continue; }
    if (hasSid) { row.schoolA += n; if (n > 0) row.visibleA.push(`${t.relname}=${n}`); }
    else { row.global += n; }
    row.all++;
  }
  tableReport[a.name] = row;
  log(`${a.name}: diperiksa=${row.all}, galat=${row.errors}, baris A terlihat=${row.schoolA}, tabel A terlihat=${row.visibleA.length}, global terlihat=${row.global}`);
  if (outsiders.includes(a) && row.visibleA.length > 0) {
    for (const x of row.visibleA) red.push(`BACA TABEL | ${a.name} | ${x} baris sekolah A terlihat`);
  }
}
const controlTables = controls.map((a) => tableReport[a.name]?.visibleA.length || 0);
log(`KONTROL POSITIF: ADMINISTRATIVE/GURU/KEPSEK A melihat baris A di ${controlTables.join(', ')} tabel masing-masing.`);

async function writeProbe(a, table, row) {
  const meta = tableMeta.get(table), pk = pkByTable.get(table);
  if (!meta || !pk || !row?.[pk]) return { status: 'tidak teruji', why: 'tanpa primary key/baris' };
  const mutable = meta.cols.find((c) => !c.pk && !c.def && !c.identity && c.attname !== 'school_id' && /text|char|varchar/.test(c.typ));
  let result = { status: 'ditolak/galat' };
  await db.exec('RESET ROLE'); await setClaims(a.sub, a.role); await db.exec(`BEGIN; SAVEPOINT write_probe`);
  try {
    await db.exec(`SET ROLE ${qid(a.role)}`);
    let r;
    if (mutable) r = await db.query(`UPDATE public.${qid(table)} SET ${qid(mutable.attname)}=${qid(mutable.attname)} || '-WRITE-PROBE' WHERE ${qid(pk)}=$1`, [row[pk]]);
    else r = await db.query(`DELETE FROM public.${qid(table)} WHERE ${qid(pk)}=$1`, [row[pk]]);
    await db.exec('RESET ROLE');
    await db.exec('ROLLBACK');
    // PGlite melaporkan jumlah baris terpengaruh sebagai affectedRows (bukan count); r.count selalu kosong sehingga uji tulis tidak pernah melapor berhasil.
    result = { status: Number(r?.affectedRows ?? 0) > 0 ? 'BERHASIL' : 'ditolak/0 baris' };
    if (result.status === 'BERHASIL') red.push(`TULISAN ${mutable ? 'UPDATE' : 'DELETE'} | ${a.name} | ${table}`);
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {}); await db.exec('RESET ROLE').catch(() => {});
    result = { status: 'ditolak/galat', why: errText(e) };
  }
  return result;
}
log('\n=== UJI PENULISAN (transaksi dibatalkan) ===');
for (const a of outsiders) {
  let success = 0, attempted = 0;
  for (const table of schoolTables) {
    if (!seeded.get(table)?.has(A.ids.school_id)) continue;
    const row = seeded.get(table).get(A.ids.school_id);
    attempted++;
    const r = await writeProbe(a, table, row);
    if (r.status === 'BERHASIL') success++;
  }
  log(`${a.name}: tabel dicoba=${attempted}, penulisan berhasil=${success}`);
}

const typeInfo = new Map(safeRows(await db.query(`SELECT oid::int, format_type(oid,NULL) AS typ FROM pg_type`)).map((r) => [Number(r.oid), r.typ]));
const functionRows = safeRows(await db.query(`
  SELECT p.oid::int AS oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS result, p.proargtypes::oid[] AS argtypes,
         p.proargnames AS argnames, p.proargmodes AS argmodes, p.proretset AS retset,
         p.prosecdef AS secdef,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
    AND pg_get_function_result(p.oid) <> 'trigger'
  ORDER BY p.proname,p.oid`));
const functions = functionRows.filter((f) => f.anon_x || f.auth_x);
function arr(o) {
  if (Array.isArray(o)) return o.map(Number);
  return String(o || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
}
function namesFor(f, count) {
  const a = Array.isArray(f.argnames) ? f.argnames : String(f.argnames || '').replace(/[{}]/g, '').split(',').filter(Boolean);
  return a.slice(0, count);
}
function scalarFor(name, typ, functionName) {
  const low = String(typ).toLowerCase(), n = String(name || '').toLowerCase().replace(/^p_/, '');
  if (low === 'uuid') {
    if (n === 'school_id' || n.includes('school')) return lit(A.ids.school_id) + '::uuid';
    if (n === 'student_id' || n.includes('student')) return lit(A.ids.student_id || A.ids.student_ids?.[0]) + '::uuid';
    const direct = commonId(n, A.ids.school_id);
    return lit(direct || allAIds[0] || nextId()) + '::uuid';
  }
  if (low === 'uuid[]') {
    const values = n.includes('student') ? (A.ids.student_ids || []) : [commonId(n.replace(/_ids$/, '_id'), A.ids.school_id) || allAIds[0] || nextId()];
    return `ARRAY[${values.map((x) => lit(x) + '::uuid').join(',')}]::uuid[]`;
  }
  const enumOid = [...typeInfo].find(([oid, t]) => t === typ)?.[0];
  if (enumOid && enumLabels.has(enumOid)) return lit(enumLabels.get(enumOid)[0]) + '::' + typ;
  if (low === 'boolean') return 'false';
  if (low === 'date') return 'CURRENT_DATE';
  if (low.includes('timestamp')) return 'CURRENT_TIMESTAMP';
  if (low === 'jsonb' || low === 'json') return "'{}'::jsonb";
  if (low.endsWith('[]')) return `ARRAY[]::${typ}`;
  if (/smallint|integer|bigint|numeric|real|double|decimal/.test(low)) return '1';
  if (functionName === 'fn_school_branding' && n.includes('slug')) return lit(A.slug);
  if (functionName === 'fn_resolve_login_email' && n.includes('identifier')) return lit('admin-a');
  if (functionName === 'fn_resolve_login_email' && n === 'school_id') return lit(A.ids.school_id) + '::uuid';
  if (n.includes('academic_year') || n.includes('tahun')) return lit('2026/2027');
  if (n.includes('email')) return lit('admin-a@audit.invalid');
  if (n.includes('content') || n.includes('title') || n.includes('description') || n.includes('body') || n.includes('text')) return lit('x');
  return lit('x');
}
function functionSql(f, nullFirst = false) {
  const oids = arr(f.argtypes);
  const names = namesFor(f, oids.length);
  const args = oids.map((oid, i) => {
    const typ = typeInfo.get(oid) || 'text';
    return nullFirst && i === 0 ? `NULL::${typ}` : scalarFor(names[i], typ, f.proname);
  });
  const call = `public.${qid(f.proname)}(${args.join(', ')})`;
  return f.retset ? `SELECT * FROM ${call}` : `SELECT ${call} AS v`;
}
const markerNames = new Map([[A.ids.school_id, 'school_id A'], [A.name, 'nama sekolah A'], ['RAHASIA-AUDIT-A', 'marker RAHASIA-AUDIT-A']]);
for (const x of allAIds) markerNames.set(x, `id A ${String(x).slice(0, 8)}`);
function leakedMarker(value) {
  const s = JSON.stringify(value ?? '').slice(0, 8000);
  for (const [m, label] of markerNames) if (s.includes(m)) return label;
  return null;
}
async function invokeFunction(f, a, nullFirst = false) {
  const before = await snapshotA();
  let status = 'DITOLAK/GALAT', rows = [], error = '', after = before;
  await db.exec('RESET ROLE'); await setClaims(a.sub, a.role); await db.exec('BEGIN');
  try {
    await db.exec('SAVEPOINT function_call');
    await db.exec(`SET ROLE ${qid(a.role)}`);
    const r = await db.query(functionSql(f, nullFirst)); rows = safeRows(r); status = 'OK';
    await db.exec('RESET ROLE'); after = await snapshotA();
  } catch (e) {
    error = errText(e);
    await db.exec('ROLLBACK TO SAVEPOINT function_call').catch(() => {});
    await db.exec('RESET ROLE').catch(() => {});
    after = await snapshotA();
  } finally { await db.exec('ROLLBACK').catch(() => {}); await db.exec('RESET ROLE').catch(() => {}); }
  const changed = diffSnapshot(before, after);
  const marker = status === 'OK' ? leakedMarker(rows) : null;
  const wl = isWhite(f.proname);
  if (changed.length && !wl) red.push(`FUNGSI MERUBAH DATA A | ${a.name} | ${f.proname}(${f.args}) | ${changed.join(', ')}`);
  if (marker && !wl) red.push(`FUNGSI MEMBOCORKAN DATA A | ${a.name} | ${f.proname}(${f.args}) | penanda=${marker}`);
  return { status, changed, marker, error };
}

log('\n=== SERANGAN FUNGSI ===');
const attackActors = outsiders;
const attackSummary = {};
for (const a of attackActors) {
  const candidates = functions.filter((f) => a.role === 'anon' ? f.anon_x : f.auth_x);
  const s = { functions: candidates.length, calls: 0, ok: 0, denied: 0, red: 0, untested: 0 };
  for (const f of candidates) {
    const r = await invokeFunction(f, a, false); s.calls++;
    if (r.status === 'OK') s.ok++; else s.denied++;
    if (r.changed.length || r.marker && !isWhite(f.proname)) s.red++;
    if (arr(f.argtypes).length) { const n = await invokeFunction(f, a, true); s.calls++; if (n.status === 'OK') s.ok++; else s.denied++; if (n.changed.length || n.marker && !isWhite(f.proname)) s.red++; }
  }
  attackSummary[a.name] = s;
  log(`${a.name}: fungsi=${s.functions}, panggilan=${s.calls}, OK=${s.ok}, ditolak/galat=${s.denied}, MERAH=${s.red}`);
}
log(`Daftar putih fungsi: ${whiteList.map((x) => `${x.pattern} — ${x.reason}`).join(' | ')}`);

log('\n=== STORAGE ===');
const buckets = safeRows(await db.query(`SELECT id,name,public FROM storage.buckets ORDER BY id`));
log(`bucket PGlite: ${buckets.map((x) => `${x.id}(${x.public ? 'publik' : 'privat'})`).join(', ') || '(tidak ada)'}`);
const storagePolicies = safeRows(await db.query(`SELECT schemaname,tablename,policyname,permissive,cmd,roles::text,qual,with_check FROM pg_policies WHERE schemaname='storage' ORDER BY tablename,policyname`));
for (const p of storagePolicies) {
  const expression = `${p.qual || ''} ${p.with_check || ''}`;
  const unconstrained = !/school|foldername|bucket_id|auth\.uid|owner/i.test(expression);
  log(`storage ${p.tablename} | ${p.policyname} | ${p.cmd} | roles=${p.roles} | pembatas sekolah/folder=${!unconstrained}`);
  if (unconstrained && /anon|public/i.test(p.roles || '')) red.push(`STORAGE POLICY TANPA PEMBATAS | ${p.tablename}/${p.policyname} | anon/public`);
}
if (!storagePolicies.length) log('policy storage di PGlite: tidak ada.');

log('\n=== REALTIME ===');
const realtimeTables = [...new Set([...allMigrationText.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([A-Za-z0-9_".]+)/gi)].map((m) => m[1].replaceAll('"', '').split('.').pop()))];
log(`ALTER PUBLICATION supabase_realtime ADD TABLE dalam migrasi: ${realtimeTables.join(', ') || '(tidak ditemukan)'}`);
for (const t of realtimeTables) {
  const meta = tableMeta.get(t);
  if (!meta) { log(`realtime ${t}: tidak ditemukan di PGlite`); continue; }
  const policies = safeRows(await db.query(`SELECT policyname,cmd,roles::text,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND cmd='SELECT'`, [t]));
  const constrained = policies.some((p) => /school_id|fn_current_school|auth\.uid|region/i.test(`${p.qual || ''} ${p.with_check || ''}`));
  log(`realtime ${t}: RLS=${meta.rls}, SELECT policies=${policies.length}, pembatas sekolah=${constrained}`);
  if (!constrained) red.push(`REALTIME TANPA PEMBATAS SEKOLAH | ${t}`);
}
log('Catatan: publikasi realtime yang benar-benar aktif di produksi tidak dapat diperiksa dari PGlite lokal.');

log('\n=== RINGKASAN TEMUAN MERAH ===');
if (!red.length) log('(tidak ada)');
else red.forEach((x, i) => log(`${i + 1}. ${x}`));
if (notTested.length) { log('\n=== TIDAK TERUJI ==='); notTested.forEach((x) => log(`- ${x}`)); }
log(`\nEXIT=${red.length ? 1 : 0}`);
await db.close();
process.exitCode = red.length ? 1 : 0;
