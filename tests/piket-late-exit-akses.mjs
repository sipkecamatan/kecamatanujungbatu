// Uji RLS late_arrivals dan student_exits untuk tiga perubahan 24 Okt:
//   1. Guru yang mengajar hari ini bisa baca hari ini saja  (20261023204657)
//   2. Guru piket: riwayat yang ia sendiri catat            (20261023210410)
//   3. Wali kelas: riwayat penuh kelas waliannya            (20261023210410)
//   4. Kepala sekolah TIDAK bisa baca baris                 (20261023210410)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

const SCHOOL      = uuid(1);
const OTHER       = uuid(2);
const CLASS_A     = uuid(3);   // kelas wali
const CLASS_B     = uuid(4);   // kelas lain di sekolah yang sama

const PIKET       = uuid(10);  // guru piket (piket hari ini)
const WALI        = uuid(11);  // wali kelas A
const GURU_AJAR   = uuid(12);  // guru yang mengajar kelas A hari ini
const KEPSEK      = uuid(13);
const GURU_LAIN   = uuid(14);  // guru biasa, tidak piket, tidak mengajar hari ini
const SISWA_USER  = uuid(15);
const ORTU_USER   = uuid(16);

const STUDENT_A   = uuid(20);  // siswa kelas A
const STUDENT_B   = uuid(21);  // siswa kelas B (beda kelas)
const SCHED_TODAY = uuid(30);  // jadwal guru_ajar di kelas A hari ini

const LATE_TODAY_A   = uuid(40);  // keterlambatan STUDENT_A hari ini, dicatat PIKET
const LATE_LAMA_A    = uuid(41);  // keterlambatan STUDENT_A kemarin, dicatat PIKET
const LATE_TODAY_B   = uuid(42);  // keterlambatan STUDENT_B hari ini, dicatat PIKET
const EXIT_TODAY_A   = uuid(50);  // izin keluar STUDENT_A hari ini, dicatat PIKET
const EXIT_LAMA_A    = uuid(51);  // izin keluar STUDENT_A kemarin, dicatat PIKET

const db = new PGlite();
let passed = 0;
async function test(name, fn) {
    await fn();
    console.log(`PASS ${++passed}: ${name}`);
}
async function asUser(uid) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
    await db.exec('SET ROLE authenticated');
}
async function countLate()  { return (await db.query('SELECT count(*)::int c FROM late_arrivals')).rows[0].c; }
async function countExit()  { return (await db.query('SELECT count(*)::int c FROM student_exits')).rows[0].c; }

const tmp = new PGlite();
const dateRows = (await tmp.query(`
    SELECT
        (now() AT TIME ZONE 'Asia/Jakarta')::date::text                           AS today,
        ((now() AT TIME ZONE 'Asia/Jakarta')::date - 1)::text                     AS yesterday,
        CASE EXTRACT(ISODOW FROM now() AT TIME ZONE 'Asia/Jakarta')::int
            WHEN 1 THEN 'SENIN' WHEN 2 THEN 'SELASA' WHEN 3 THEN 'RABU'
            WHEN 4 THEN 'KAMIS' WHEN 5 THEN 'JUMAT' WHEN 6 THEN 'SABTU'
        END AS dow
`)).rows[0];
await tmp.close();
const TODAY        = dateRows.today;
const YESTERDAY_STR = dateRows.yesterday;
const DAY_OF_WEEK  = dateRows.dow;

// ── setup skema ───────────────────────────────────────────────────────────────
await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

    CREATE TYPE role_type AS ENUM (
        'GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
        'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS',
        'SISWA','ORTU','DUDI','STAKEHOLDER','TU','ADMINISTRATIVE');
    CREATE TYPE day_of_week AS ENUM ('SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU');

    CREATE TABLE users (
        user_id uuid PRIMARY KEY, auth_user_id uuid, school_id uuid,
        role_type role_type, is_active boolean DEFAULT true,
        wali_kelas_class_id uuid, is_kepsek boolean DEFAULT false,
        is_waka_kesiswaan boolean DEFAULT false, deleted_at timestamptz
    );
    CREATE TABLE school_config (school_id uuid PRIMARY KEY, current_academic_year text, current_semester text);
    CREATE TABLE duty_schedules (
        duty_id uuid PRIMARY KEY, school_id uuid, user_id uuid,
        day_of_week day_of_week, academic_year text, semester int, is_active boolean DEFAULT true
    );
    CREATE TABLE students (student_id uuid PRIMARY KEY, school_id uuid, user_id uuid);
    CREATE TABLE class_enrollments (
        enrollment_id uuid PRIMARY KEY, school_id uuid, student_id uuid, class_id uuid,
        academic_year text, semester text, withdrawn_at timestamptz
    );
    CREATE TABLE student_parents (id uuid PRIMARY KEY, student_id uuid, parent_user_id uuid, school_id uuid);
    CREATE TABLE teaching_schedules (
        schedule_id uuid PRIMARY KEY, school_id uuid, class_id uuid,
        scheduled_teacher_id uuid, session_date date
    );
    CREATE TABLE late_arrivals (
        late_id uuid PRIMARY KEY, school_id uuid, student_id uuid,
        recorded_by uuid, late_date date, arrival_time time, reason text
    );
    CREATE TABLE student_exits (
        exit_id uuid PRIMARY KEY, school_id uuid, student_id uuid,
        recorded_by uuid, exit_date date, exit_time time, reason text
    );

    ALTER TABLE late_arrivals  ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_exits  ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT INSERT ON late_arrivals, student_exits TO authenticated;

    -- helpers
    CREATE FUNCTION fn_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT user_id FROM users WHERE auth_user_id = auth.uid() AND is_active AND deleted_at IS NULL LIMIT 1;
    $$;
    CREATE FUNCTION fn_current_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT school_id FROM users WHERE auth_user_id = auth.uid() AND is_active AND deleted_at IS NULL LIMIT 1;
    $$;
    CREATE FUNCTION fn_current_user_role() RETURNS role_type LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT role_type FROM users WHERE auth_user_id = auth.uid() AND is_active AND deleted_at IS NULL LIMIT 1;
    $$;
    CREATE FUNCTION fn_is_kepsek() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT COALESCE((SELECT is_kepsek OR role_type='KEPSEK' FROM users
            WHERE auth_user_id=auth.uid() AND is_active AND deleted_at IS NULL LIMIT 1), false);
    $$;
    CREATE FUNCTION fn_is_waka_kesiswaan() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT COALESCE((SELECT is_waka_kesiswaan OR role_type='WAKA_KESISWAAN' FROM users
            WHERE auth_user_id=auth.uid() AND is_active AND deleted_at IS NULL LIMIT 1), false);
    $$;
    CREATE FUNCTION fn_is_on_duty_today() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT EXISTS (
            SELECT 1 FROM duty_schedules ds
            JOIN school_config sc ON sc.school_id = fn_current_school_id()
            WHERE ds.user_id       = fn_current_user_id()
              AND ds.school_id     = fn_current_school_id()
              AND ds.day_of_week::text = CASE EXTRACT(ISODOW FROM now() AT TIME ZONE 'Asia/Jakarta')::int
                  WHEN 1 THEN 'SENIN' WHEN 2 THEN 'SELASA' WHEN 3 THEN 'RABU'
                  WHEN 4 THEN 'KAMIS' WHEN 5 THEN 'JUMAT' WHEN 6 THEN 'SABTU' ELSE NULL END
              AND ds.academic_year = sc.current_academic_year
              AND ds.semester      = sc.current_semester::int
              AND ds.is_active
        );
    $$;
    GRANT EXECUTE ON FUNCTION fn_current_user_id(),fn_current_school_id(),
        fn_current_user_role(),fn_is_kepsek(),fn_is_waka_kesiswaan(),fn_is_on_duty_today()
        TO authenticated;
`);

// ── data uji ─────────────────────────────────────────────────────────────────
await db.exec(`
    INSERT INTO users VALUES
        ('${PIKET}',    '${PIKET}',    '${SCHOOL}', 'GURU',       true, NULL,         false, false, NULL),
        ('${WALI}',     '${WALI}',     '${SCHOOL}', 'WALI_KELAS', true, '${CLASS_A}', false, false, NULL),
        ('${GURU_AJAR}','${GURU_AJAR}','${SCHOOL}', 'GURU',       true, NULL,         false, false, NULL),
        ('${KEPSEK}',   '${KEPSEK}',   '${SCHOOL}', 'KEPSEK',     true, NULL,         true,  false, NULL),
        ('${GURU_LAIN}','${GURU_LAIN}','${SCHOOL}', 'GURU',       true, NULL,         false, false, NULL),
        ('${SISWA_USER}','${SISWA_USER}','${SCHOOL}','SISWA',      true, NULL,         false, false, NULL),
        ('${ORTU_USER}','${ORTU_USER}','${SCHOOL}', 'ORTU',       true, NULL,         false, false, NULL);
    INSERT INTO school_config VALUES ('${SCHOOL}','2026/2027','1');
    INSERT INTO duty_schedules VALUES
        (gen_random_uuid(),'${SCHOOL}','${PIKET}','${DAY_OF_WEEK}','2026/2027',1,true);
    INSERT INTO students VALUES
        ('${STUDENT_A}','${SCHOOL}','${SISWA_USER}'),
        ('${STUDENT_B}','${SCHOOL}',gen_random_uuid());
    INSERT INTO class_enrollments VALUES
        (gen_random_uuid(),'${SCHOOL}','${STUDENT_A}','${CLASS_A}','2026/2027','1',NULL),
        (gen_random_uuid(),'${SCHOOL}','${STUDENT_B}','${CLASS_B}','2026/2027','1',NULL);
    INSERT INTO student_parents VALUES
        (gen_random_uuid(),'${STUDENT_A}','${ORTU_USER}','${SCHOOL}');
    INSERT INTO teaching_schedules VALUES
        ('${SCHED_TODAY}','${SCHOOL}','${CLASS_A}','${GURU_AJAR}','${TODAY}');
    INSERT INTO late_arrivals VALUES
        ('${LATE_TODAY_A}','${SCHOOL}','${STUDENT_A}','${PIKET}','${TODAY}','07:30',NULL),
        ('${LATE_LAMA_A}', '${SCHOOL}','${STUDENT_A}','${PIKET}','${YESTERDAY_STR}','07:45',NULL),
        ('${LATE_TODAY_B}','${SCHOOL}','${STUDENT_B}','${PIKET}','${TODAY}','08:00',NULL);
    INSERT INTO student_exits VALUES
        ('${EXIT_TODAY_A}','${SCHOOL}','${STUDENT_A}','${PIKET}','${TODAY}','10:00',NULL),
        ('${EXIT_LAMA_A}', '${SCHOOL}','${STUDENT_A}','${PIKET}','${YESTERDAY_STR}','11:00',NULL);
`);

// ── terapkan policy yang kita uji ────────────────────────────────────────────
await db.exec(`
    ${read('supabase/migrations/20261023204657_piket_guru_mengajar_baca_late_exit.sql')}
    ${read('supabase/migrations/20261023210410_piket_wali_kepsek_akses_late_exit.sql')}

    -- Policy SISWA: lihat keterlambatan/izin keluar diri sendiri
    CREATE POLICY "rls_late_arrivals_read_siswa" ON public.late_arrivals
        AS PERMISSIVE FOR SELECT TO PUBLIC
        USING (
            school_id = fn_current_school_id()
            AND fn_current_user_role() = 'SISWA'::role_type
            AND student_id = (SELECT student_id FROM students
                WHERE user_id = fn_current_user_id() AND school_id = fn_current_school_id() LIMIT 1)
        );
    CREATE POLICY "rls_exits_read_siswa" ON public.student_exits
        AS PERMISSIVE FOR SELECT TO PUBLIC
        USING (
            school_id = fn_current_school_id()
            AND fn_current_user_role() = 'SISWA'::role_type
            AND student_id = (SELECT student_id FROM students
                WHERE user_id = fn_current_user_id() AND school_id = fn_current_school_id() LIMIT 1)
        );

    -- Policy ORTU: lihat keterlambatan/izin keluar anak yang terhubung
    CREATE POLICY "rls_late_arrivals_read_ortu" ON public.late_arrivals
        AS PERMISSIVE FOR SELECT TO PUBLIC
        USING (
            school_id = fn_current_school_id()
            AND fn_current_user_role() = 'ORTU'::role_type
            AND EXISTS (SELECT 1 FROM student_parents sp
                WHERE sp.student_id = late_arrivals.student_id
                  AND sp.parent_user_id = fn_current_user_id()
                  AND sp.school_id = fn_current_school_id())
        );
    CREATE POLICY "rls_exits_read_ortu" ON public.student_exits
        AS PERMISSIVE FOR SELECT TO PUBLIC
        USING (
            school_id = fn_current_school_id()
            AND fn_current_user_role() = 'ORTU'::role_type
            AND EXISTS (SELECT 1 FROM student_parents sp
                WHERE sp.student_id = student_exits.student_id
                  AND sp.parent_user_id = fn_current_user_id()
                  AND sp.school_id = fn_current_school_id())
        );
`);

// ── uji ───────────────────────────────────────────────────────────────────────

// GURU PIKET
await test('piket: lihat data hari ini (termasuk kelas lain)', async () => {
    await asUser(PIKET);
    // fn_is_on_duty_today() = true → policy lama memberi akses hari ini
    const n = await countLate();
    assert(n >= 2, `Harap >= 2, dapat ${n}`);
});

await test('piket: lihat data lama yang ia sendiri catat (recorded_by)', async () => {
    await asUser(PIKET);
    const rows = (await db.query(
        `SELECT * FROM late_arrivals WHERE late_date = '${YESTERDAY_STR}'`
    )).rows;
    assert.equal(rows.length, 1, 'Harus bisa lihat keterlambatan kemarin miliknya sendiri');
});

await test('piket: lihat izin keluar lama yang ia sendiri catat', async () => {
    await asUser(PIKET);
    const rows = (await db.query(
        `SELECT * FROM student_exits WHERE exit_date = '${YESTERDAY_STR}'`
    )).rows;
    assert.equal(rows.length, 1, 'Harus bisa lihat izin keluar kemarin miliknya sendiri');
});

// GURU YANG MENGAJAR
await test('guru mengajar: lihat keterlambatan kelas sendiri hari ini', async () => {
    await asUser(GURU_AJAR);
    const rows = (await db.query(
        `SELECT * FROM late_arrivals WHERE late_date = '${TODAY}'`
    )).rows;
    // STUDENT_A di CLASS_A yang diajar GURU_AJAR hari ini → terlihat
    assert(rows.some(r => r.student_id === STUDENT_A), 'STUDENT_A harus terlihat');
    // STUDENT_B di CLASS_B (bukan kelasnya) → tidak terlihat
    assert(!rows.some(r => r.student_id === STUDENT_B), 'STUDENT_B tidak boleh terlihat');
});

await test('guru mengajar: TIDAK bisa lihat data kemarin', async () => {
    await asUser(GURU_AJAR);
    const rows = (await db.query(
        `SELECT * FROM late_arrivals WHERE late_date = '${YESTERDAY_STR}'`
    )).rows;
    assert.equal(rows.length, 0, 'Guru mengajar tidak boleh lihat data kemarin');
});

await test('guru mengajar: lihat izin keluar kelas sendiri hari ini', async () => {
    await asUser(GURU_AJAR);
    const rows = (await db.query(
        `SELECT * FROM student_exits WHERE exit_date = '${TODAY}'`
    )).rows;
    assert(rows.some(r => r.student_id === STUDENT_A), 'STUDENT_A harus terlihat di izin keluar');
});

// GURU BIASA (tidak piket, tidak mengajar hari ini)
await test('guru biasa: tidak bisa lihat data sama sekali', async () => {
    await asUser(GURU_LAIN);
    assert.equal(await countLate(), 0, 'Guru biasa tidak boleh lihat late_arrivals');
    assert.equal(await countExit(), 0, 'Guru biasa tidak boleh lihat student_exits');
});

// WALI KELAS
await test('wali kelas: lihat riwayat penuh siswa kelasnya (hari ini dan lama)', async () => {
    await asUser(WALI);
    const late = (await db.query('SELECT * FROM late_arrivals')).rows;
    // STUDENT_A di CLASS_A (kelas wali) → semua tanggal terlihat
    const aRows = late.filter(r => r.student_id === STUDENT_A);
    assert.equal(aRows.length, 2, 'Wali harus lihat 2 keterlambatan STUDENT_A (hari ini + kemarin)');
    // STUDENT_B di CLASS_B (bukan kelasnya) → tidak terlihat
    assert(!late.some(r => r.student_id === STUDENT_B), 'STUDENT_B tidak boleh terlihat oleh wali');
});

await test('wali kelas: lihat riwayat izin keluar siswa kelasnya', async () => {
    await asUser(WALI);
    const exits = (await db.query('SELECT * FROM student_exits')).rows;
    assert.equal(exits.filter(r => r.student_id === STUDENT_A).length, 2,
        'Wali harus lihat 2 izin keluar STUDENT_A');
    assert(!exits.some(r => r.student_id === STUDENT_B), 'STUDENT_B tidak boleh terlihat');
});

// KEPALA SEKOLAH
await test('kepala sekolah: TIDAK bisa baca baris late_arrivals', async () => {
    await asUser(KEPSEK);
    assert.equal(await countLate(), 0, 'Kepsek tidak boleh baca baris keterlambatan');
});

await test('kepala sekolah: TIDAK bisa baca baris student_exits', async () => {
    await asUser(KEPSEK);
    assert.equal(await countExit(), 0, 'Kepsek tidak boleh baca baris izin keluar');
});

// SISWA
await test('siswa: hanya lihat keterlambatan dirinya sendiri', async () => {
    await asUser(SISWA_USER);
    const rows = (await db.query('SELECT * FROM late_arrivals')).rows;
    assert(rows.every(r => r.student_id === STUDENT_A), 'Siswa hanya boleh lihat data dirinya');
    assert.equal(rows.length, 2);
});

// ORTU
await test('ortu: hanya lihat keterlambatan anak yang terhubung', async () => {
    await asUser(ORTU_USER);
    const rows = (await db.query('SELECT * FROM late_arrivals')).rows;
    assert(rows.every(r => r.student_id === STUDENT_A), 'Ortu hanya boleh lihat anak sendiri');
});

await db.close();
console.log(`\nPIKET_LATE_EXIT_AKSES: ${passed} uji lulus.`);
