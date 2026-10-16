// Uji skala dan isolasi wilayah di PGlite lokal.
// Hanya mengukur dan melaporkan; tidak mengubah migrasi, fungsi, atau tampilan.
// SIP_ROOT=<worktree> node tests/scale-visibility.mjs
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
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

const SCHOOL_TOTAL = 1376;
const DEFAULT_SISWA = positiveInt(process.env.SISWA, 12);
const HARI = positiveInt(process.env.HARI, 20);
const SESI_PER_HARI = positiveInt(process.env.SESI_PER_HARI, 3);
const REPEATS = 3;
// Guard konservatif: percobaan 990.720 baris pada komputer ini mencapai OOM
// setelah beberapa PGlite stage. Naikkan eksplisit bila mesin mampu menanggungnya.
const MAX_ATTENDANCE_ROWS = positiveInt(process.env.MAX_ATTENDANCE_ROWS, 900_000);
const SCALE_STAGES = parseStages(process.env.SCALE_STAGES || '172,344,688,1376');
const LOAD_STAGES = parseStages(process.env.LOAD_STAGES || `${DEFAULT_SISWA},24,48`);
const KABUPATEN = [
  ['Kuantan Singingi', 15], ['Indragiri Hulu', 14], ['Indragiri Hilir', 20],
  ['Pelalawan', 12], ['Siak', 14], ['Kampar', 21], ['Rokan Hulu', 16],
  ['Bengkalis', 11], ['Rokan Hilir', 18], ['Kepulauan Meranti', 9],
  ['Pekanbaru', 15], ['Dumai', 7],
];
const KEC_TOTAL = KABUPATEN.reduce((a, [, n]) => a + n, 0);
const KAMpar_NO = 6;
const KEC_TEST_NO = 1;
const failures = [];
const skipped = [];
const scaleRows = [];
const loadRows = [];
const outputRows = [];
let fullStage = null;
let largestStage = null;
let startedAt = performance.now();

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseStages(text) {
  return [...new Set(String(text).split(',').map((x) => Number(x.trim())))]
    .filter((n) => Number.isInteger(n) && n > 0 && n <= SCHOOL_TOTAL);
}

function uuidKey(key) {
  // Hanya untuk parameter/metadata JS; UUID SQL memakai md5(key)::uuid yang sama.
  const h = requireUnavailableMd5(key);
  return h;
}

function requireUnavailableMd5() {
  // Tidak dipakai untuk pencocokan; ID dibaca lagi dari katalog setelah INSERT.
  return null;
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlKabupatenValues(alias = 'k') {
  return KABUPATEN.map(([name, n], i) => `(${i + 1}, ${quoteSql(name)}, ${n})`).join(',\n');
}

function estimatedAttendanceRows(schoolCount, siswa) {
  return schoolCount * siswa * HARI * SESI_PER_HARI;
}

async function setupDb() {
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
  for (let i = 0; i < migrations.length; i += 1) {
    await db.exec(migrations[i]);
    if (i === 6) {
      // Migration must_change_password perlu auth.jwt() yang membaca klaim token.
      await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);
    }
  }
  return db;
}

async function seedDb(db, schoolCount, siswa) {
  const kabs = sqlKabupatenValues();
  await db.exec(`
    INSERT INTO public.regions (region_id, name, level, kode)
    VALUES (md5('region-provinsi-riau')::uuid, 'Provinsi Riau', 'PROVINSI', '14');
    INSERT INTO public.regions (region_id, name, level, kode)
    SELECT md5('region-kab-' || kab_no)::uuid,
           'Kabupaten/Kota ' || kab_name, 'KABUPATEN', '14' || lpad(kab_no::text, 2, '0')
    FROM (VALUES ${kabs}) AS k(kab_no, kab_name, n_kec);
    INSERT INTO public.regions (region_id, name, level, kode)
    SELECT md5('region-kec-' || row_number() OVER (ORDER BY kab_no, kec_no))::uuid,
           'Kecamatan ' || kab_name || ' ' || lpad(kec_no::text, 2, '0'),
           'KECAMATAN', '14' || lpad(kab_no::text, 2, '0') || lpad(kec_no::text, 3, '0')
    FROM (VALUES ${kabs}) AS k(kab_no, kab_name, n_kec)
    CROSS JOIN LATERAL generate_series(1, k.n_kec) AS g(kec_no);

    WITH all_regions AS (
      SELECT region_id FROM public.regions
    )
    INSERT INTO auth.users (id, email)
    SELECT md5('region-staff-' || region_id::text)::uuid,
           'region-' || region_id::text || '@staff.internal'
    FROM all_regions;
    INSERT INTO public.region_staff (auth_user_id, region_id, full_name)
    SELECT md5('region-staff-' || region_id::text)::uuid, region_id, name
    FROM public.regions;
  `);

  await db.exec(`
    WITH k AS (
      SELECT row_number() OVER (ORDER BY kab_no, kec_no)::int AS kec_ord,
             kab_no, kab_name, kec_no,
             md5('region-kab-' || kab_no)::uuid AS kab_id,
             md5('region-kec-' || row_number() OVER (ORDER BY kab_no, kec_no))::uuid AS kec_id
      FROM (VALUES ${kabs}) AS x(kab_no, kab_name, n_kec)
      CROSS JOIN LATERAL generate_series(1, x.n_kec) AS g(kec_no)
    ), picked AS (
      SELECT p.n,
             floor(((p.n - 1) * ${SCHOOL_TOTAL}.0) / ${schoolCount}.0)::int + 1 AS school_ord
      FROM generate_series(1, ${schoolCount}) AS p(n)
    ), data AS (
      SELECT p.n, p.school_ord, k.*,
             ((p.school_ord - 1) % 8) + 1 AS slot,
             (p.school_ord % 37 = 0) AS only_prov,
             (p.school_ord % 31 = 0 AND p.school_ord % 37 <> 0) AS only_kab
      FROM picked p
      JOIN k ON k.kec_ord = floor((p.school_ord - 1) / 8)::int + 1
    )
    INSERT INTO public.schools
      (school_id, name, slug, region_id, kabupaten_id, provinsi_id, jenjang,
       share_with_region, share_kabupaten, share_provinsi, is_active)
    SELECT md5('school-' || school_ord)::uuid,
           CASE WHEN slot <= 2 THEN 'SMK ' || slot
                WHEN slot <= 4 THEN 'SMA ' || (slot - 2)
                ELSE 'SMP ' || (slot - 4) END
             || ' <Kecamatan ' || lpad(kec_ord::text, 3, '0') || '>',
           'riau-' || school_ord,
           CASE WHEN only_prov OR only_kab THEN NULL ELSE kec_id END,
           CASE WHEN only_prov THEN NULL ELSE kab_id END,
           CASE WHEN only_kab THEN NULL ELSE md5('region-provinsi-riau')::uuid END,
           CASE WHEN slot <= 2 THEN 'SMK' WHEN slot <= 4 THEN 'SMA' ELSE 'SMP' END,
           (NOT only_prov AND NOT only_kab AND abs(hashtext('share-kec-' || school_ord)) % 100 < 70),
           (NOT only_prov AND abs(hashtext('share-kab-' || school_ord)) % 100 < 50),
           (NOT only_kab AND abs(hashtext('share-prov-' || school_ord)) % 100 < 40),
           (school_ord % 20 <> 0)
    FROM data;

    INSERT INTO public.programs (program_id, code, name, school_id)
    SELECT md5('program-' || school_id::text)::uuid, 'UMUM', 'Umum', school_id FROM public.schools;
    INSERT INTO public.classes (class_id, name, program_id, academic_year, grade_level, school_id)
    SELECT md5('class-' || s.school_id::text)::uuid, 'X-UMUM',
           p.program_id, '2026/2027', 10, s.school_id
    FROM public.schools s JOIN public.programs p USING (school_id);
    INSERT INTO public.subjects (subject_id, code, name, school_id)
    SELECT md5('subject-' || school_id::text)::uuid, 'UMUM', 'Umum', school_id FROM public.schools;

    INSERT INTO auth.users (id, email)
    SELECT md5('teacher-auth-' || school_id::text)::uuid,
           'guru-' || school_id::text || '@staff.internal'
    FROM public.schools;
    INSERT INTO public.users
      (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
    SELECT md5('teacher-user-' || school_id::text)::uuid,
           md5('teacher-auth-' || school_id::text)::uuid,
           'Guru ' || school_id::text,
           'guru-' || school_id::text || '@staff.internal',
           'G-' || school_id::text, 'NIP', 'GURU', school_id
    FROM public.schools;

    INSERT INTO public.students (student_id, nis, full_name, program_id, school_id)
    SELECT md5('student-' || s.school_id::text || '-' || g.n)::uuid,
           'NIS-' || substr(s.school_id::text, 1, 8) || '-' || g.n,
           'Siswa sintetis ' || g.n, p.program_id, s.school_id
    FROM public.schools s
    JOIN public.programs p USING (school_id)
    CROSS JOIN LATERAL generate_series(1, ${siswa}) AS g(n);
    INSERT INTO public.class_enrollments (student_id, class_id, academic_year, semester, school_id)
    SELECT st.student_id, c.class_id, '2026/2027', '1', st.school_id
    FROM public.students st JOIN public.classes c USING (school_id);

    INSERT INTO auth.users (id, email)
    SELECT md5('parent-auth-' || s.school_id::text || '-' || g.n)::uuid,
           'ortu-' || s.school_id::text || '-' || g.n || '@ortu.internal'
    FROM public.schools s
    CROSS JOIN LATERAL generate_series(1, greatest(1, floor(${siswa} * 0.7)::int)) AS g(n);
    INSERT INTO public.users
      (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id)
    SELECT md5('parent-user-' || s.school_id::text || '-' || g.n)::uuid,
           md5('parent-auth-' || s.school_id::text || '-' || g.n)::uuid,
           'Orang tua sintetis',
           'ortu-' || s.school_id::text || '-' || g.n || '@ortu.internal',
           'O-' || s.school_id::text || '-' || g.n, 'NIK', 'ORTU', s.school_id
    FROM public.schools s
    CROSS JOIN LATERAL generate_series(1, greatest(1, floor(${siswa} * 0.7)::int)) AS g(n);
    INSERT INTO public.student_parents (student_id, parent_user_id, school_id)
    SELECT md5('student-' || s.school_id::text || '-' || g.n)::uuid,
           md5('parent-user-' || s.school_id::text || '-' || g.n)::uuid,
           s.school_id
    FROM public.schools s
    CROSS JOIN LATERAL generate_series(1, greatest(1, floor(${siswa} * 0.7)::int)) AS g(n);

    INSERT INTO public.teaching_schedules
      (schedule_id, assignment_id, class_id, subject_id, scheduled_teacher_id,
       session_date, session_start, session_end, academic_year, semester,
       school_id, subject_label, block_group_id)
    SELECT md5('schedule-' || s.school_id::text || '-' || d.n || '-' || h.n)::uuid,
           NULL, c.class_id, sub.subject_id,
           md5('teacher-user-' || s.school_id::text)::uuid,
           (now() AT TIME ZONE 'Asia/Jakarta')::date - d.n + 1,
           ('07:00'::time + ((h.n - 1) * interval '90 minutes'))::time,
           ('08:00'::time + ((h.n - 1) * interval '90 minutes'))::time,
           '2026/2027', '1', s.school_id, 'Umum',
           md5('block-' || s.school_id::text || '-' || d.n || '-' || h.n)::uuid
    FROM public.schools s
    JOIN public.classes c USING (school_id)
    JOIN public.subjects sub USING (school_id)
    CROSS JOIN LATERAL generate_series(0, ${HARI - 1}) AS d(n)
    CROSS JOIN LATERAL generate_series(1, ${SESI_PER_HARI}) AS h(n);
  `);

  await db.exec(`
    INSERT INTO public.attendance
      (attendance_id, schedule_id, student_id, status, source, recorded_by_user_id, school_id)
    SELECT md5('attendance-' || ts.schedule_id::text || '-' || st.student_id::text)::uuid,
           ts.schedule_id, st.student_id,
           CASE WHEN abs(hashtext('status-' || ts.schedule_id::text || '-' || st.student_id::text)) % 100 < 82 THEN 'HADIR'
                WHEN abs(hashtext('status-' || ts.schedule_id::text || '-' || st.student_id::text)) % 100 < 90 THEN 'SAKIT'
                WHEN abs(hashtext('status-' || ts.schedule_id::text || '-' || st.student_id::text)) % 100 < 96 THEN 'IZIN'
                ELSE 'ALPA' END::attendance_status,
           'TEACHER_DECLARED'::attendance_source,
           md5('teacher-user-' || ts.school_id::text)::uuid, ts.school_id
    FROM public.teaching_schedules ts
    JOIN public.students st USING (school_id);

    INSERT INTO public.late_arrivals
      (late_id, school_id, student_id, recorded_by, late_date, arrival_time, reason)
    SELECT md5('late-' || st.student_id::text)::uuid, st.school_id, st.student_id,
           md5('teacher-user-' || st.school_id::text)::uuid,
           (now() AT TIME ZONE 'Asia/Jakarta')::date - (abs(hashtext(st.student_id::text)) % ${HARI}),
           '07:35', NULL
    FROM public.students st
    WHERE abs(hashtext('late-select-' || st.student_id::text)) % 100 < 8;
    INSERT INTO public.student_exits
      (exit_id, school_id, student_id, exit_date, exit_time, reason, recorded_by)
    SELECT md5('exit-' || st.student_id::text)::uuid, st.school_id, st.student_id,
           (now() AT TIME ZONE 'Asia/Jakarta')::date - (abs(hashtext(st.student_id::text)) % ${HARI}),
           '10:00', NULL, md5('teacher-user-' || st.school_id::text)::uuid
    FROM public.students st
    WHERE abs(hashtext('exit-select-' || st.student_id::text)) % 100 < 4;
  `);
  await db.exec('ANALYZE');
}

async function loadMetadata(db, schoolCount, siswa) {
  const [schoolResult, staffResult, dateResult, countsResult] = await Promise.all([
    db.query(`SELECT school_id::text, name, jenjang, region_id::text, kabupaten_id::text,
                     provinsi_id::text, share_with_region, share_kabupaten, share_provinsi,
                     is_active FROM public.schools ORDER BY school_id`),
    db.query(`SELECT rs.auth_user_id::text, rs.region_id::text, r.name, r.level
              FROM public.region_staff rs JOIN public.regions r USING (region_id)`),
    db.query('SELECT public.fn_hari_ini()::text AS today'),
    db.query(`SELECT count(*) FILTER (WHERE table_name = 'attendance')::int AS ignored
              FROM information_schema.tables WHERE table_schema = 'public'`),
  ]);
  const counts = await db.query(`SELECT
      (SELECT count(*)::int FROM public.schools) AS schools,
      (SELECT count(*)::int FROM public.students) AS students,
      (SELECT count(*)::int FROM public.teaching_schedules) AS schedules,
      (SELECT count(*)::int FROM public.attendance) AS attendance,
      (SELECT count(*)::int FROM public.users WHERE role_type = 'ORTU') AS parents,
      (SELECT count(*)::int FROM public.late_arrivals) AS late_arrivals,
      (SELECT count(*)::int FROM public.student_exits) AS student_exits`);
  const staff = staffResult.rows.map((r) => ({
    auth: r.auth_user_id, regionId: r.region_id, name: r.name, level: r.level,
    key: r.level === 'PROVINSI' ? 'provinsi' : r.level === 'KABUPATEN' && r.name.includes('Kampar') ? 'kampar' : r.level === 'KECAMATAN' && r.name.includes(` ${String(KEC_TEST_NO).padStart(2, '0')}`) && r.name.includes(KABUPATEN[0][0]) ? 'kecamatan' : `staff-${r.region_id}`,
  }));
  const byKey = new Map();
  for (const actor of staff) if (!byKey.has(actor.key)) byKey.set(actor.key, actor);
  const meta = schoolResult.rows.map((r) => ({ ...r, school_id: String(r.school_id) }));
  return {
    db, schoolCount, siswa, meta, staff, byKey, today: String(dateResult.rows[0].today),
    counts: counts.rows[0], ignored: countsResult.rows[0].ignored,
  };
}

async function buildStage(schoolCount, siswa) {
  const estimate = estimatedAttendanceRows(schoolCount, siswa);
  if (estimate > MAX_ATTENDANCE_ROWS) {
    skipped.push({ stage: `${schoolCount} sekolah / SISWA=${siswa}`, reason: `perkiraan ${estimate} baris attendance > MAX_ATTENDANCE_ROWS=${MAX_ATTENDANCE_ROWS}` });
    return null;
  }
  const before = performance.now();
  let db = null;
  try {
    db = await setupDb();
    await seedDb(db, schoolCount, siswa);
    const stage = await loadMetadata(db, schoolCount, siswa);
    stage.buildMs = performance.now() - before;
    console.log(`BUILD scale=${schoolCount} siswa=${siswa} attendance=${stage.counts.attendance} rows build_ms=${stage.buildMs.toFixed(1)}`);
    return stage;
  } catch (error) {
    if (db) await db.close().catch(() => {});
    const message = String(error?.stack || error);
    if (/out of memory|cannot allocate|memory|oom|timeout/i.test(message)) {
      skipped.push({ stage: `${schoolCount} sekolah / SISWA=${siswa}`, reason: `batas runtime: ${message.slice(0, 180)}` });
      return null;
    }
    failures.push(`seed ${schoolCount}/${siswa}: ${message}`);
    return null;
  }
}

async function asActor(stage, actor, sql, params = []) {
  await stage.db.exec('RESET ROLE');
  await stage.db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [actor.auth]);
  await stage.db.query(`SELECT set_config('request.jwt.claims', $1, false)`, ['{}']);
  await stage.db.exec('SET ROLE authenticated');
  try {
    return await stage.db.query(sql, params);
  } finally {
    await stage.db.exec('RESET ROLE');
  }
}

function jsonValue(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function jsonSize(value) {
  const text = JSON.stringify(value ?? null);
  return { textLength: text.length, bytes: Buffer.byteLength(text, 'utf8') };
}

function median(numbers) {
  const a = [...numbers].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

async function measure(stage, actor, label, sql, params, extra = {}) {
  const times = [];
  let output = null;
  let error = null;
  for (let i = 0; i < REPEATS; i += 1) {
    const t0 = performance.now();
    try {
      const result = await asActor(stage, actor, sql, params);
      output = result.rows[0]?.o ?? result.rows;
    } catch (e) {
      error = e;
    }
    times.push(performance.now() - t0);
  }
  if (error) {
    failures.push(`${label} actor=${actor.key}: ${String(error?.stack || error)}`);
    return null;
  }
  const value = jsonValue(output);
  const size = jsonSize(value);
  const schoolCount = Array.isArray(value) ? null : value?.sekolah?.length ?? null;
  const row = {
    scale: stage.schoolCount, siswa: stage.siswa, actor: actor.key, function: extra.function || label,
    period: extra.period || '', repeats: REPEATS, min_ms: Math.min(...times), median_ms: median(times), max_ms: Math.max(...times),
    json_chars: size.textLength, bytes: size.bytes, schools_returned: schoolCount,
    attendance_rows: stage.counts.attendance, trend_rows: Array.isArray(value) ? value.length : null,
  };
  outputRows.push(row);
  return { row, value };
}

function expectedVisible(meta, actor) {
  return new Set(meta.filter((s) => s.is_active && (
    (s.region_id === actor.regionId && s.share_with_region)
    || (s.kabupaten_id === actor.regionId && s.share_kabupaten)
    || (s.provinsi_id === actor.regionId && s.share_provinsi)
  )).map((s) => s.school_id));
}

function schoolIdsFromOverview(value) {
  return new Set((value?.sekolah || []).map((s) => String(s.school_id)));
}

function isoDate(today, daysAgo) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function measureStage(stage) {
  const prov = stage.byKey.get('provinsi');
  const kab = stage.byKey.get('kampar');
  const kec = stage.byKey.get('kecamatan');
  if (!prov || !kab || !kec) {
    failures.push(`staff target tidak lengkap pada skala ${stage.schoolCount}`);
    return;
  }
  const actors = [prov, kab, kec];
  for (const actor of actors) {
    for (const [period, daysAgo] of [['30d', 29], ['366d', 365]]) {
      await measure(stage, actor, 'overview_range',
        `SELECT public.fn_region_overview_range($1::date, $2::date, NULL::uuid, false) AS o`,
        [isoDate(stage.today, daysAgo), stage.today],
        { function: 'fn_region_overview_range', period });
    }
  }
  const visible = [...expectedVisible(stage.meta, prov)];
  if (visible.length) {
    const schoolId = visible[0];
    for (const [period, daysAgo, grain] of [['mingguan-90d', 89, 'MINGGU'], ['bulanan-366d', 365, 'BULAN']]) {
      await measure(stage, prov, 'school_trend_range',
        `SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.periode_mulai), '[]'::jsonb) AS o
         FROM public.fn_region_school_trend_range($1::uuid, $2::date, $3::date, $4::text) x`,
        [schoolId, isoDate(stage.today, daysAgo), stage.today, grain],
        { function: 'fn_region_school_trend_range', period });
    }
  } else {
    skipped.push({ stage: `${stage.schoolCount} sekolah / SISWA=${stage.siswa}`, reason: 'tidak ada sekolah terlihat oleh pegawai provinsi untuk tren' });
  }
}

async function runExplain(stage) {
  const prov = stage.byKey.get('provinsi');
  await stage.db.exec('RESET ROLE');
  const sql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    WITH sch AS (
      SELECT school_id, name, jenjang FROM public.fn_region_sekolah_terlihat('${prov.regionId}')
    ), sesi AS (
      SELECT ts.school_id, count(*)::int AS terjadwal,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.attendance a WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void))::int AS tercatat
      FROM public.teaching_schedules ts
      WHERE ts.school_id IN (SELECT school_id FROM sch) AND ts.session_date BETWEEN '${isoDate(stage.today, 365)}' AND '${stage.today}' AND ts.meeting_status = 'NORMAL'
      GROUP BY ts.school_id
    ), hadir AS (
      SELECT a.school_id, count(*)::int AS baris, count(*) FILTER (WHERE a.status = 'HADIR')::int AS hadir
      FROM public.attendance a JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE a.school_id IN (SELECT school_id FROM sch) AND NOT a.is_void AND ts.session_date BETWEEN '${isoDate(stage.today, 365)}' AND '${stage.today}'
      GROUP BY a.school_id
    ), siswa AS (
      SELECT st.school_id, count(*)::int AS n FROM public.students st
      WHERE st.school_id IN (SELECT school_id FROM sch) AND st.student_status IN ('AKTIF','PKL') GROUP BY st.school_id
    ), ortu AS (
      SELECT u.school_id, count(*)::int AS n FROM public.users u
      WHERE u.school_id IN (SELECT school_id FROM sch) AND u.role_type = 'ORTU' AND u.is_active AND u.deleted_at IS NULL GROUP BY u.school_id
    ), telat AS (
      SELECT school_id, count(*)::int AS n FROM public.late_arrivals WHERE school_id IN (SELECT school_id FROM sch) AND late_date BETWEEN '${isoDate(stage.today, 365)}' AND '${stage.today}' GROUP BY school_id
    ), keluar AS (
      SELECT school_id, count(*)::int AS n FROM public.student_exits WHERE school_id IN (SELECT school_id FROM sch) AND exit_date BETWEEN '${isoDate(stage.today, 365)}' AND '${stage.today}' GROUP BY school_id
    ), nilai AS (
      SELECT sch.school_id, sch.name, sch.jenjang, COALESCE(siswa.n, 0) AS siswa_aktif,
             COALESCE(ortu.n, 0) AS orang_tua_aktif, COALESCE(sesi.terjadwal, 0) AS sesi_terjadwal,
             COALESCE(sesi.tercatat, 0) AS sesi_tercatat, COALESCE(hadir.baris, 0) AS baris,
             COALESCE(hadir.hadir, 0) AS hadir, COALESCE(telat.n, 0) AS terlambat, COALESCE(keluar.n, 0) AS izin_keluar
      FROM sch LEFT JOIN siswa USING (school_id) LEFT JOIN ortu USING (school_id)
      LEFT JOIN sesi USING (school_id) LEFT JOIN hadir USING (school_id)
      LEFT JOIN telat USING (school_id) LEFT JOIN keluar USING (school_id)
    )
    SELECT jsonb_build_object('sekolah', COALESCE(jsonb_agg(to_jsonb(nilai)), '[]'::jsonb), 'jumlah', count(*)) FROM nilai`;
  try {
    let result;
    try {
      result = await stage.db.query(sql);
    } catch (error) {
      if (!/BUFFERS|unrecognized|syntax/i.test(String(error))) throw error;
      result = await stage.db.query(sql.replace('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)', 'EXPLAIN (ANALYZE, FORMAT TEXT)'));
    }
    const lines = result.rows.map((r) => String(r['QUERY PLAN'] ?? Object.values(r)[0]));
    const interesting = lines.filter((line) => /Seq Scan|Index Scan|Bitmap|Nested Loop|Hash Join|Merge Join|loops=|actual time/i.test(line));
    console.log(`\nEXPLAIN_PROV_366_${stage.schoolCount}`);
    for (const line of interesting) console.log(line);
    stage.explainLines = lines;
  } catch (error) {
    failures.push(`EXPLAIN: ${String(error?.stack || error)}`);
  }
}

async function checkIndexes(stage) {
  const result = await stage.db.query(`
    SELECT i.tablename, i.indexname,
           COALESCE(s.idx_scan, 0)::bigint AS idx_scan
    FROM pg_indexes i
    LEFT JOIN pg_stat_user_indexes s ON s.schemaname = i.schemaname AND s.relname = i.tablename AND s.indexrelname = i.indexname
    WHERE i.schemaname = 'public'
      AND i.tablename IN ('attendance','teaching_schedules','students','users','late_arrivals','student_exits')
    ORDER BY i.tablename, i.indexname`);
  console.log('\nINDEXES_BIG_TABLES (pg_indexes + pg_stat_user_indexes)');
  for (const row of result.rows) console.log(`${row.tablename}\t${row.indexname}\tidx_scan=${row.idx_scan}`);
  const expected = new Set(['attendance','teaching_schedules','students','users','late_arrivals','student_exits']);
  const seen = new Set(result.rows.map((r) => r.tablename));
  const missing = [...expected].filter((t) => !seen.has(t));
  console.log(`INDEX_MISSING_TABLES=${missing.join(',') || '(tidak ada)'}`);
  console.log('Catatan idx_scan=0 berarti tidak terpakai dalam sesi ini; bukan bukti indeks selalu tidak berguna.');
}

async function checkIsolation(stage) {
  const actors = stage.staff;
  let matched = 0;
  const mismatches = [];
  for (const actor of actors) {
    let value;
    try {
      const result = await asActor(stage, actor,
        `SELECT public.fn_region_overview_range($1::date, $2::date, NULL::uuid, false) AS o`,
        [isoDate(stage.today, 29), stage.today]);
      value = jsonValue(result.rows[0].o);
    } catch (error) {
      mismatches.push({ actor: actor.name, error: String(error) });
      continue;
    }
    const expected = expectedVisible(stage.meta, actor);
    const actual = schoolIdsFromOverview(value);
    const extra = [...actual].filter((id) => !expected.has(id));
    const missing = [...expected].filter((id) => !actual.has(id));
    const n = expected.size;
    const totalPrivacy = n < 3 ? value.total === null : value.total !== null;
    const subtotalPrivacy = (value.per_jenjang || []).every((x) => Number(x.jumlah_sekolah) >= 2)
      && new Set((value.per_jenjang || []).map((x) => x.jenjang)).size === (value.per_jenjang || []).length;
    const text = JSON.stringify(value);
    const forbiddenKeys = /"(?:region_id|kabupaten_id|provinsi_id)"/.test(text);
    const ownName = actor.name;
    const otherRegionNames = stage.staff.filter((s) => s.regionId !== actor.regionId).map((s) => s.name).filter((x) => text.includes(x));
    const noTanpa = !text.includes('Tanpa ');
    const privacyOk = totalPrivacy && subtotalPrivacy && noTanpa
      && (actor.level === 'KECAMATAN' || (!forbiddenKeys && otherRegionNames.length === 0));
    if (!extra.length && !missing.length && privacyOk) matched += 1;
    else mismatches.push({ actor: actor.name, extra, missing, totalPrivacy, subtotalPrivacy, forbiddenKeys, otherRegionNames, noTanpa });
  }

  const randomActor = actors[Math.abs(hashString(`trend-${stage.schoolCount}-${stage.siswa}`)) % actors.length];
  const invisible = stage.meta.filter((s) => !expectedVisible(stage.meta, randomActor).has(s.school_id));
  const sample = deterministicSample(invisible, 200, `schools-${randomActor.regionId}`);
  let trendEmpty = 0;
  for (const school of sample) {
    try {
      const result = await asActor(stage, randomActor,
        `SELECT * FROM public.fn_region_school_trend_range($1::uuid, $2::date, $3::date, 'MINGGU')`,
        [school.school_id, isoDate(stage.today, 89), stage.today]);
      if (result.rows.length === 0) trendEmpty += 1;
      else mismatches.push({ actor: randomActor.name, trendLeakSchool: school.school_id, rows: result.rows.length });
    } catch (error) {
      mismatches.push({ actor: randomActor.name, trendErrorSchool: school.school_id, error: String(error) });
    }
  }
  console.log(`\nISOLASI_SKALA sekolah=${stage.schoolCount} siswa=${stage.siswa}: cocok=${matched}/${actors.length}; trend_tidak_terlihat_kosong=${trendEmpty}/${sample.length}`);
  if (mismatches.length) console.log(`ISOLATION_DIFF ${JSON.stringify(mismatches.slice(0, 20))}`);
  return { matched, total: actors.length, mismatches, trendEmpty, trendTotal: sample.length };
}

function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function deterministicSample(items, count, seed) {
  return [...items].sort((a, b) => hashString(`${seed}-${a.school_id}`) - hashString(`${seed}-${b.school_id}`)).slice(0, count);
}

function printTables() {
  console.log('\n=== TABEL WAKTU + UKURAN KELUARAN ===');
  console.log('scale\tsiswa\tfunction\tactor\tperiod\trepeats\tmin_ms\tmedian_ms\tmax_ms\tjson_chars\tbytes\tschools_returned\tattendance_rows\ttrend_rows');
  for (const r of outputRows) console.log([r.scale, r.siswa, r.function, r.actor, r.period, r.repeats, r.min_ms.toFixed(2), r.median_ms.toFixed(2), r.max_ms.toFixed(2), r.json_chars, r.bytes, r.schools_returned ?? '', r.attendance_rows, r.trend_rows ?? ''].join('\t'));

  console.log('\n=== KURVA SKALA (overview provinsi 366d) ===');
  console.log('scale\tsiswa\tmin_ms\tmedian_ms\tmax_ms\tschools_returned\tattendance_rows\tbuild_ms');
  for (const r of scaleRows) console.log([r.scale, r.siswa, r.min_ms.toFixed(2), r.median_ms.toFixed(2), r.max_ms.toFixed(2), r.schools_returned, r.attendance_rows, r.build_ms.toFixed(2)].join('\t'));

  console.log('\n=== KURVA BEBAN PER SEKOLAH (overview provinsi 366d) ===');
  console.log('scale\tsiswa\tmin_ms\tmedian_ms\tmax_ms\tschools_returned\tattendance_rows\tbuild_ms');
  for (const r of loadRows) console.log([r.scale, r.siswa, r.min_ms.toFixed(2), r.median_ms.toFixed(2), r.max_ms.toFixed(2), r.schools_returned, r.attendance_rows, r.build_ms.toFixed(2)].join('\t'));
  if (!loadRows.length) console.log('(tidak ada tahap beban yang muat; lihat SKIPPED)');

  console.log('\n=== KESIMPULAN KURVA ===');
  if (scaleRows.length >= 2) {
    const first = scaleRows[0];
    const last = scaleRows[scaleRows.length - 1];
    const scaleRatio = last.scale / first.scale;
    const timeRatio = last.median_ms / first.median_ms;
    const shape = timeRatio <= scaleRatio * 1.5 ? 'mendekati linear pada titik yang muat' : 'lebih cepat dari linear pada titik yang muat';
    console.log(`skala ${first.scale}->${last.scale}: median ${first.median_ms.toFixed(2)}->${last.median_ms.toFixed(2)} ms (x${timeRatio.toFixed(2)}), sekolah x${scaleRatio.toFixed(2)}; pertumbuhan ${shape}.`);
    console.log(`attendance tumbuh ${first.attendance_rows}->${last.attendance_rows}; secara inferensial baris attendance/join agregat adalah beban utama, tetapi full-scale tidak tercapai.`);
  } else console.log('Kurva skala belum memiliki sedikitnya dua titik yang berhasil.');
  if (loadRows.length >= 2) console.log('Kurva SISWA menunjukkan pengaruh beban per sekolah dari tahap yang muat.');
  else console.log('Pengaruh SISWA 24/48 tidak diuji karena guard memori; tidak boleh disimpulkan dari data ini.');

  console.log('\n=== RINGKASAN EXPLAIN ===');
  const explainStage = fullStage || largestStage;
  if (explainStage?.explainLines) {
    const scanLines = explainStage.explainLines.filter((l) => /Seq Scan|Index Scan|Bitmap|Nested Loop|Hash Join|Merge Join/i.test(l));
    for (const line of scanLines) console.log(line);
    console.log(`seq_scan_tabel_besar=${scanLines.filter((l) => /Seq Scan on (attendance|teaching_schedules|students|users|late_arrivals|student_exits)/i.test(l)).length}`);
    console.log(`nested_loop=${scanLines.filter((l) => /Nested Loop/i.test(l)).length}; indikasi_kuadratik=tidak_disimpulkan_dari_nama_join_saja`);
    if (!fullStage) console.log(`EXPLAIN 1376 tidak dijalankan; fallback EXPLAIN stage=${explainStage.schoolCount}.`);
  } else console.log('EXPLAIN tidak berhasil dijalankan.');

  console.log('\n=== HASIL ISOLASI ===');
  const isolationStage = fullStage || largestStage;
  console.log(`Stage isolasi yang benar-benar diuji: ${isolationStage ? `${isolationStage.schoolCount} sekolah, SISWA=${isolationStage.siswa}` : 'tidak ada'}.`);
  if (isolationStage?.isolation) {
    console.log(`pegawai_cocok=${isolationStage.isolation.matched}/${isolationStage.isolation.total}`);
    console.log(`trend_tidak_terlihat_kosong=${isolationStage.isolation.trendEmpty}/${isolationStage.isolation.trendTotal}`);
    if (isolationStage.isolation.mismatches.length) console.log(`selisih=${JSON.stringify(isolationStage.isolation.mismatches.slice(0, 20))}`);
  }

  console.log('\n=== BATAS, ASUMSI, DAN STATUS ===');
  console.log(`konfigurasi: SISWA=${DEFAULT_SISWA}, HARI=${HARI}, SESI_PER_HARI=${SESI_PER_HARI}, repeats=${REPEATS}, MAX_ATTENDANCE_ROWS=${MAX_ATTENDANCE_ROWS}`);
  console.log(`target_skala=${SCALE_STAGES.join(',')}; target_beban=${LOAD_STAGES.join(',')}`);
  if (skipped.length) for (const s of skipped) console.log(`SKIPPED ${s.stage}: ${s.reason}`);
  if (!skipped.length) console.log('SKIPPED: tidak ada');
  console.log('Terbukti dijalankan: setup PGlite, baseline + semua migrasi sampai 20261016030000, seed set-based, pengukuran, isolation check, dan EXPLAIN bila ada full stage.');
  console.log('Hanya dibaca: source migrasi dan pola tests/isolation-matrix.mjs/tests/region-layer.mjs.');
  console.log('Tidak diuji: Supabase nyata, jaringan, deployment, dan prediksi Supabase Free.');
  console.log('Peringatan: PGlite adalah satu proses di komputer pengembangan; angka mutlak tidak memprediksi Supabase Free. Bentuk kurva dan ada/tidaknya Seq Scan yang lebih bermakna.');
  console.log(`durasi_total_ms=${(performance.now() - startedAt).toFixed(2)}`);
}

async function main() {
  console.log(`SCALE_VISIBILITY_START total_sekolah=${SCHOOL_TOTAL} kecamatan=${KEC_TOTAL} konfigurasi=SISWA:${DEFAULT_SISWA},HARI:${HARI},SESI:${SESI_PER_HARI}`);
  for (const schoolCount of SCALE_STAGES) {
    const stage = await buildStage(schoolCount, DEFAULT_SISWA);
    if (!stage) continue;
    if (schoolCount === SCHOOL_TOTAL) fullStage = stage;
    if (!largestStage || stage.schoolCount > largestStage.schoolCount) {
      if (largestStage && largestStage !== fullStage) await largestStage.db.close().catch(() => {});
      largestStage = stage;
    }
    await measureStage(stage);
    const curve = outputRows.find((r) => r.scale === schoolCount && r.siswa === DEFAULT_SISWA
      && r.actor === 'provinsi' && r.period === '366d' && r.function === 'fn_region_overview_range');
    if (curve) scaleRows.push({ ...curve, build_ms: stage.buildMs });
    // Stage terbesar dipertahankan untuk isolation fallback; stage lain dilepas.
    if (schoolCount !== SCHOOL_TOTAL && stage !== largestStage) await stage.db.close().catch(() => {});
  }

  for (const siswa of LOAD_STAGES) {
    if (siswa === DEFAULT_SISWA && fullStage?.schoolCount === SCHOOL_TOTAL) {
      const measured = outputRows.find((r) => r.scale === SCHOOL_TOTAL && r.siswa === siswa && r.actor === 'provinsi' && r.period === '366d' && r.function === 'fn_region_overview_range');
      if (measured) loadRows.push({ ...measured, build_ms: fullStage.buildMs });
      continue;
    }
    const stage = await buildStage(SCHOOL_TOTAL, siswa);
    if (!stage) continue;
    const measured = await measure(stage, stage.byKey.get('provinsi'), 'overview_range',
      `SELECT public.fn_region_overview_range($1::date, $2::date, NULL::uuid, false) AS o`,
      [isoDate(stage.today, 365), stage.today],
      { function: 'fn_region_overview_range', period: '366d' });
    if (measured) loadRows.push({ ...measured.row, build_ms: stage.buildMs });
    if (!fullStage && siswa === DEFAULT_SISWA) {
      fullStage = stage;
      largestStage = stage;
    } else await stage.db.close().catch(() => {});
  }

  if (fullStage) {
    await runExplain(fullStage);
    await checkIndexes(fullStage);
    fullStage.isolation = await checkIsolation(fullStage);
  } else if (largestStage) {
    // Fallback transparan ketika full-scale dilewati oleh guard memori.
    await runExplain(largestStage);
    await checkIndexes(largestStage);
    largestStage.isolation = await checkIsolation(largestStage);
  } else {
    skipped.push({ stage: 'full-scale isolation/EXPLAIN', reason: 'tidak ada stage yang berhasil dibangun' });
  }
  printTables();
  if (fullStage) await fullStage.db.close().catch(() => {});
  else if (largestStage) await largestStage.db.close().catch(() => {});
  if (failures.length) {
    console.error(`\nSCALE_VISIBILITY_FAILURES=${failures.length}`);
    for (const failure of failures.slice(0, 20)) console.error(failure);
    process.exitCode = 1;
  } else if ((fullStage?.isolation || largestStage?.isolation)?.mismatches?.length) {
    console.error('\nSCALE_VISIBILITY_ISOLATION_MISMATCH');
    process.exitCode = 1;
  } else {
    console.log('\nSCALE_VISIBILITY_COMPLETE');
  }
}

await main();
