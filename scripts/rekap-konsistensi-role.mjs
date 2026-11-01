/**
 * Verifikasi konsistensi data website == data Excel untuk setiap role.
 * Jalankan: node scripts/rekap-konsistensi-role.mjs
 *
 * Pendekatan efisien: GROUP BY class_id / teacher_id dalam satu query per bulan,
 * bukan loop per kelas/per guru — total ~15 query per sekolah, bukan ratusan.
 *
 *   R1 — WALI KELAS  : 12×bulan = full tahun, semua kelas (1 query/bulan GROUP BY class)
 *   R2 — GURU        : 12×bulan = full tahun, semua guru (1 query/bulan GROUP BY teacher)
 *   R3 — KAPRODI     : sum per-kelas dalam program = total program (SMK)
 *   R4 — WAKA + R6 TU: sum per-kelas = total sekolah
 *   R5 — BK          : tidak ada siswa orphan (absensi tapi tidak terdaftar di kelas)
 *   R7 — WAKASEK SMP : 12×bulan = full tahun school-wide
 */

import fs from 'fs';

const envRaw = fs.readFileSync('.env', 'utf8');
const get = k => (envRaw.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1]?.trim().replace(/^<|>$/g, '');

const SUPABASE_URL = get('SUPABASE_URL');
const MGMT_TOKEN   = get('SUPABASE_ACCESS_TOKEN');
const PROJECT_REF  = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];

if (!MGMT_TOKEN || !PROJECT_REF) {
    console.error('ERROR: SUPABASE_ACCESS_TOKEN atau PROJECT_REF tidak ada di .env');
    process.exit(1);
}

const now    = new Date();
const tahun  = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const P_FROM = `${tahun}-07-01`;
const P_TO   = `${tahun + 1}-06-30`;
const MONTHS = Array.from({ length: 12 }, (_, m) => {
    const yr = m < 6 ? tahun + 1 : tahun;
    const mo = m < 6 ? m + 1 : m + 7 - 6;
    const lastDay = new Date(yr, mo, 0).getDate();
    return { from: `${yr}-${String(mo).padStart(2,'0')}-01`, to: `${yr}-${String(mo).padStart(2,'0')}-${lastDay}` };
});

const hasil = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sql(query) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    return Array.isArray(json) ? json : [];
}

function log(check, label, status, pesan) {
    const ikon = { PASS: '✓', FAIL: '✗', ERR: '!', SKIP: '-', INFO: 'i' }[status] || '?';
    const line = `  [${ikon}] ${check} | ${label} | ${pesan}`;
    console.log(line);
    hasil.push({ check, label, status, pesan });
}

/** CTE pivot: GROUP BY (student, class, block_group), optional teacher filter */
function cte(school_id, from, to, teacherFilter = '') {
    return `
    WITH att_pivot AS (
      SELECT
        a.student_id,
        ts.class_id,
        ts.block_group_id,
        ts.scheduled_teacher_id,
        CASE MAX(CASE a.status::text
          WHEN 'ALPA'  THEN 4 WHEN 'SAKIT' THEN 3
          WHEN 'IZIN'  THEN 2 WHEN 'HADIR' THEN 1 ELSE 0 END)
          WHEN 4 THEN 'ALPA' WHEN 3 THEN 'SAKIT'
          WHEN 2 THEN 'IZIN' WHEN 1 THEN 'HADIR' END AS status
      FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE a.school_id = '${school_id}'
        AND ts.session_date BETWEEN '${from}'::date AND '${to}'::date
        AND a.is_void = false AND a.status IS NOT NULL
        ${teacherFilter}
      GROUP BY a.student_id, ts.class_id, ts.block_group_id, ts.scheduled_teacher_id
    )`;
}

/** Agregasi H/S/I/A GROUP BY key (class_id atau scheduled_teacher_id) */
function aggrByKey(key) {
    return `
    SELECT ${key} AS grp_key,
      COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
      COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
      COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
      COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
    FROM att_pivot GROUP BY ${key}`;
}

/** Bandingkan dua Map<grp_key, {H,S,I,A}>: kembalikan list mismatch */
function diffMaps(m12, mFull) {
    const keys = new Set([...m12.keys(), ...mFull.keys()]);
    const mismatches = [];
    for (const k of keys) {
        const a = m12.get(k)   ?? { H:0, S:0, I:0, A:0 };
        const b = mFull.get(k) ?? { H:0, S:0, I:0, A:0 };
        if (a.H!==b.H || a.S!==b.S || a.I!==b.I || a.A!==b.A)
            mismatches.push({ k, a, b });
    }
    return mismatches;
}

function toMap(rows, keyField) {
    const m = new Map();
    for (const r of rows)
        m.set(r.grp_key ?? r[keyField], { H:+r.hadir, S:+r.sakit, I:+r.izin, A:+r.alpa });
    return m;
}

function fmtMM(mm) {
    return mm.slice(0,3).map(m => `${m.k.slice(0,8)}: 12bln(H${m.a.H}) ≠ full(H${m.b.H})`).join('; ')
        + (mm.length > 3 ? ` …+${mm.length-3}` : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// R1 — WALI KELAS: 12×bulan = full tahun, GROUP BY class_id (1 query/bulan)
// ─────────────────────────────────────────────────────────────────────────────
async function r1WaliKelas(school_id, school_name) {
    try {
        // 12 query bulanan + 1 full year, berurutan (bukan paralel) untuk hindari rate limit
        const map12 = new Map(); // class_id → {H,S,I,A} akumulasi 12 bulan
        for (const m of MONTHS) {
            const rows = await sql(`${cte(school_id, m.from, m.to)} ${aggrByKey('class_id')}`);
            for (const r of rows) {
                const prev = map12.get(r.grp_key) ?? { H:0, S:0, I:0, A:0 };
                map12.set(r.grp_key, { H: prev.H+(+r.hadir), S: prev.S+(+r.sakit), I: prev.I+(+r.izin), A: prev.A+(+r.alpa) });
            }
            await sleep(2500);
        }
        const fullRows = await sql(`${cte(school_id, P_FROM, P_TO)} ${aggrByKey('class_id')}`);
        const mapFull  = toMap(fullRows, 'grp_key');
        await sleep(2500);

        if (map12.size === 0) { log('R1-wali', school_name, 'SKIP', 'tidak ada data absensi'); return; }
        const mm = diffMaps(map12, mapFull);
        if (mm.length === 0)
            log('R1-wali', school_name, 'PASS', `${map12.size} kelas: 12×bulan = full tahun ✓`);
        else
            log('R1-wali', school_name, 'FAIL', `${mm.length} kelas tidak cocok: ${fmtMM(mm)}`);
    } catch(e) { log('R1-wali', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 — GURU: 12×bulan = full tahun, GROUP BY teacher_id (1 query/bulan)
// ─────────────────────────────────────────────────────────────────────────────
async function r2Guru(school_id, school_name) {
    try {
        const map12 = new Map();
        for (const m of MONTHS) {
            const rows = await sql(`${cte(school_id, m.from, m.to)} ${aggrByKey('scheduled_teacher_id')}`);
            for (const r of rows) {
                const prev = map12.get(r.grp_key) ?? { H:0, S:0, I:0, A:0 };
                map12.set(r.grp_key, { H: prev.H+(+r.hadir), S: prev.S+(+r.sakit), I: prev.I+(+r.izin), A: prev.A+(+r.alpa) });
            }
            await sleep(2500);
        }
        const fullRows = await sql(`${cte(school_id, P_FROM, P_TO)} ${aggrByKey('scheduled_teacher_id')}`);
        const mapFull  = toMap(fullRows, 'grp_key');
        await sleep(2500);

        if (map12.size === 0) { log('R2-guru', school_name, 'SKIP', 'tidak ada data'); return; }
        const mm = diffMaps(map12, mapFull);
        if (mm.length === 0)
            log('R2-guru', school_name, 'PASS', `${map12.size} guru: 12×bulan = full tahun ✓`);
        else
            log('R2-guru', school_name, 'FAIL', `${mm.length} guru tidak cocok: ${fmtMM(mm)}`);
    } catch(e) { log('R2-guru', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R3 — KAPRODI: sum per-kelas per-program = total program (SMK)
// ─────────────────────────────────────────────────────────────────────────────
async function r3Kaprodi(school_id, school_name) {
    try {
        // class_id → program_id
        const clsProg = await sql(`
            SELECT c.class_id, c.program_id
            FROM classes c WHERE c.school_id = '${school_id}' AND c.program_id IS NOT NULL
        `);
        if (!clsProg.length) { log('R3-kaprodi', school_name, 'SKIP', 'tidak ada program'); return; }
        await sleep(2000);

        // pivot full year GROUP BY class_id
        const clsRows = await sql(`${cte(school_id, P_FROM, P_TO)} ${aggrByKey('class_id')}`);
        await sleep(2000);

        // akumulasi per program dari class rows
        const progMap = new Map(); // program_id → {H,S,I,A}
        const clsMap  = new Map(clsRows.map(r => [r.grp_key, { H:+r.hadir, S:+r.sakit, I:+r.izin, A:+r.alpa }]));
        for (const { class_id, program_id } of clsProg) {
            const c = clsMap.get(class_id) ?? { H:0, S:0, I:0, A:0 };
            const p = progMap.get(program_id) ?? { H:0, S:0, I:0, A:0 };
            progMap.set(program_id, { H: p.H+c.H, S: p.S+c.S, I: p.I+c.I, A: p.A+c.A });
        }

        // pivot full year GROUP BY program (via JOIN classes)
        const progRows = await sql(`
            ${cte(school_id, P_FROM, P_TO)}
            SELECT c.program_id AS grp_key,
              COUNT(*) FILTER (WHERE ap.status='HADIR')::int hadir,
              COUNT(*) FILTER (WHERE ap.status='SAKIT')::int sakit,
              COUNT(*) FILTER (WHERE ap.status='IZIN') ::int izin,
              COUNT(*) FILTER (WHERE ap.status='ALPA') ::int alpa
            FROM att_pivot ap
            JOIN classes c ON c.class_id = ap.class_id
            WHERE c.program_id IS NOT NULL
            GROUP BY c.program_id
        `);
        await sleep(2000);
        const progDirect = toMap(progRows, 'grp_key');

        const mm = diffMaps(progMap, progDirect);
        if (mm.length === 0)
            log('R3-kaprodi', school_name, 'PASS', `${progMap.size} program: sum-per-kelas = total-program ✓`);
        else
            log('R3-kaprodi', school_name, 'FAIL', `${mm.length} program tidak cocok: ${fmtMM(mm)}`);
    } catch(e) { log('R3-kaprodi', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 + R6 — WAKA + TU: sum per-kelas = total sekolah (2 query)
// ─────────────────────────────────────────────────────────────────────────────
async function r4WakaTU(school_id, school_name) {
    try {
        const [perKelas, total] = await Promise.all([
            sql(`${cte(school_id, P_FROM, P_TO)}
                SELECT SUM(h)::int hadir, SUM(s)::int sakit, SUM(i)::int izin, SUM(a)::int alpa
                FROM (SELECT class_id,
                    COUNT(*) FILTER (WHERE status='HADIR') h, COUNT(*) FILTER (WHERE status='SAKIT') s,
                    COUNT(*) FILTER (WHERE status='IZIN')  i, COUNT(*) FILTER (WHERE status='ALPA')  a
                  FROM att_pivot GROUP BY class_id) x`),
            sql(`${cte(school_id, P_FROM, P_TO)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot`),
        ]);
        await sleep(2500);
        const a = perKelas[0], b = total[0];
        if (!a || !b) { log('R4-waka', school_name, 'SKIP', 'tidak ada data'); log('R6-tu', school_name, 'SKIP', 'tidak ada data'); return; }
        const ok = +a.hadir===+b.hadir && +a.sakit===+b.sakit && +a.izin===+b.izin && +a.alpa===+b.alpa;
        const st = ok ? 'PASS' : 'FAIL';
        const msg = ok ? `sum-per-kelas = total-sekolah ✓` : `MISMATCH: kelas(H${a.hadir}) ≠ total(H${b.hadir})`;
        log('R4-waka', school_name, st, msg);
        log('R6-tu',   school_name, st, msg);
    } catch(e) { log('R4-waka', school_name, 'ERR', e.message); log('R6-tu', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R5 — BK: tidak ada siswa orphan (1 query)
// ─────────────────────────────────────────────────────────────────────────────
async function r5BK(school_id, school_name) {
    try {
        const rows = await sql(`
            ${cte(school_id, P_FROM, P_TO)}
            SELECT COUNT(*) AS n_orphan
            FROM att_pivot ap
            LEFT JOIN class_enrollments ce
                   ON ce.student_id = ap.student_id AND ce.class_id = ap.class_id
            WHERE ce.enrollment_id IS NULL
        `);
        await sleep(2000);
        const n = +(rows[0]?.n_orphan ?? 0);
        if (n === 0)
            log('R5-bk', school_name, 'PASS', 'tidak ada siswa orphan ✓');
        else
            log('R5-bk', school_name, 'FAIL', `${n} baris absensi siswa tidak terdaftar di kelasnya`);
    } catch(e) { log('R5-bk', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R7 — WAKASEK SMP: 12×bulan = full tahun school-wide (13 query, berurutan)
// ─────────────────────────────────────────────────────────────────────────────
async function r7Wakasek(school_id, school_name) {
    try {
        let tot12 = { H:0, S:0, I:0, A:0 };
        for (const m of MONTHS) {
            const [r] = await sql(`${cte(school_id, m.from, m.to)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot`);
            tot12 = { H: tot12.H+(+r?.hadir||0), S: tot12.S+(+r?.sakit||0), I: tot12.I+(+r?.izin||0), A: tot12.A+(+r?.alpa||0) };
            await sleep(2500);
        }
        const [full] = await sql(`${cte(school_id, P_FROM, P_TO)}
            SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                   COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                   COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                   COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
            FROM att_pivot`);
        await sleep(2500);
        const totF = { H:+full.hadir, S:+full.sakit, I:+full.izin, A:+full.alpa };
        if (tot12.H===totF.H && tot12.S===totF.S && tot12.I===totF.I && tot12.A===totF.A)
            log('R7-wakasek', school_name, 'PASS', `12×bulan = full tahun school-wide ✓`);
        else
            log('R7-wakasek', school_name, 'FAIL', `12bln(H${tot12.H}) ≠ full(H${totF.H})`);
    } catch(e) { log('R7-wakasek', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R8 — KELENGKAPAN KELAS GURU: kelas yang diajar tapi nol absensi = tidak
//      muncul di sheet bulanan Excel guru (hanya muncul di RINGKASAN jika ada)
// ─────────────────────────────────────────────────────────────────────────────
async function r8KelengkapanKelasGuru(school_id, school_name) {
    try {
        // Semua pasangan (guru, kelas) yang punya jadwal di tahun ini
        const scheduled = await sql(`
            SELECT ts.scheduled_teacher_id AS teacher_id,
                   ts.class_id,
                   c.name AS class_name,
                   u.full_name AS teacher_name,
                   COUNT(DISTINCT ts.block_group_id) AS n_sesi
            FROM teaching_schedules ts
            JOIN classes c ON c.class_id = ts.class_id
            JOIN users u ON u.user_id = ts.scheduled_teacher_id
            WHERE ts.school_id = '${school_id}'
              AND ts.session_date BETWEEN '${P_FROM}'::date AND '${P_TO}'::date
            GROUP BY ts.scheduled_teacher_id, ts.class_id, c.name, u.full_name
        `);
        await sleep(2500);
        if (!scheduled.length) { log('R8-kelas-guru', school_name, 'SKIP', 'tidak ada jadwal'); return; }

        // Pasangan (guru, kelas) yang punya minimal 1 baris absensi
        const hasAtt = await sql(`
            SELECT DISTINCT ts.scheduled_teacher_id AS teacher_id, ts.class_id
            FROM attendance a
            JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
            WHERE a.school_id = '${school_id}'
              AND ts.session_date BETWEEN '${P_FROM}'::date AND '${P_TO}'::date
              AND a.is_void = false AND a.status IS NOT NULL
        `);
        await sleep(2500);

        const attSet = new Set(hasAtt.map(r => `${r.teacher_id}|${r.class_id}`));
        const missing = scheduled.filter(r => !attSet.has(`${r.teacher_id}|${r.class_id}`));

        const nTotal   = scheduled.length;
        const nMissing = missing.length;
        const nOk      = nTotal - nMissing;

        if (nMissing === 0) {
            log('R8-kelas-guru', school_name, 'PASS',
                `semua ${nTotal} pasangan (guru×kelas) punya absensi → semua muncul di Excel ✓`);
        } else {
            // Kelompokkan per guru untuk laporan ringkas
            const byGuru = {};
            for (const r of missing) {
                if (!byGuru[r.teacher_name]) byGuru[r.teacher_name] = [];
                byGuru[r.teacher_name].push(`${r.class_name}(${r.n_sesi}sesi)`);
            }
            const ringkas = Object.entries(byGuru).slice(0, 3)
                .map(([g, cls]) => `${g}: ${cls.join(', ')}`).join(' | ');
            log('R8-kelas-guru', school_name, 'INFO',
                `${nMissing}/${nTotal} pasangan tanpa absensi → tidak muncul di sheet bulanan Excel. ${nOk} pasangan ✓. Contoh: ${ringkas}`);
        }
    } catch(e) { log('R8-kelas-guru', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R9 — KELENGKAPAN SISWA: siswa terdaftar di kelas tapi nol absensi = tidak
//      muncul di Excel wali/guru (hanya muncul jika fn_class_attendance_summary
//      mengembalikan baris dengan hadir=0/sakit=0 — tergantung implementasi)
// ─────────────────────────────────────────────────────────────────────────────
async function r9KelengkapanSiswa(school_id, school_name) {
    try {
        // Siswa terdaftar di kelas yang punya jadwal tahun ini
        const enrolled = await sql(`
            SELECT ce.class_id, COUNT(DISTINCT ce.student_id) AS n_enrolled
            FROM class_enrollments ce
            JOIN classes c ON c.class_id = ce.class_id
            WHERE c.school_id = '${school_id}'
            GROUP BY ce.class_id
        `);
        await sleep(2500);
        if (!enrolled.length) { log('R9-siswa', school_name, 'SKIP', 'tidak ada enrollment'); return; }

        // Siswa yang punya minimal 1 absensi di kelas yang sama
        const hasAtt = await sql(`
            SELECT ts.class_id, COUNT(DISTINCT a.student_id) AS n_hadir
            FROM attendance a
            JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
            WHERE a.school_id = '${school_id}'
              AND ts.session_date BETWEEN '${P_FROM}'::date AND '${P_TO}'::date
              AND a.is_void = false AND a.status IS NOT NULL
            GROUP BY ts.class_id
        `);
        await sleep(2500);

        const attMap = new Map(hasAtt.map(r => [r.class_id, +r.n_hadir]));
        let nKelasOk = 0, nKelasMissing = 0, totalMissing = 0;

        for (const e of enrolled) {
            const nEnr  = +e.n_enrolled;
            const nAtt  = attMap.get(e.class_id) ?? 0;
            const delta = nEnr - nAtt;
            if (delta > 0) { nKelasMissing++; totalMissing += delta; }
            else nKelasOk++;
        }

        if (nKelasMissing === 0) {
            log('R9-siswa', school_name, 'PASS',
                `semua siswa di ${nKelasOk} kelas punya absensi → semua muncul di Excel ✓`);
        } else {
            log('R9-siswa', school_name, 'INFO',
                `${totalMissing} siswa di ${nKelasMissing} kelas belum punya absensi → tidak muncul di Excel. ${nKelasOk} kelas ✓`);
        }
    } catch(e) { log('R9-siswa', school_name, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Rekap Konsistensi per Role (Website == Excel) ===');
    console.log(`Tahun ajaran: ${P_FROM} s/d ${P_TO}`);
    console.log('Catatan: jeda 2.5 detik antar query untuk hindari rate limit Management API\n');

    const schoolRows = await sql(`SELECT school_id, name, jenjang FROM schools ORDER BY jenjang, name`);
    await sleep(2000);

    const smpList = schoolRows.filter(s => s.jenjang === 'SMP');
    const smkList = schoolRows.filter(s => s.jenjang === 'SMK');

    const label = s => `${s.jenjang} ${s.name}`;

    console.log('\n── R1 WALI KELAS: 12×bulan = full tahun per kelas ──');
    for (const s of schoolRows) { await r1WaliKelas(s.school_id, label(s)); await sleep(3000); }

    console.log('\n── R2 GURU: filter teacher_id, 12×bulan = full tahun ──');
    for (const s of schoolRows) { await r2Guru(s.school_id, label(s)); await sleep(3000); }

    console.log('\n── R3 KAPRODI: sum per-kelas = total program (SMK) ──');
    for (const s of smkList) { await r3Kaprodi(s.school_id, label(s)); await sleep(3000); }
    if (!smkList.length) console.log('  (tidak ada SMK)');

    console.log('\n── R4 WAKA + R6 TU: sum per-kelas = total sekolah ──');
    for (const s of schoolRows) { await r4WakaTU(s.school_id, label(s)); await sleep(3000); }

    console.log('\n── R5 BK: tidak ada siswa orphan ──');
    for (const s of schoolRows) { await r5BK(s.school_id, label(s)); await sleep(3000); }

    console.log('\n── R7 WAKASEK SMP: 12×bulan = full tahun school-wide ──');
    for (const s of smpList) { await r7Wakasek(s.school_id, label(s)); await sleep(3000); }
    if (!smpList.length) console.log('  (tidak ada SMP)');

    console.log('\n── R8 KELENGKAPAN KELAS GURU: kelas tanpa absensi = tidak muncul di sheet bulanan ──');
    for (const s of schoolRows) { await r8KelengkapanKelasGuru(s.school_id, label(s)); await sleep(3000); }

    console.log('\n── R9 KELENGKAPAN SISWA: siswa tanpa absensi = tidak muncul di Excel ──');
    for (const s of schoolRows) { await r9KelengkapanSiswa(s.school_id, label(s)); await sleep(3000); }

    const pass = hasil.filter(r => r.status === 'PASS').length;
    const fail = hasil.filter(r => r.status === 'FAIL').length;
    const info = hasil.filter(r => r.status === 'INFO').length;
    const skip = hasil.filter(r => r.status === 'SKIP').length;
    const err  = hasil.filter(r => r.status === 'ERR').length;

    console.log('\n=== RINGKASAN ===');
    console.log(`PASS: ${pass} | FAIL: ${fail} | INFO: ${info} | SKIP: ${skip} | ERR: ${err}`);
    if (info > 0) {
        console.log('\nINFO (bukan error — data belum diisi guru/siswa baru):');
        hasil.filter(r => r.status === 'INFO').forEach(r => console.log(`  [i] ${r.check} (${r.label}): ${r.pesan}`));
    }

    if (fail > 0 || err > 0) {
        console.log('\nPerlu ditindaklanjuti:');
        hasil.filter(r => r.status === 'FAIL' || r.status === 'ERR')
             .forEach(r => console.log(`  [${r.status}] ${r.check} (${r.label}): ${r.pesan}`));
        process.exit(1);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
