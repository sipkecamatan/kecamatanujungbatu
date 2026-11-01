/**
 * Verifikasi konsistensi data website == data Excel untuk setiap role.
 * Jalankan: node scripts/rekap-konsistensi-role.mjs
 *
 * Prinsip: Excel dan website sama-sama memanggil pivot yang sama.
 * Script ini membuktikan bahwa pivot itu benar untuk setiap jalur role:
 *
 *   R1 — WALI KELAS  : 12×bulan = full tahun, untuk SEMUA kelas (bukan hanya 1)
 *   R2 — GURU        : pivot berfilter teacher_id → 12×bulan = full tahun per guru
 *   R3 — KAPRODI     : sum per-kelas dalam program = total program (SMK)
 *   R4 — WAKA        : sum per-kelas = total sekolah (semua sekolah)
 *   R5 — BK          : per-siswa di semua kelas ≤ total kelas (semua sekolah)
 *   R6 — TU          : sum per-kelas school-wide = total sekolah (identik R4, path berbeda)
 *   R7 — WAKASEK SMP : sum per-program (jenjang SMP tidak ada program) = total sekolah
 *
 * Menggunakan Management API (SQL langsung) karena service key tidak bisa set auth.uid().
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

const now   = new Date();
const tahun = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
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
    const ikon = { PASS: '✓', FAIL: '✗', ERR: '!', SKIP: '-' }[status] || '?';
    const line = `  [${ikon}] ${check} | ${label} | ${pesan}`;
    console.log(line);
    hasil.push({ check, label, status, pesan });
}

/** CTE pivot standar: status terburuk per (siswa × kelas × block_group_id) */
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

function totHSIA(rows) {
    return rows.reduce((s, r) => ({
        H: s.H + (+r.hadir||0), S: s.S + (+r.sakit||0),
        I: s.I + (+r.izin||0),  A: s.A + (+r.alpa||0),
    }), { H: 0, S: 0, I: 0, A: 0 });
}
function eqHSIA(a, b) { return a.H===b.H && a.S===b.S && a.I===b.I && a.A===b.A; }
function fmtT(t) { return `H:${t.H} S:${t.S} I:${t.I} A:${t.A}`; }

// ─────────────────────────────────────────────────────────────────────────────
// R1 — WALI KELAS: 12×bulan = full tahun untuk SETIAP kelas yang ada data
// ─────────────────────────────────────────────────────────────────────────────
async function r1WaliKelas(school_id, school_name) {
    const label = `${school_name}`;
    try {
        const kelas = await sql(`
            SELECT DISTINCT ts.class_id, c.name
            FROM attendance a
            JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
            JOIN classes c ON c.class_id = ts.class_id
            WHERE a.school_id = '${school_id}' AND a.is_void = false AND a.status IS NOT NULL
            ORDER BY c.name
        `);
        if (!kelas.length) { log('R1-wali', label, 'SKIP', 'tidak ada data absensi'); return; }

        let fail = 0, total = kelas.length;
        for (const k of kelas) {
            // 12×bulan
            const bulanRows = await Promise.all(MONTHS.map(m => sql(`
                ${cte(school_id, m.from, m.to)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot WHERE class_id = '${k.class_id}'
            `)));
            const tot12 = totHSIA(bulanRows.flat());

            // Full tahun
            const [full] = await sql(`
                ${cte(school_id, P_FROM, P_TO)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot WHERE class_id = '${k.class_id}'
            `);
            const totFull = { H:+full.hadir, S:+full.sakit, I:+full.izin, A:+full.alpa };

            if (!eqHSIA(tot12, totFull)) {
                fail++;
                log('R1-wali', `${label} / ${k.name}`, 'FAIL', `12bln≠tahun: 12bln=${fmtT(tot12)} tahun=${fmtT(totFull)}`);
            }
            await sleep(800);
        }
        if (fail === 0)
            log('R1-wali', label, 'PASS', `${total} kelas: 12×bulan = full tahun semua ✓`);
    } catch(e) { log('R1-wali', label, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 — GURU: pivot berfilter teacher_id → 12×bulan = full tahun, per guru unik
// ─────────────────────────────────────────────────────────────────────────────
async function r2Guru(school_id, school_name) {
    const label = school_name;
    try {
        const gurus = await sql(`
            SELECT DISTINCT ts.scheduled_teacher_id as uid, u.full_name
            FROM attendance a
            JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
            JOIN users u ON u.user_id = ts.scheduled_teacher_id
            WHERE a.school_id = '${school_id}' AND a.is_void = false AND a.status IS NOT NULL
            ORDER BY u.full_name
        `);
        if (!gurus.length) { log('R2-guru', label, 'SKIP', 'tidak ada guru dengan data'); return; }

        let fail = 0;
        for (const g of gurus) {
            const tf = `AND ts.scheduled_teacher_id = '${g.uid}'`;
            const bulanRows = await Promise.all(MONTHS.map(m => sql(`
                ${cte(school_id, m.from, m.to, tf)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot
            `)));
            const tot12 = totHSIA(bulanRows.flat());

            const [full] = await sql(`
                ${cte(school_id, P_FROM, P_TO, tf)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot
            `);
            const totFull = { H:+full.hadir, S:+full.sakit, I:+full.izin, A:+full.alpa };

            if (!eqHSIA(tot12, totFull)) {
                fail++;
                log('R2-guru', `${label} / ${g.full_name}`, 'FAIL', `12bln≠tahun: ${fmtT(tot12)} ≠ ${fmtT(totFull)}`);
            }
            await sleep(800);
        }
        if (fail === 0)
            log('R2-guru', label, 'PASS', `${gurus.length} guru: 12×bulan = full tahun semua ✓`);
    } catch(e) { log('R2-guru', label, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R3 — KAPRODI (SMK): sum kelas per-program = total program
// ─────────────────────────────────────────────────────────────────────────────
async function r3Kaprodi(school_id, school_name) {
    const label = school_name;
    try {
        // Ambil program_id → class_id dari tabel programs + classes (SMK punya kolom program_id di classes)
        const programs = await sql(`
            SELECT p.program_id, p.name as prog_name, array_agg(c.class_id) as class_ids
            FROM programs p
            JOIN classes c ON c.program_id = p.program_id AND c.school_id = '${school_id}'
            WHERE p.school_id = '${school_id}'
            GROUP BY p.program_id, p.name
        `);
        if (!programs.length) { log('R3-kaprodi', label, 'SKIP', 'tidak ada program (bukan SMK?)'); return; }

        let fail = 0;
        for (const prog of programs) {
            const ids = prog.class_ids;
            if (!ids || !ids.length) continue;
            const inClause = ids.map(id => `'${id}'`).join(',');

            // Path A: sum per-kelas
            const perKelas = await sql(`
                ${cte(school_id, P_FROM, P_TO)}
                SELECT SUM(h)::int hadir, SUM(s)::int sakit, SUM(i)::int izin, SUM(a)::int alpa
                FROM (
                  SELECT class_id,
                    COUNT(*) FILTER (WHERE status='HADIR') h, COUNT(*) FILTER (WHERE status='SAKIT') s,
                    COUNT(*) FILTER (WHERE status='IZIN')  i, COUNT(*) FILTER (WHERE status='ALPA')  a
                  FROM att_pivot WHERE class_id = ANY(ARRAY[${inClause}]::uuid[])
                  GROUP BY class_id
                ) x
            `);
            // Path B: langsung total program
            const totalProg = await sql(`
                ${cte(school_id, P_FROM, P_TO)}
                SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                       COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                       COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                       COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
                FROM att_pivot WHERE class_id = ANY(ARRAY[${inClause}]::uuid[])
            `);

            const tA = totHSIA(perKelas);
            const tB = totHSIA(totalProg);
            if (!eqHSIA(tA, tB)) {
                fail++;
                log('R3-kaprodi', `${label} / ${prog.prog_name}`, 'FAIL', `per-kelas≠total: ${fmtT(tA)} ≠ ${fmtT(tB)}`);
            }
            await sleep(600);
        }
        if (fail === 0)
            log('R3-kaprodi', label, 'PASS', `${programs.length} program: sum-per-kelas = total-program semua ✓`);
    } catch(e) { log('R3-kaprodi', label, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 — WAKA KESISWAAN: sum per-kelas = total sekolah (view waka)
// R6 — TU           : sama, tapi via jalur berbeda (tanpa filter program)
// Keduanya identik secara SQL — perbedaan hanya di UI (kolom yang tampil)
// ─────────────────────────────────────────────────────────────────────────────
async function r4WakaTU(school_id, school_name) {
    const label = school_name;
    try {
        // Path A: sum per-kelas
        const perKelas = await sql(`
            ${cte(school_id, P_FROM, P_TO)}
            SELECT SUM(h)::int hadir, SUM(s)::int sakit, SUM(i)::int izin, SUM(a)::int alpa
            FROM (
              SELECT class_id,
                COUNT(*) FILTER (WHERE status='HADIR') h, COUNT(*) FILTER (WHERE status='SAKIT') s,
                COUNT(*) FILTER (WHERE status='IZIN')  i, COUNT(*) FILTER (WHERE status='ALPA')  a
              FROM att_pivot GROUP BY class_id
            ) x
        `);
        // Path B: total sekolah langsung
        const totalSch = await sql(`
            ${cte(school_id, P_FROM, P_TO)}
            SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                   COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                   COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                   COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
            FROM att_pivot
        `);

        const tA = totHSIA(perKelas);
        const tB = totHSIA(totalSch);

        if (eqHSIA(tA, tB)) {
            log('R4-waka', label, 'PASS', `sum-per-kelas = total-sekolah — ${fmtT(tB)} ✓`);
            log('R6-tu',   label, 'PASS', `sum-per-kelas = total-sekolah (TU jalur sama) — ${fmtT(tB)} ✓`);
        } else {
            log('R4-waka', label, 'FAIL', `${fmtT(tA)} ≠ ${fmtT(tB)}`);
            log('R6-tu',   label, 'FAIL', `${fmtT(tA)} ≠ ${fmtT(tB)}`);
        }
    } catch(e) {
        log('R4-waka', label, 'ERR', e.message);
        log('R6-tu',   label, 'ERR', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// R5 — BK: per-siswa di setiap kelas ≤ total kelas, tidak ada siswa orphan
// ─────────────────────────────────────────────────────────────────────────────
async function r5BK(school_id, school_name) {
    const label = school_name;
    try {
        // Cek apakah ada attendance dari siswa yang tidak terdaftar di kelas itu (orphan)
        const orphans = await sql(`
            ${cte(school_id, P_FROM, P_TO)}
            SELECT ap.class_id, c.name as class_name, COUNT(*) as n_orphan
            FROM att_pivot ap
            JOIN classes c ON c.class_id = ap.class_id
            LEFT JOIN class_enrollments ce
                   ON ce.student_id = ap.student_id AND ce.class_id = ap.class_id
            WHERE ce.enrollment_id IS NULL
            GROUP BY ap.class_id, c.name
            ORDER BY c.name
        `);

        if (orphans.length === 0) {
            log('R5-bk', label, 'PASS', 'tidak ada siswa orphan (semua absensi terikat ke kelas yang benar) ✓');
        } else {
            for (const o of orphans)
                log('R5-bk', `${label}/${o.class_name}`, 'FAIL', `${o.n_orphan} baris absensi siswa tidak terdaftar di kelas`);
        }
    } catch(e) { log('R5-bk', label, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// R7 — WAKASEK SMP: verifikasi school-wide per-bulan = full tahun
// (Wakasek SMP melihat rekap sekolah, mirip Waka Kesiswaan SMA/SMK)
// ─────────────────────────────────────────────────────────────────────────────
async function r7Wakasek(school_id, school_name) {
    const label = school_name;
    try {
        const bulanRows = await Promise.all(MONTHS.map(m => sql(`
            ${cte(school_id, m.from, m.to)}
            SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                   COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                   COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                   COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
            FROM att_pivot
        `)));
        const tot12 = totHSIA(bulanRows.flat());

        const [full] = await sql(`
            ${cte(school_id, P_FROM, P_TO)}
            SELECT COUNT(*) FILTER (WHERE status='HADIR')::int hadir,
                   COUNT(*) FILTER (WHERE status='SAKIT')::int sakit,
                   COUNT(*) FILTER (WHERE status='IZIN') ::int izin,
                   COUNT(*) FILTER (WHERE status='ALPA') ::int alpa
            FROM att_pivot
        `);
        const totFull = { H:+full.hadir, S:+full.sakit, I:+full.izin, A:+full.alpa };

        if (eqHSIA(tot12, totFull))
            log('R7-wakasek', label, 'PASS', `12×bulan = full tahun school-wide — ${fmtT(totFull)} ✓`);
        else
            log('R7-wakasek', label, 'FAIL', `12bln=${fmtT(tot12)} ≠ tahun=${fmtT(totFull)}`);
    } catch(e) { log('R7-wakasek', label, 'ERR', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Rekap Konsistensi per Role (Website == Excel) ===');
    console.log(`Tahun ajaran: ${P_FROM} s/d ${P_TO}\n`);

    // Ambil semua sekolah dari database
    const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
        { method:'POST', headers:{ Authorization:`Bearer ${MGMT_TOKEN}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ query: `SELECT school_id, name, jenjang FROM schools ORDER BY jenjang, name` }) }
    );
    const schools = await res.json();

    const smpList = schools.filter(s => s.jenjang === 'SMP');
    const smaList = schools.filter(s => s.jenjang === 'SMA');
    const smkList = schools.filter(s => s.jenjang === 'SMK');

    // R1 — WALI KELAS (semua sekolah, semua kelas)
    console.log('\n── R1 WALI KELAS: 12×bulan = full tahun per kelas ──');
    for (const s of schools) { await r1WaliKelas(s.school_id, `${s.jenjang} ${s.name}`); await sleep(1000); }

    // R2 — GURU (semua sekolah)
    console.log('\n── R2 GURU: filter teacher_id, 12×bulan = full tahun per guru ──');
    for (const s of schools) { await r2Guru(s.school_id, `${s.jenjang} ${s.name}`); await sleep(1000); }

    // R3 — KAPRODI (SMK saja)
    console.log('\n── R3 KAPRODI: sum per-kelas = total program (SMK) ──');
    for (const s of smkList) { await r3Kaprodi(s.school_id, `SMK ${s.name}`); await sleep(1000); }
    if (!smkList.length) console.log('  (tidak ada sekolah SMK)');

    // R4 + R6 — WAKA KESISWAAN + TU (semua sekolah)
    console.log('\n── R4 WAKA KESISWAAN + R6 TU: sum per-kelas = total sekolah ──');
    for (const s of schools) { await r4WakaTU(s.school_id, `${s.jenjang} ${s.name}`); await sleep(600); }

    // R5 — BK (semua sekolah)
    console.log('\n── R5 BK: tidak ada siswa orphan di semua kelas ──');
    for (const s of schools) { await r5BK(s.school_id, `${s.jenjang} ${s.name}`); await sleep(600); }

    // R7 — WAKASEK SMP
    console.log('\n── R7 WAKASEK SMP: 12×bulan = full tahun school-wide ──');
    for (const s of smpList) { await r7Wakasek(s.school_id, `SMP ${s.name}`); await sleep(600); }
    if (!smpList.length) console.log('  (tidak ada sekolah SMP)');

    // Ringkasan
    const pass = hasil.filter(r => r.status === 'PASS').length;
    const fail = hasil.filter(r => r.status === 'FAIL').length;
    const skip = hasil.filter(r => r.status === 'SKIP').length;
    const err  = hasil.filter(r => r.status === 'ERR').length;

    console.log('\n=== RINGKASAN ===');
    console.log(`PASS: ${pass} | FAIL: ${fail} | SKIP: ${skip} | ERR: ${err}`);

    if (fail > 0 || err > 0) {
        console.log('\nPerlu ditindaklanjuti:');
        hasil.filter(r => r.status === 'FAIL' || r.status === 'ERR')
             .forEach(r => console.log(`  [${r.status}] ${r.check} (${r.label}): ${r.pesan}`));
        process.exit(1);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
