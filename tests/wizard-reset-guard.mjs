// Uji penjaga fungsi hapus-data wizard (fn_wizard_reset_students, fn_wizard_reset_schedules, fn_reapply_schedule_templates)
// di PGlite: pemanggil tanpa sekolah/peran (pegawai wilayah, uid NULL) dan admin sekolah LAIN harus ditolak; admin sekolah
// sendiri tetap berhasil. Temuan audit jalur API 16 Okt 2026: penjaga lama "<>" meloloskan pemanggil NULL.
//   SIP_ROOT=<folder repo> node tests/wizard-reset-guard.mjs
//   TANPA_PERBAIKAN=1 ...  -> tidak memuat migrasi perbaikan; uji ini HARUS gagal (bukti uji menangkap celah).
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
const migrationGuard = read('supabase/migrations/20261016050000_wizard_reset_guard.sql');

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
if (!process.env.TANPA_PERBAIKAN) await db.exec(migrationGuard);

const REGION_A = uuid(1);
await db.exec(`INSERT INTO regions (region_id, name) VALUES ('${REGION_A}', 'Kecamatan Guard');`);

// Dua sekolah: A (korban) dan B (pihak luar). Tiap sekolah: admin (ADMINISTRATIVE), guru, 3 siswa, absensi.
async function sekolah(kunci) {
  const sid = uuid(seq++), prog = uuid(seq++), cls = uuid(seq++), subj = uuid(seq++), sch = uuid(seq++);
  const admin = { user: uuid(seq++), auth: uuid(seq++) }, guru = { user: uuid(seq++), auth: uuid(seq++) };
  await db.exec(`
    INSERT INTO schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)
      VALUES ('${sid}', 'Sekolah ${kunci}', '${kunci}', '${REGION_A}', 'SMA', true, true);
    INSERT INTO programs (program_id, code, name, school_id) VALUES ('${prog}', 'UMUM', 'Umum', '${sid}');
    INSERT INTO classes (class_id, name, program_id, academic_year, grade_level, school_id) VALUES ('${cls}', 'X', '${prog}', '2026/2027', 10, '${sid}');
    INSERT INTO subjects (subject_id, code, name, school_id) VALUES ('${subj}', 'MTK', 'Matematika', '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
      VALUES ('${admin.user}', '${admin.auth}', 'Admin ${kunci}', 'adm-${kunci}@staff.internal', 'ADM-${kunci}', 'NIP', 'ADMINISTRATIVE', '${sid}'),
             ('${guru.user}', '${guru.auth}', 'Guru ${kunci}', 'guru-${kunci}@staff.internal', 'G-${kunci}', 'NIP', 'GURU', '${sid}');
    INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,
                                    academic_year, semester, school_id, block_group_id)
      VALUES ('${sch}', '${cls}', '${subj}', '${guru.user}', CURRENT_DATE - 1, '07:00', '08:00', '2026/2027', '1', '${sid}', '${sch}');`);
  for (let i = 1; i <= 3; i++) {
    const st = uuid(seq++);
    await db.exec(`
      INSERT INTO students (student_id, nis, full_name, program_id, school_id) VALUES ('${st}', 'NIS-${kunci}-${i}', 'Siswa ${kunci} ${i}', '${prog}', '${sid}');
      INSERT INTO class_enrollments (student_id, class_id, academic_year, semester, school_id) VALUES ('${st}', '${cls}', '2026/2027', '1', '${sid}');
      INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)
        VALUES ('${sch}', '${st}', 'HADIR', 'TEACHER_DECLARED', '${guru.user}', '${sid}');`);
  }
  return { sid, admin, guru };
}
const A = await sekolah('guarda'), B = await sekolah('guardb');
const STAFF = uuid(9101);
await db.exec(`INSERT INTO region_staff (auth_user_id, region_id, full_name) VALUES ('${STAFF}', '${REGION_A}', 'Pegawai Guard');`);

const hitung = async (tabel, sid) => (await db.query(`SELECT count(*)::int AS n FROM public.${tabel} WHERE school_id = '${sid}'`)).rows[0].n;
// Panggil sebagai peran authenticated dengan identitas tertentu; kembalikan { ok, pesan, kode }.
async function panggil(sub, sql) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
  await db.exec('SET ROLE authenticated');
  await db.exec('BEGIN'); await db.exec('SAVEPOINT p');
  try { const r = await db.query(sql); await db.exec('RELEASE SAVEPOINT p'); await db.exec('COMMIT'); return { ok: true, nilai: r.rows[0]?.v };
  } catch (e) { await db.exec('ROLLBACK'); return { ok: false, kode: e.code, pesan: String(e.message) };
  } finally { await db.exec('RESET ROLE'); }
}
const resetSiswa = (sid, ids = 'NULL') => `SELECT public.fn_wizard_reset_students('${sid}'::uuid, ${ids}::uuid[]) AS v`;
const resetJadwal = (sid) => `SELECT public.fn_wizard_reset_schedules('${sid}'::uuid) AS v`;
const ditolak = (r) => r.ok === false && /Akses ditolak/.test(r.pesan);
const utuh = async () => {
  assert.equal(await hitung('students', A.sid), 3, 'siswa sekolah A harus utuh');
  assert.equal(await hitung('attendance', A.sid), 3, 'absensi sekolah A harus utuh');
  assert.equal(await hitung('class_enrollments', A.sid), 3, 'pendaftaran kelas sekolah A harus utuh');
};

await test('PEGAWAI WILAYAH (tanpa sekolah/peran) ditolak mereset SEMUA siswa sekolah A; data utuh', async () => {
  const r = await panggil(STAFF, resetSiswa(A.sid));
  assert.ok(ditolak(r), 'harus ditolak dengan "Akses ditolak", hasil: ' + JSON.stringify(r));
  await utuh();
});
await test('pemanggil dengan uid NULL ditolak mereset siswa sekolah A; data utuh', async () => {
  const r = await panggil(null, resetSiswa(A.sid));
  assert.ok(ditolak(r), JSON.stringify(r));
  await utuh();
});
await test('pegawai wilayah ditolak walau menyebut id siswa tertentu; data utuh', async () => {
  const ids = (await db.query(`SELECT student_id FROM students WHERE school_id = '${A.sid}'`)).rows.map((x) => "'" + x.student_id + "'").join(',');
  const r = await panggil(STAFF, resetSiswa(A.sid, 'ARRAY[' + ids + ']'));
  assert.ok(ditolak(r), JSON.stringify(r));
  await utuh();
});
await test('guru sekolah A (bukan ADMINISTRATIVE) ditolak; data utuh', async () => {
  const r = await panggil(A.guru.auth, resetSiswa(A.sid));
  assert.ok(ditolak(r), JSON.stringify(r));
  await utuh();
});
await test('ADMINISTRATIVE sekolah B ditolak mereset siswa sekolah A; data utuh', async () => {
  const r = await panggil(B.admin.auth, resetSiswa(A.sid));
  assert.ok(ditolak(r), JSON.stringify(r));
  await utuh();
});
await test('ADMINISTRATIVE sekolah A dengan p_school_id NULL ditolak', async () => {
  const r = await panggil(A.admin.auth, 'SELECT public.fn_wizard_reset_students(NULL::uuid, NULL::uuid[]) AS v');
  assert.ok(ditolak(r), JSON.stringify(r));
  await utuh();
});
await test('fn_wizard_reset_schedules: pegawai wilayah, uid NULL, dan admin sekolah lain ditolak oleh PENJAGA (bukan galat lain)', async () => {
  const jadwalAwal = await hitung('teaching_schedules', A.sid);
  for (const sub of [STAFF, null, B.admin.auth]) {
    const r = await panggil(sub, resetJadwal(A.sid));
    assert.ok(ditolak(r), 'sub=' + sub + ' ' + JSON.stringify(r));
  }
  assert.equal(await hitung('teaching_schedules', A.sid), jadwalAwal);
});
await test('fn_reapply_schedule_templates: hak EXECUTE pengguna login dicabut (jalur legacy mati)', async () => {
  const r = await panggil(A.admin.auth, `SELECT public.fn_reapply_schedule_templates('2026/2027', '1'::semester, '${A.sid}'::uuid) AS v`);
  assert.equal(r.ok, false);
  assert.equal(r.kode, '42501', 'harus permission denied: ' + JSON.stringify(r));
});
await test('KONTROL POSITIF: ADMINISTRATIVE sekolah A tetap dapat mereset siswa sekolahnya sendiri; sekolah B tidak tersentuh', async () => {
  const bAwal = await hitung('students', B.sid);
  const r = await panggil(A.admin.auth, resetSiswa(A.sid));
  assert.equal(r.ok, true, 'admin sekolah sendiri harus berhasil: ' + JSON.stringify(r));
  assert.equal(r.nilai.deleted_students, 3);
  assert.equal(await hitung('students', A.sid), 0);
  assert.equal(await hitung('students', B.sid), bAwal, 'sekolah B tidak boleh tersentuh');
});

console.log(`GUARD_COMPLETE: ${passed} lulus; PGlite saja`);
await db.close();
