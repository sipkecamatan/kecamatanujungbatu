// Uji perilaku lapisan wilayah (migrasi 20261014000000_region_layer.sql) di PGlite.
// Berjalan lokal: baseline + migrasi + data sintetis. Tidak menyentuh Supabase.
//   SIP_ROOT=<folder repo> node tests/region-layer.mjs   (SIP_ROOT opsional)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const ROOT = process.env.SIP_ROOT ? process.env.SIP_ROOT.replace(/\\/g, '/').replace(/\/?$/, '/') : new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
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
const migrationVisibilitas = read('supabase/migrations/20261016030000_region_visibility.sql');
const migrationAbsensi = read('supabase/migrations/20261016040000_attendance_breakdown.sql');

const db = await PGlite.create({ extensions: { uuid_ossp, pgcrypto, btree_gist } });
let passed = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS REGION ${++passed}: ${name}`); };
const as = async (authId, sql, params) => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [authId ?? '']);
  return db.query(sql, params);
};
const code = async (authId, sql) => {
  try { await as(authId, sql); return 'OK'; } catch (e) { return e.code || String(e.message); }
};
const codeAsRole = async (authId, sql, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [authId ?? '']);
  await db.exec(`SET ROLE ${role}`);
  try { await db.query(sql); return 'OK'; } catch (e) { return e.code || String(e.message); }
  finally { await db.exec('RESET ROLE'); }
};
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
await db.exec(migration);
await db.exec(migrationSharing);
await db.exec(migrationHier);
await db.exec(migrationTiga);
await db.exec(migrationPerTingkat);
await db.exec(migrationKode);
await db.exec(migrationBersih);
// auth.jwt() pada Supabase membaca klaim token; tiruan di sini membaca setelan yang sama.
await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);
await db.exec(migrationSandi);
await db.exec(migrationOrtu);
await db.exec(migrationRentang);
await db.exec(migrationGrup);
await db.exec(migrationWib);
await db.exec(migrationVisibilitas);
await db.exec(migrationAbsensi);

await test('penjaga visibilitas: hanya helper dan fungsi persetujuan sah memuat nama share_*', async () => {
  const rows = (await db.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc LIKE ANY (ARRAY['%share_with_region%', '%share_kabupaten%', '%share_provinsi%'])
    ORDER BY p.proname, args`)).rows;
  const actual = rows.map((r) => `${r.proname}(${r.args})`);
  const expected = [
    'fn_region_sekolah_terlihat(p_region uuid)',
    'fn_region_sharing_status()',
    'fn_set_region_sharing(p_share boolean)',
    'fn_set_region_sharing_level(p_level text, p_share boolean)',
  ].sort();
  assert.deepEqual(actual, expected);
  console.log(`VISIBILITY_GUARD_FUNCTIONS: ${actual.join('; ')}`);
});

// Fixture: tiap sekolah punya 3 siswa, 10 sesi (10 hari terakhir), k sesi beratribut absensi,
// dan `alpa` baris ALPA. Semua nama siswa memuat kata "RAHASIA" agar bocor mudah terdeteksi.
let seq = 100;
async function sekolah({ key, nama, jenjang, region, share, active = true, sesiTercatat, alpa }) {
  const sid = uuid(seq++), prog = uuid(seq++), cls = uuid(seq++), tch = uuid(seq++), subj = uuid(seq++);
  await db.exec(`
    INSERT INTO schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)
      VALUES ('${sid}', '${nama}', '${key}', ${region ? `'${region}'` : 'NULL'}, ${jenjang ? `'${jenjang}'` : 'NULL'}, ${share}, ${active});
    INSERT INTO programs (program_id, code, name, school_id) VALUES ('${prog}', 'UMUM', 'Umum', '${sid}');
    INSERT INTO classes (class_id, name, program_id, academic_year, grade_level, school_id) VALUES ('${cls}', 'X', '${prog}', '2026/2027', 10, '${sid}');
    INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
      VALUES ('${tch}', '${uuid(seq++)}', 'Guru ${key}', '${key}@staff.internal', 'G-${key}', 'NIP', 'GURU', '${sid}');
    INSERT INTO subjects (subject_id, code, name, school_id) VALUES ('${subj}', 'MTK', 'Matematika', '${sid}');
  `);
  const siswa = [];
  for (let i = 1; i <= 3; i++) {
    const st = uuid(seq++); siswa.push(st);
    await db.exec(`
      INSERT INTO students (student_id, nis, full_name, program_id, school_id) VALUES ('${st}', 'NIS-${key}-${i}', 'RAHASIA ${key} ${i}', '${prog}', '${sid}');
      INSERT INTO class_enrollments (student_id, class_id, academic_year, semester, school_id) VALUES ('${st}', '${cls}', '2026/2027', '1', '${sid}');`);
  }
  let alpaSisa = alpa;
  for (let d = 0; d < 10; d++) {
    const sch = uuid(seq++);
    await db.exec(`
      INSERT INTO teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,
                                      academic_year, semester, school_id, block_group_id)
      VALUES ('${sch}', '${cls}', '${subj}', '${tch}', CURRENT_DATE - ${d}, '07:00', '08:00', '2026/2027', '1', '${sid}', '${sch}');`);
    if (d < sesiTercatat) {
      for (const st of siswa) {
        const status = alpaSisa > 0 ? (alpaSisa--, 'ALPA') : 'HADIR';
        await db.exec(`INSERT INTO attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)
                       VALUES ('${sch}', '${st}', '${status}', 'TEACHER_DECLARED', '${tch}', '${sid}');`);
      }
    }
  }
  return { sid, tch };
}

const REG_A = uuid(1), REG_B = uuid(2);
await db.exec(`INSERT INTO regions (region_id, name) VALUES ('${REG_A}', 'Kecamatan A'), ('${REG_B}', 'Kecamatan B');`);
const S1 = await sekolah({ key: 'sma1', nama: 'SMA Satu',  jenjang: 'SMA', region: REG_A, share: true,  sesiTercatat: 10, alpa: 3 });
const S2 = await sekolah({ key: 'smk1', nama: 'SMK Satu',  jenjang: 'SMK', region: REG_A, share: true,  sesiTercatat: 9,  alpa: 0 });
const S3 = await sekolah({ key: 'smp1', nama: 'SMP Satu',  jenjang: 'SMP', region: REG_A, share: true,  sesiTercatat: 5,  alpa: 0 });
const S4 = await sekolah({ key: 'smp2', nama: 'SMP Tutup', jenjang: 'SMP', region: REG_A, share: false, sesiTercatat: 10, alpa: 0 });
const S5 = await sekolah({ key: 'smkb', nama: 'SMK B',     jenjang: 'SMK', region: REG_B, share: true,  sesiTercatat: 10, alpa: 0 });
const S6 = await sekolah({ key: 'smk2', nama: 'SMK Dua',   jenjang: 'SMK', region: REG_A, share: true,  sesiTercatat: 10, alpa: 6 });

const STAFF_A = uuid(9001), STAFF_B = uuid(9002), GURU_AUTH = (await db.query(`SELECT auth_user_id FROM users WHERE login_identifier = 'G-sma1'`)).rows[0].auth_user_id;
await db.exec(`INSERT INTO region_staff (auth_user_id, region_id, full_name) VALUES
  ('${STAFF_A}', '${REG_A}', 'Pegawai A'), ('${STAFF_B}', '${REG_B}', 'Pegawai B');`);

const overview = async (authId, days = 30) => (await as(authId, `SELECT public.fn_region_overview(${days}) AS o`)).rows[0].o;

await test('akun sekolah (guru) ditolak 42501 pada fn_region_overview', async () => {
  assert.equal(await code(GURU_AUTH, `SELECT public.fn_region_overview(30)`), '42501');
});
await test('pengguna tanpa identitas (auth.uid NULL) ditolak 42501', async () => {
  assert.equal(await code(null, `SELECT public.fn_region_overview(30)`), '42501');
});
await test('pegawai wilayah A hanya melihat sekolah opt-in di wilayahnya', async () => {
  const o = await overview(STAFF_A);
  const nama = o.sekolah.map((s) => s.nama).sort();
  assert.deepEqual(nama, ['SMA Satu', 'SMK Dua', 'SMK Satu', 'SMP Satu']);
  assert.equal(o.jumlah_sekolah_dibagikan, 4);
  assert.equal(o.jumlah_sekolah_terdaftar, o.jumlah_sekolah_dibagikan);
});
await test('sekolah tanpa opt-in tidak muncul dan tidak bocor lewat nama', async () => {
  const o = await overview(STAFF_A);
  assert.ok(!JSON.stringify(o).includes('SMP Tutup'));
});
await test('wilayah B hanya melihat sekolahnya; total disembunyikan karena < 3 sekolah', async () => {
  const o = await overview(STAFF_B);
  assert.deepEqual(o.sekolah.map((s) => s.nama), ['SMK B']);
  assert.equal(o.total, null);
});
await test('total wilayah A tampil (>= 3 sekolah)', async () => {
  const o = await overview(STAFF_A);
  assert.notEqual(o.total, null);
  assert.equal(o.total.siswa_aktif, 12);
});
await test('subtotal jenjang hanya untuk jenjang berisi >= 2 sekolah (SMK)', async () => {
  const o = await overview(STAFF_A);
  assert.deepEqual(o.per_jenjang.map((j) => j.jenjang), ['SMK']);
  assert.equal(o.per_jenjang[0].jumlah_sekolah, 2);
});
await test('cakupan di bawah 80% menyembunyikan persentase kehadiran', async () => {
  const o = await overview(STAFF_A);
  const smp = o.sekolah.find((s) => s.nama === 'SMP Satu');
  assert.equal(smp.cakupan_pct, 50);
  assert.equal(smp.kehadiran_pct, null);
  assert.equal(smp.status, 'DATA_BELUM_MEMADAI');
});
await test('kehadiran dihitung benar saat cakupan memadai', async () => {
  const o = await overview(STAFF_A);
  const sma = o.sekolah.find((s) => s.nama === 'SMA Satu');   // 30 baris, 3 ALPA -> 90%
  assert.equal(sma.cakupan_pct, 100);
  assert.equal(sma.kehadiran_pct, 90);
  assert.equal(sma.status, 'MEMADAI');
  const smk = o.sekolah.find((s) => s.nama === 'SMK Satu');   // 9 dari 10 sesi, semua hadir
  assert.equal(smk.cakupan_pct, 90);
  assert.equal(smk.kehadiran_pct, 100);
});
await test('keluaran tidak memuat nama, NIS, atau kolom siswa', async () => {
  const text = JSON.stringify(await overview(STAFF_A));
  assert.ok(!/RAHASIA|NIS-|student_id|full_name|nis\b/i.test(text));
});
await test('tren: sekolah di wilayahnya mengembalikan baris', async () => {
  const r = await as(STAFF_A, `SELECT * FROM public.fn_region_school_trend('${S1.sid}', 4)`);
  assert.ok(r.rows.length >= 1);
});
await test('tren: sekolah tanpa opt-in, wilayah lain, dan UUID acak mengembalikan hasil kosong yang sama', async () => {
  for (const id of [S4.sid, S5.sid, uuid(999999)]) {
    const r = await as(STAFF_A, `SELECT * FROM public.fn_region_school_trend('${id}', 4)`);
    assert.equal(r.rows.length, 0);
  }
});
await test('tren: akun sekolah ditolak 42501', async () => {
  assert.equal(await code(GURU_AUTH, `SELECT * FROM public.fn_region_school_trend('${S1.sid}', 4)`), '42501');
});
await test('identitas ganda ditolak: pengguna sekolah tidak bisa menjadi pegawai wilayah', async () => {
  assert.equal(await code(null, `INSERT INTO region_staff (auth_user_id, region_id, full_name) VALUES ('${GURU_AUTH}', '${REG_A}', 'X')`), '23514');
});
await test('identitas ganda ditolak: pegawai wilayah tidak bisa dibuat sebagai pengguna sekolah', async () => {
  const c = await code(null, `INSERT INTO users (auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
                              VALUES ('${STAFF_A}', 'X', 'dual@staff.internal', 'DUAL', 'NIP', 'GURU', '${S1.sid}')`);
  assert.equal(c, '23514');
});
await test('hak akses: anon tanpa EXECUTE, authenticated punya; tabel wilayah tertutup', async () => {
  const g = async (r, f) => (await db.query(`SELECT has_function_privilege('${r}', '${f}', 'EXECUTE') AS v`)).rows[0].v;
  assert.equal(await g('anon', 'public.fn_region_overview(integer)'), false);
  assert.equal(await g('authenticated', 'public.fn_region_overview(integer)'), true);
  assert.equal(await g('anon', 'public.fn_region_school_trend(uuid, integer)'), false);
  const t = async (r, tbl) => (await db.query(`SELECT has_table_privilege('${r}', '${tbl}', 'SELECT') AS v`)).rows[0].v;
  assert.equal(await t('authenticated', 'public.region_staff'), false);
  assert.equal(await t('anon', 'public.region_staff'), false);
  assert.equal(await t('authenticated', 'public.regions'), false);
});
await test('hak akses: pegawai wilayah tidak dapat memanggil helper visibilitas langsung', async () => {
  assert.equal(await codeAsRole(STAFF_A, `SELECT * FROM public.fn_region_sekolah_terlihat('${S1.sid}')`), '42501');
});

// ── Kendali persetujuan berbagi oleh kepala sekolah ───────────────────────────
const S7 = await sekolah({ key: 'smax', nama: 'SMA Belum Wilayah', jenjang: 'SMA', region: null, share: false, sesiTercatat: 0, alpa: 0 });
const KEPSEK = uuid(9101), ADMIN = uuid(9102), KEPSEK_X = uuid(9103);
const mkUser = (auth, ident, role, sid) => db.exec(`
  INSERT INTO users (auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
  VALUES ('${auth}', 'Pengguna ${ident}', '${ident}@staff.internal', '${ident}', 'NIP', '${role}', '${sid}');`);
await mkUser(KEPSEK, 'KS-1', 'KEPSEK', S1.sid);
await mkUser(ADMIN, 'AD-1', 'ADMINISTRATIVE', S1.sid);
await mkUser(KEPSEK_X, 'KS-X', 'KEPSEK', S7.sid);
const status = async (auth) => (await as(auth, 'SELECT public.fn_region_sharing_status() AS s')).rows[0].s;
const setShare = async (auth, v) => (await as(auth, `SELECT public.fn_set_region_sharing(${v}) AS s`)).rows[0].s;
const logCount = async () => (await db.query(`SELECT count(*)::int AS n FROM region_sharing_log WHERE school_id = '${S1.sid}'`)).rows[0].n;

await test('status: guru biasa ditolak 42501', async () => {
  assert.equal(await code(GURU_AUTH, 'SELECT public.fn_region_sharing_status()'), '42501');
});
await test('status: ADMINISTRATIVE boleh membaca tetapi tidak boleh mengubah', async () => {
  const st = await status(ADMIN);
  assert.equal(st.dibagikan, true);
  assert.equal(st.dapat_mengubah, false);
  assert.equal(st.wilayah, 'Kecamatan A');
});
await test('ubah: ADMINISTRATIVE dan guru ditolak 42501', async () => {
  assert.equal(await code(ADMIN, 'SELECT public.fn_set_region_sharing(false)'), '42501');
  assert.equal(await code(GURU_AUTH, 'SELECT public.fn_set_region_sharing(false)'), '42501');
  assert.equal(await logCount(), 0);
});
await test('ubah: KEPSEK mencabut persetujuan, sekolah langsung hilang dari dashboard wilayah', async () => {
  const st = await setShare(KEPSEK, false);
  assert.equal(st.dibagikan, false);
  assert.equal(st.dapat_mengubah, true);
  const o = await overview(STAFF_A);
  assert.ok(!o.sekolah.some((x) => x.nama === 'SMA Satu'));
  assert.equal(await logCount(), 1);
});
await test('ubah: KEPSEK mengaktifkan lagi, sekolah muncul kembali, dua catatan log', async () => {
  const st = await setShare(KEPSEK, true);
  assert.equal(st.dibagikan, true);
  const o = await overview(STAFF_A);
  assert.ok(o.sekolah.some((x) => x.nama === 'SMA Satu'));
  assert.equal(await logCount(), 2);
});
await test('ubah: nilai NULL ditolak (22023)', async () => {
  assert.equal(await code(KEPSEK, 'SELECT public.fn_set_region_sharing(NULL)'), '22023');
});
await test('ubah: KEPSEK sekolah yang belum terdaftar di wilayah ditolak 22023 dan statusnya jelas', async () => {
  assert.equal(await code(KEPSEK_X, 'SELECT public.fn_set_region_sharing(true)'), '22023');
  const st = await status(KEPSEK_X);
  assert.equal(st.terdaftar_di_wilayah, false);
  assert.equal(st.dapat_mengubah, false);
});
await test('ubah: KEPSEK hanya menyentuh sekolahnya sendiri', async () => {
  const smk = (await db.query(`SELECT share_with_region FROM schools WHERE school_id = '${S2.sid}'`)).rows[0].share_with_region;
  assert.equal(smk, true);
});
await test('hak akses: anon tanpa EXECUTE pada fungsi persetujuan; log tertutup', async () => {
  const g = async (r, f) => (await db.query(`SELECT has_function_privilege('${r}', '${f}', 'EXECUTE') AS v`)).rows[0].v;
  assert.equal(await g('anon', 'public.fn_region_sharing_status()'), false);
  assert.equal(await g('anon', 'public.fn_set_region_sharing(boolean)'), false);
  assert.equal(await g('authenticated', 'public.fn_set_region_sharing(boolean)'), true);
  const t = (await db.query(`SELECT has_table_privilege('authenticated', 'public.region_sharing_log', 'SELECT') AS v`)).rows[0].v;
  assert.equal(t, false);
});

// ── Tiga tingkat per sekolah: kecamatan, kabupaten, provinsi (migrasi 20261015010000) ─────────────────────────────────
const KAB = uuid(3), PROV = uuid(4);
await db.exec(`
  INSERT INTO regions (region_id, name, level) VALUES ('${KAB}', 'Kabupaten X', 'KABUPATEN'), ('${PROV}', 'Provinsi Y', 'PROVINSI');
  UPDATE schools SET kabupaten_id = '${KAB}', provinsi_id = '${PROV}', share_kabupaten = share_with_region, share_provinsi = share_with_region WHERE region_id = '${REG_A}';`);
const STAFF_KAB = uuid(9201), STAFF_PROV = uuid(9202);
await db.exec(`INSERT INTO region_staff (auth_user_id, region_id, full_name) VALUES
  ('${STAFF_KAB}', '${KAB}', 'Pegawai Kab'), ('${STAFF_PROV}', '${PROV}', 'Pegawai Prov');`);
const namaSekolah = async (auth) => (await overview(auth)).sekolah.map((s) => s.nama).sort();

await test('hierarki: pegawai kabupaten melihat sekolah kecamatan di bawahnya', async () => {
  assert.deepEqual(await namaSekolah(STAFF_KAB), ['SMA Satu', 'SMK Dua', 'SMK Satu', 'SMP Satu']);
});
await test('hierarki: pegawai provinsi melihat sekolah seluruh turunan', async () => {
  assert.deepEqual(await namaSekolah(STAFF_PROV), ['SMA Satu', 'SMK Dua', 'SMK Satu', 'SMP Satu']);
});
await test('hierarki: hanya ke bawah; kecamatan tidak melihat ke atas atau ke samping', async () => {
  assert.deepEqual(await namaSekolah(STAFF_A), ['SMA Satu', 'SMK Dua', 'SMK Satu', 'SMP Satu']);
  assert.deepEqual(await namaSekolah(STAFF_B), ['SMK B']);
});
await test('hierarki: sekolah di luar rantai tidak muncul pada kabupaten', async () => {
  assert.ok(!(await namaSekolah(STAFF_KAB)).includes('SMK B'));
});
await test('hierarki: tren sekolah turunan terbaca oleh kabupaten, tidak oleh wilayah lain', async () => {
  const ok = await as(STAFF_KAB, `SELECT * FROM public.fn_region_school_trend('${S1.sid}', 4)`);
  assert.ok(ok.rows.length >= 1);
  const no = await as(STAFF_B, `SELECT * FROM public.fn_region_school_trend('${S1.sid}', 4)`);
  assert.equal(no.rows.length, 0);
});
await test('persetujuan per tingkat: KEPSEK mencabut kabupaten; kabupaten kehilangan sekolah, kecamatan dan provinsi tetap', async () => {
  await as(KEPSEK, "SELECT public.fn_set_region_sharing_level('KABUPATEN', false)");
  assert.ok(!(await namaSekolah(STAFF_KAB)).includes('SMA Satu'));
  assert.ok((await namaSekolah(STAFF_A)).includes('SMA Satu'));
  assert.ok((await namaSekolah(STAFF_PROV)).includes('SMA Satu'));
  await as(KEPSEK, "SELECT public.fn_set_region_sharing_level('KABUPATEN', true)");
  assert.ok((await namaSekolah(STAFF_KAB)).includes('SMA Satu'));
});
await test('persetujuan per tingkat: provinsi dicabut, kabupaten tetap; log mencatat tingkat', async () => {
  await as(KEPSEK, "SELECT public.fn_set_region_sharing_level('PROVINSI', false)");
  assert.ok(!(await namaSekolah(STAFF_PROV)).includes('SMA Satu'));
  assert.ok((await namaSekolah(STAFF_KAB)).includes('SMA Satu'));
  const lv = (await db.query("SELECT level FROM region_sharing_log WHERE school_id = '" + S1.sid + "' ORDER BY changed_at DESC, log_id LIMIT 1")).rows[0].level;
  assert.equal(lv, 'PROVINSI');
  await as(KEPSEK, "SELECT public.fn_set_region_sharing_level('PROVINSI', true)");
});
await test('persetujuan per tingkat: ADMINISTRATIVE dan guru ditolak 42501; tingkat tidak sah 22023', async () => {
  assert.equal(await code(ADMIN, "SELECT public.fn_set_region_sharing_level('KABUPATEN', false)"), '42501');
  assert.equal(await code(GURU_AUTH, "SELECT public.fn_set_region_sharing_level('KABUPATEN', false)"), '42501');
  assert.equal(await code(KEPSEK, "SELECT public.fn_set_region_sharing_level('DESA', true)"), '22023');
});
await test('persetujuan per tingkat: tingkat yang belum dicatat untuk sekolah ditolak 22023', async () => {
  assert.equal(await code(KEPSEK_X, "SELECT public.fn_set_region_sharing_level('KABUPATEN', true)"), '22023');
});
await test('kode wilayah: unik, format angka 2-10 digit, boleh kosong', async () => {
  await db.exec("INSERT INTO regions (name, level, kode) VALUES ('Kecamatan Ujung Batu, Kabupaten Rokan Hulu', 'KECAMATAN', '1407022')");
  assert.equal(await code(null, "INSERT INTO regions (name, level, kode) VALUES ('Salinan', 'KECAMATAN', '1407022')"), '23505');
  assert.equal(await code(null, "INSERT INTO regions (name, level, kode) VALUES ('Kode Salah', 'KECAMATAN', 'AB12')"), '23514');
  assert.equal(await code(null, "INSERT INTO regions (name, level) VALUES ('Tanpa Kode 1', 'KECAMATAN')"), 'OK');
  assert.equal(await code(null, "INSERT INTO regions (name, level) VALUES ('Tanpa Kode 2', 'KECAMATAN')"), 'OK');
});
await test('tingkat: jenis wilayah di luar KECAMATAN/KABUPATEN/PROVINSI ditolak 23514', async () => {
  assert.equal(await code(null, `INSERT INTO regions (name, level) VALUES ('Desa X', 'DESA')`), '23514');
});
await test('tingkat: sekolah tanpa kecamatan tetapi berisian kabupaten terlihat pegawai kabupaten saja', async () => {
  await db.exec(`UPDATE schools SET kabupaten_id = '${KAB}', share_kabupaten = true WHERE school_id = '${S7.sid}'`);
  assert.ok((await namaSekolah(STAFF_KAB)).includes('SMA Belum Wilayah'));
  assert.ok(!(await namaSekolah(STAFF_A)).includes('SMA Belum Wilayah'));
  await db.exec(`UPDATE schools SET kabupaten_id = NULL, share_kabupaten = false WHERE school_id = '${S7.sid}'`);
});

// ── Agregat piket: keterlambatan dan izin keluar ──────────────────────────────
await db.exec(`SET session_replication_role = replica`);   // lewati pemicu notifikasi pada fixture
const sw = (await db.query(`SELECT student_id FROM students WHERE school_id = '${S1.sid}' ORDER BY nis`)).rows.map((r) => r.student_id);
for (let i = 0; i < 3; i++) {
  await db.exec(`INSERT INTO late_arrivals (school_id, student_id, recorded_by, late_date, arrival_time, reason)
                 VALUES ('${S1.sid}', '${sw[i % 3]}', '${S1.tch}', CURRENT_DATE, '07:30', 'RAHASIA alasan')`);
}
await db.exec(`INSERT INTO student_exits (school_id, student_id, exit_date, exit_time, reason, recorded_by)
               VALUES ('${S1.sid}', '${sw[0]}', CURRENT_DATE, '10:00', 'RAHASIA alasan', '${S1.tch}')`);
await db.exec(`SET session_replication_role = origin`);

await test('piket: 3 keterlambatan (1-4) disembunyikan; 0 tampil sebagai 0', async () => {
  const o = await overview(STAFF_A);
  assert.equal(o.ambang_piket, 5);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMA Satu').terlambat, null);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMK Satu').terlambat, 0);
});
await test('piket: 1 izin keluar disembunyikan', async () => {
  const o = await overview(STAFF_A);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMA Satu').izin_keluar, null);
});
await test('piket: mencapai 5 keterlambatan, angka tampil', async () => {
  await db.exec(`SET session_replication_role = replica`);
  for (let i = 0; i < 2; i++) {
    await db.exec(`INSERT INTO late_arrivals (school_id, student_id, recorded_by, late_date, arrival_time)
                   VALUES ('${S1.sid}', '${sw[i]}', '${S1.tch}', CURRENT_DATE, '07:40')`);
  }
  await db.exec(`SET session_replication_role = origin`);
  const o = await overview(STAFF_A);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMA Satu').terlambat, 5);
});
await test('piket: keluaran tidak memuat alasan atau identitas siswa', async () => {
  const text = JSON.stringify(await overview(STAFF_A));
  assert.ok(!/RAHASIA|student_id|alasan/i.test(text));
});

await test('pembersihan: kolom, pemicu, dan fungsi induk-anak sudah dibuang; fungsi agregat tetap jalan', async () => {
  const kol = (await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'regions' AND column_name = 'parent_region_id'")).rows[0].n;
  const fn = (await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('fn_region_scope_ids', 'fn_regions_no_cycle')")).rows[0].n;
  const trg = (await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_regions_no_cycle'")).rows[0].n;
  assert.equal(kol + fn + trg, 0);
  const o = await overview(STAFF_A);
  assert.ok(Array.isArray(o.sekolah) && o.sekolah.length >= 1);
});

await test('wajib ganti kata sandi: penanda pada token menolak data; setelah dihapus data kembali', async () => {
  const klaim = async (v) => db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [v]);
  try {
    await klaim(JSON.stringify({ user_metadata: { must_change_password: true } }));
    assert.equal(await code(STAFF_A, 'SELECT public.fn_region_overview(30)'), '42501');
    assert.equal(await code(STAFF_A, `SELECT * FROM public.fn_region_school_trend('${S1.sid}', 4)`), '42501');
    await klaim(JSON.stringify({ user_metadata: { must_change_password: 'true' } }));
    assert.equal(await code(STAFF_A, 'SELECT public.fn_region_overview(30)'), '42501');
    await klaim(JSON.stringify({ user_metadata: { must_change_password: false } }));
    assert.equal(await code(STAFF_A, 'SELECT public.fn_region_overview(30)'), 'OK');
    await klaim('');
    assert.equal(await code(STAFF_A, 'SELECT public.fn_region_overview(30)'), 'OK');
  } finally { await klaim(''); }
});

// Orang tua aktif = users ber-role ORTU, is_active, deleted_at IS NULL, di sekolah yang tampil.
async function tambahOrtu(sid, key, n, { aktif = true, hapus = false } = {}) {
  for (let i = 1; i <= n; i++) {
    await db.exec(`
      INSERT INTO users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id, is_active, deleted_at)
      VALUES ('${uuid(seq++)}', '${uuid(seq++)}', 'RAHASIA Ortu ${key} ${aktif}${hapus} ${i}', 'ortu-${key}-${aktif}-${hapus}-${i}@ortu.internal',
              'O-${key}-${aktif}-${hapus}-${i}', 'NIK', 'ORTU', '${sid}', ${aktif}, ${hapus ? 'now()' : 'NULL'});`);
  }
}
await tambahOrtu(S1.sid, 'sma1', 2);
await tambahOrtu(S1.sid, 'sma1', 1, { aktif: false });
await tambahOrtu(S1.sid, 'sma1', 1, { hapus: true });
await tambahOrtu(S2.sid, 'smk1', 1);
await tambahOrtu(S4.sid, 'smp2', 3);
await tambahOrtu(S5.sid, 'smkb', 4);

await test('orang tua aktif: hanya ORTU aktif dan belum dihapus yang dihitung per sekolah', async () => {
  const o = await overview(STAFF_A);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMA Satu').orang_tua_aktif, 2);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMK Satu').orang_tua_aktif, 1);
  assert.equal(o.sekolah.find((s) => s.nama === 'SMP Satu').orang_tua_aktif, 0);
});
await test('orang tua aktif: guru dan staf tidak ikut dihitung; sekolah tak dibagikan dan wilayah lain tidak bocor', async () => {
  const o = await overview(STAFF_A);
  assert.ok(!o.sekolah.some((s) => s.nama === 'SMP Tutup'));
  const jumlah = o.sekolah.reduce((a, s) => a + s.orang_tua_aktif, 0);
  assert.equal(o.total.orang_tua_aktif, jumlah);
  assert.equal(jumlah, 2 + 1 + 0 + 0);
  const b = await overview(STAFF_B);
  assert.equal(b.sekolah.find((s) => s.nama === 'SMK B').orang_tua_aktif, 4);
});
await test('orang tua aktif: total mengikuti ambang 3 sekolah; keluaran hanya hitungan, tanpa nama', async () => {
  const b = await overview(STAFF_B);
  assert.equal(b.total, null);
  const text = JSON.stringify(await overview(STAFF_A));
  assert.ok(!/RAHASIA|ortu\.internal|O-sma1/i.test(text));
});

// ── Rentang waktu bebas ─────────────────────────────────────────────
const rentang = async (authId, dari, sampai) =>
  (await as(authId, `SELECT public.fn_region_overview_range(${dari}, ${sampai}) AS o`)).rows[0].o;

await test('rentang: 30 hari terakhir identik dengan fn_region_overview(30)', async () => {
  const a = await overview(STAFF_A, 30);
  const b = await rentang(STAFF_A, 'public.fn_hari_ini() - 29', 'public.fn_hari_ini()');
  assert.deepEqual(b.total, a.total);
  assert.deepEqual(b.sekolah, a.sekolah);
  assert.deepEqual(b.per_jenjang, a.per_jenjang);
  assert.equal(b.jendela_hari, 30);
});
await test('rentang: hanya hari ini membatasi sesi (1 sesi per sekolah pada fixture)', async () => {
  const o = await rentang(STAFF_A, 'public.fn_hari_ini()', 'public.fn_hari_ini()');
  assert.equal(o.jendela_hari, 1);
  assert.equal(o.dari, o.sampai);
  assert.ok(o.sekolah.find((s) => s.nama === 'SMA Satu').sesi_terjadwal <= 1);
});
await test('rentang: sepenuhnya di masa lalu tanpa sesi tidak menghasilkan sesi', async () => {
  const o = await rentang(STAFF_A, 'public.fn_hari_ini() - 200', 'public.fn_hari_ini() - 100');
  assert.ok(o.sekolah.every((s) => s.sesi_terjadwal === 0 && s.status === 'TIDAK_ADA_JADWAL'));
});
await test('rentang: tanggal akhir di masa depan dipotong ke hari ini', async () => {
  const o = await rentang(STAFF_A, 'public.fn_hari_ini() - 5', 'public.fn_hari_ini() + 30');
  assert.equal(o.jendela_hari, 6);
});
await test('rentang: awal setelah akhir dan lebih dari 366 hari ditolak 22023', async () => {
  assert.equal(await code(STAFF_A, `SELECT public.fn_region_overview_range(public.fn_hari_ini(), public.fn_hari_ini() - 3)`), '22023');
  assert.equal(await code(STAFF_A, `SELECT public.fn_region_overview_range(public.fn_hari_ini() - 400, public.fn_hari_ini())`), '22023');
  assert.equal(await code(STAFF_A, `SELECT public.fn_region_overview_range(public.fn_hari_ini() - 365, public.fn_hari_ini())`), 'OK');
});
await test('rentang: aturan privasi sama (akun sekolah ditolak, total null di bawah 3 sekolah, tanpa nama)', async () => {
  assert.equal(await code(GURU_AUTH, `SELECT public.fn_region_overview_range(NULL, NULL)`), '42501');
  assert.equal(await code(null, `SELECT public.fn_region_overview_range(NULL, NULL)`), '42501');
  const b = await rentang(STAFF_B, 'public.fn_hari_ini() - 29', 'public.fn_hari_ini()');
  assert.equal(b.total, null);
  assert.ok(!/RAHASIA|ortu.internal/i.test(JSON.stringify(await rentang(STAFF_A, 'NULL', 'NULL'))));
});
await test('tren rentang: mingguan dan bulanan mengembalikan baris; sekolah tak berhak kosong; akun sekolah ditolak', async () => {
  const q = (id, g) => `SELECT * FROM public.fn_region_school_trend_range('${id}', public.fn_hari_ini() - 60, public.fn_hari_ini(), '${g}')`;
  const mg = await as(STAFF_A, q(S1.sid, 'MINGGU'));
  const bl = await as(STAFF_A, q(S1.sid, 'BULAN'));
  assert.ok(mg.rows.length >= 1);
  assert.ok(bl.rows.length >= 1 && bl.rows.length <= 2);
  const tot = (r) => r.rows.reduce((a, x) => a + x.sesi_terjadwal, 0);
  assert.equal(tot(mg), tot(bl));
  for (const id of [S4.sid, S5.sid, uuid(999999)]) assert.equal((await as(STAFF_A, q(id, 'MINGGU'))).rows.length, 0);
  assert.equal(await code(GURU_AUTH, q(S1.sid, 'MINGGU')), '42501');
  assert.equal(await code(STAFF_A, `SELECT * FROM public.fn_region_school_trend_range('${S1.sid}', public.fn_hari_ini(), public.fn_hari_ini() - 1, 'MINGGU')`), '22023');
});
await test('rentang: anon tidak punya hak eksekusi', async () => {
  const g = async (r, f) => (await db.query(`SELECT has_function_privilege('${r}', '${f}', 'EXECUTE') AS v`)).rows[0].v;
  assert.equal(await g('anon', 'public.fn_region_overview_range(date, date, uuid, boolean)'), false);
  assert.equal(await g('anon', 'public.fn_region_school_trend_range(uuid, date, date, text)'), false);
});

// ── Daftar datar untuk semua tingkat pegawai wilayah ────────────────
const NOL = '00000000-0000-0000-0000-000000000000';
const grup = async (authId, kel = null, penuh = false) =>
  (await as(authId,
    `SELECT public.fn_region_overview_range(public.fn_hari_ini() - 29, public.fn_hari_ini(), $1::uuid, $2::boolean) AS o`,
    [kel, penuh])).rows[0].o;

await test('daftar datar: kecamatan, kabupaten, dan provinsi tanpa pengelompokan', async () => {
  for (const auth of [STAFF_A, STAFF_KAB, STAFF_PROV]) {
    const o = await grup(auth);
    assert.equal(o.mode_kelompok, null);
    assert.equal(o.kelompok_nama, null);
    assert.deepEqual(o.kelompok, []);
    assert.equal(o.maks_hari, 366);
    assert.ok(o.sekolah.length > 0);
    assert.deepEqual(o.sekolah.map((s) => s.nama), [...o.sekolah].map((s) => s.nama).sort());
  }
});
await test('daftar datar: p_kelompok dan p_daftar_penuh diabaikan serta hasil tetap sama', async () => {
  const dasar = await grup(STAFF_KAB);
  assert.deepEqual(await grup(STAFF_KAB, REG_B), dasar);
  assert.deepEqual(await grup(STAFF_KAB, NOL), dasar);
  assert.deepEqual(await grup(STAFF_KAB, REG_A, true), dasar);
  assert.deepEqual(await grup(STAFF_KAB, null, true), dasar);
});
await test('daftar datar: pegawai kabupaten dan provinsi tidak menerima nama atau id wilayah lain', async () => {
  for (const [auth, own, others] of [
    [STAFF_KAB, 'Kabupaten X', ['Kecamatan A', 'Kecamatan B', 'Provinsi Y']],
    [STAFF_PROV, 'Provinsi Y', ['Kecamatan A', 'Kecamatan B', 'Kabupaten X']],
  ]) {
    const teks = JSON.stringify(await overview(auth)) + JSON.stringify(await grup(auth));
    assert.ok(teks.includes(own));
    for (const name of others) assert.ok(!teks.includes(name));
    for (const key of ['region_id', 'kabupaten_id', 'provinsi_id']) assert.ok(!teks.includes(`"${key}"`));
    assert.ok(!teks.includes('Tanpa '));
  }
});
await test('daftar datar: tidak ada nama atau kolom siswa pada keluaran pegawai kabupaten/provinsi', async () => {
  const teks = JSON.stringify([await grup(STAFF_KAB), await grup(STAFF_PROV)]);
  assert.ok(!/RAHASIA|NIS-|student_id|full_name/i.test(teks));
});
await test('daftar datar: fungsi lama fn_region_overview tetap memberi daftar sekolah untuk kabupaten', async () => {
  const o = await overview(STAFF_KAB);
  assert.equal(o.mode_kelompok, null);
  assert.deepEqual(o.kelompok, []);
  assert.ok(o.sekolah.length > 0);
});

await test('waktu: fn_hari_ini mengikuti Asia/Jakarta dan jendela 30 hari memuat tepat 30 hari', async () => {
  const w = (await db.query("SELECT public.fn_hari_ini() AS h, (now() AT TIME ZONE 'Asia/Jakarta')::date AS j")).rows[0];
  assert.equal(String(w.h), String(w.j));
  const o = (await as(STAFF_A, "SELECT public.fn_region_overview(30) AS o")).rows[0].o;
  assert.equal(o.jendela_hari, 30);
  assert.equal(String(o.sampai).slice(0, 10), new Date(w.j).toISOString().slice(0, 10));
});

console.log(`REGION_LAYER_COMPLETE: ${passed} lulus; PGlite saja`);
