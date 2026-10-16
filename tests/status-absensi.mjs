// Uji rincian status absensi di PGlite. Hanya memuat migrasi lokal dan fixture sintetis.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const db = await PGlite.create({ extensions: { uuid_ossp, pgcrypto, btree_gist } });
let passed = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS STATUS ${++passed}: ${name}`); };
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

const REGION_A = uuid(1), REGION_B = uuid(2);
await db.exec(`INSERT INTO regions (region_id, name) VALUES ('${REGION_A}', 'Kecamatan Status A'), ('${REGION_B}', 'Kecamatan Status B');`);

async function school({ name, key, region, share = true, jenjang = 'SMA', statuses, scheduleCount = 1, recordedSchedules = 1 }) {
  const sid = uuid(seq++), program = uuid(seq++), cls = uuid(seq++), subject = uuid(seq++);
  const kepsekUser = uuid(seq++), kepsekAuth = uuid(seq++), teacher = uuid(seq++);
  await db.exec(`
    INSERT INTO schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)
      VALUES ('${sid}', '${name}', '${key}', '${region}', '${jenjang}', ${share}, true);
    INSERT INTO programs (program_id, code, name, school_id) VALUES ('${program}', 'UMUM', 'Umum', '${sid}');
    INSERT INTO classes (class_id, name, program_id, academic_year, grade_level, school_id) VALUES ('${cls}', 'X', '${program}', '2026/2027', 10, '${sid}');
    INSERT INTO subjects (subject_id, code, name, school_id) VALUES ('${subject}', 'MTK', 'Matematika', '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
      VALUES ('${kepsekUser}', '${kepsekAuth}', 'Kepsek ${key}', '${key}@internal.test', 'K-${key}', 'NIP', 'KEPSEK', '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
      VALUES ('${teacher}', '${uuid(seq++)}', 'Guru ${key}', '${key}-guru@internal.test', 'G-${key}', 'NIP', 'GURU', '${sid}');
  `);
  const students = statuses.map(() => ({ id: uuid(seq++) }));
  if (students.length) await db.exec(students.map((s, i) => `
    INSERT INTO students (student_id, nis, full_name, program_id, school_id)
      VALUES ('${s.id}', 'NIS-${key}-${i + 1}', 'Siswa ${key} ${i + 1}', '${program}', '${sid}');
    INSERT INTO class_enrollments (student_id, class_id, academic_year, semester, school_id)
      VALUES ('${s.id}', '${cls}', '2026/2027', '1', '${sid}');`).join('\n'));
  const schedules = Array.from({ length: scheduleCount }, (_, d) => uuid(seq++));
  await db.exec(schedules.map((scheduleId, d) => `
    INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date,
      session_start, session_end, academic_year, semester, school_id, block_group_id)
      VALUES ('${scheduleId}', '${cls}', '${subject}', '${teacher}', CURRENT_DATE - ${d}, '07:00', '08:00',
        '2026/2027', '1', '${sid}', '${scheduleId}');`).join('\n'));
  if (statuses.length && recordedSchedules > 0) await db.exec(statuses.map((status, i) => `
    INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)
      VALUES ('${schedules[0]}', '${students[i].id}', '${status}', 'TEACHER_DECLARED', '${teacher}', '${sid}');`).join('\n'));
  return { sid, cls, subject, teacher, kepsekAuth, students };
}

const statusesA = [...Array(170).fill('HADIR'), ...Array(14).fill('SAKIT'), ...Array(6).fill('IZIN'), ...Array(10).fill('ALPA')];
const A = await school({ name: 'Sekolah Status A', key: 'status-a', region: REGION_A, statuses: statusesA });
const B = await school({ name: 'Sekolah Status B', key: 'status-b', region: REGION_A, statuses: [...Array(7).fill('HADIR'), ...Array(3).fill('ALPA')] });
const C = await school({ name: 'Sekolah Status C', key: 'status-c', region: REGION_A, jenjang: 'SMK', statuses: Array(10).fill('HADIR') });
const LOW = await school({ name: 'Sekolah Data Rendah', key: 'status-low', region: REGION_A, jenjang: 'SMP', statuses: ['HADIR'], scheduleCount: 5 });
const OUT = await school({ name: 'Sekolah Wilayah Lain', key: 'status-out', region: REGION_B, statuses: ['HADIR'] });
const K = await school({ name: 'Sekolah Kepala A', key: 'kepsek-a', region: REGION_A, share: false, statuses: ['HADIR', 'HADIR', 'HADIR', 'SAKIT', 'SAKIT', 'IZIN', 'ALPA', 'ALPA'] });
const GURU_AUTH = uuid(seq++), guruUser = uuid(seq++);
await db.exec(`INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
  VALUES ('${guruUser}', '${GURU_AUTH}', 'Guru biasa', 'guru-biasa@internal.test', 'GURU-BIASA', 'NIP', 'GURU', '${K.sid}');`);
const STAFF_A = uuid(9001), STAFF_B = uuid(9002);
await db.exec(`INSERT INTO region_staff (auth_user_id, region_id, full_name) VALUES
  ('${STAFF_A}', '${REGION_A}', 'Pegawai Status A'), ('${STAFF_B}', '${REGION_B}', 'Pegawai Status B');`);

// Baris tambahan ini sengaja harus diabaikan rincian kepala sekolah: non-NORMAL,
// di luar rentang, dan void. Sekolah K tidak dibagikan sehingga tidak mengubah uji wilayah.
const extraNormal = uuid(seq++), extraNonNormal = uuid(seq++), extraVoid = uuid(seq++);
await db.exec(`
  INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,
    academic_year, semester, meeting_status, school_id, block_group_id)
    VALUES ('${extraNonNormal}', '${K.cls}', '${K.subject}', '${K.teacher}', CURRENT_DATE, '09:00', '10:00', '2026/2027', '1', 'KEGIATAN_SEKOLAH', '${K.sid}', '${extraNonNormal}');
  INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)
    VALUES ('${extraNonNormal}', '${K.students[0].id}', 'HADIR', 'TEACHER_DECLARED', '${K.teacher}', '${K.sid}');
  INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,
    academic_year, semester, meeting_status, school_id, block_group_id)
    VALUES ('${extraNormal}', '${K.cls}', '${K.subject}', '${K.teacher}', CURRENT_DATE - 2, '09:00', '10:00', '2026/2027', '1', 'NORMAL', '${K.sid}', '${extraNormal}');
  INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)
    VALUES ('${extraNormal}', '${K.students[1].id}', 'SAKIT', 'TEACHER_DECLARED', '${K.teacher}', '${K.sid}');
  INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,
    academic_year, semester, meeting_status, school_id, block_group_id)
    VALUES ('${extraVoid}', '${K.cls}', '${K.subject}', '${K.teacher}', CURRENT_DATE, '11:00', '12:00', '2026/2027', '1', 'NORMAL', '${K.sid}', '${extraVoid}');
  INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id, is_void, void_reason)
    VALUES ('${extraVoid}', '${K.students[2].id}', 'IZIN', 'TEACHER_DECLARED', '${K.teacher}', '${K.sid}', true, 'uji status absensi');
`);

const oldKepsek = (await as(K.kepsekAuth,
  `SELECT public.fn_kepsek_monitoring('rentang', NULL, CURRENT_DATE, CURRENT_DATE) AS o`)).rows[0].o;
await db.exec(migrationAbsensi);

const overview = async (authId) => (await as(authId,
  `SELECT public.fn_region_overview_range(CURRENT_DATE - 1, CURRENT_DATE) AS o`)).rows[0].o;
const sekolah = async (authId, name) => (await overview(authId)).sekolah.find((s) => s.nama === name);

await test('sekolah dengan 200 catatan menghitung empat persentase dan jumlahnya 100%', async () => {
  const s = await sekolah(STAFF_A, 'Sekolah Status A');
  assert.deepEqual([s.kehadiran_pct, s.sakit_pct, s.izin_pct, s.alpa_pct], [85, 7, 3, 5]);
  assert.equal(s.kehadiran_pct + s.sakit_pct + s.izin_pct + s.alpa_pct, 100);
  assert.deepEqual(s.absen_kecil, []);
});
await test('ALPA 3 disembunyikan, sementara status lain tetap tampil', async () => {
  const s = await sekolah(STAFF_A, 'Sekolah Status B');
  assert.equal(s.alpa_pct, null);
  assert.ok(s.absen_kecil.includes('alpa'));
  assert.deepEqual([s.kehadiran_pct, s.sakit_pct, s.izin_pct], [70, 0, 0]);
});
await test('status dengan jumlah nol tetap 0% dan tidak masuk absen_kecil', async () => {
  const s = await sekolah(STAFF_A, 'Sekolah Status C');
  assert.deepEqual([s.sakit_pct, s.izin_pct, s.alpa_pct], [0, 0, 0]);
  assert.deepEqual(s.absen_kecil, []);
});
await test('cakupan di bawah 80% menyembunyikan semua persentase status', async () => {
  const s = await sekolah(STAFF_A, 'Sekolah Data Rendah');
  assert.equal(s.status, 'DATA_BELUM_MEMADAI');
  assert.deepEqual([s.kehadiran_pct, s.sakit_pct, s.izin_pct, s.alpa_pct], [null, null, null, null]);
  assert.deepEqual(s.absen_kecil, []);
});
await test('total wilayah memakai sekolah MEMADAI dan aturan kecil pada jumlah gabungan', async () => {
  const o = await overview(STAFF_A);
  assert.deepEqual([o.total.kehadiran_pct, o.total.sakit_pct, o.total.izin_pct, o.total.alpa_pct], [85, 6, 3, 6]);
  assert.deepEqual(o.total.absen_kecil, []);
});
await test('subtotal jenjang memakai denominator catatan sekolah MEMADAI saja', async () => {
  const o = await overview(STAFF_A);
  const j = o.per_jenjang.find((x) => x.jenjang === 'SMA');
  assert.deepEqual([j.kehadiran_pct, j.sakit_pct, j.izin_pct, j.alpa_pct], [84, 7, 3, 6]);
});
await test('pegawai wilayah lain tidak melihat sekolah wilayah A dan keluaran tidak punya identitas siswa', async () => {
  const a = await overview(STAFF_A), b = await overview(STAFF_B);
  assert.ok(!a.sekolah.some((s) => s.nama === 'Sekolah Wilayah Lain'));
  assert.deepEqual(b.sekolah.map((s) => s.nama), ['Sekolah Wilayah Lain']);
  assert.ok(!JSON.stringify(a).match(/NIS-|Siswa status|student_id|full_name/i));
});
await test('key lama summary kepala sekolah sama sebelum dan sesudah migrasi', async () => {
  const now = (await as(K.kepsekAuth, `SELECT public.fn_kepsek_monitoring('rentang', NULL, CURRENT_DATE, CURRENT_DATE) AS o`)).rows[0].o;
  for (const key of ['pct_siswa', 'siswa_hadir', 'siswa_total', 'pct_guru', 'guru_hadir', 'guru_total', 'count_late', 'count_exits']) {
    assert.deepEqual(now.summary[key], oldKepsek.summary[key], key);
  }
});
await test('kepsek sekolah K mendapat rincian hanya untuk NORMAL, bukan void, dalam rentang', async () => {
  const o = (await as(K.kepsekAuth, `SELECT public.fn_kepsek_monitoring('rentang', NULL, CURRENT_DATE, CURRENT_DATE) AS o`)).rows[0].o;
  assert.deepEqual(o.summary.rincian_absensi, { baris: 8, hadir: 3, sakit: 2, izin: 1, alpa: 2 });
});
await test('kepsek sekolah B tidak melihat angka sekolah K dan non-kepsek ditolak', async () => {
  const o = (await as(B.kepsekAuth, `SELECT public.fn_kepsek_monitoring('rentang', NULL, CURRENT_DATE, CURRENT_DATE) AS o`)).rows[0].o;
  assert.deepEqual(o.summary.rincian_absensi, { baris: 10, hadir: 7, sakit: 0, izin: 0, alpa: 3 });
  assert.notEqual(o.summary.rincian_absensi.baris, 8);
  assert.notEqual(await code(GURU_AUTH, `SELECT public.fn_kepsek_monitoring('rentang', NULL, CURRENT_DATE, CURRENT_DATE)`), 'OK');
});

console.log(`STATUS_ABSENSI_COMPLETE: ${passed} lulus; PGlite saja`);
