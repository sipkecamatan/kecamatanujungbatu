/**
 * Verifikasi konsistensi data absensi portal (siswa/ortu) vs sisi guru/wali.
 * Jalankan: node scripts/portal-konsistensi.mjs
 *
 * Jalur yang dibandingkan:
 *   PORTAL  — replikasi logika shared/attendance-pivot.js (pivotAttendanceBlocks):
 *             per (student × block_group_id): summary_status = status tunggal jika semua slot sama,
 *             CAMPURAN jika berbeda. Hanya HADIR/SAKIT/IZIN/ALPA dihitung; CAMPURAN diabaikan.
 *             EKSKUL dipetakan ke HADIR sebelum cek keunikan.
 *
 *   SUMMARY — replikasi logika fn_class_attendance_summary:
 *             per (student × block_group_id): ambil status TERBURUK
 *             (ALPA=4 > SAKIT=3 > IZIN=2 > HADIR/EKSKUL=1).
 *             CAMPURAN tidak mungkin muncul.
 *
 * Check:
 *   CP1: total H/S/I/A sekolah — portal vs summary (deteksi beda agregat)
 *   CP2: deteksi blok CAMPURAN (satu siswa + satu block punya ≥2 status beda)
 *        → hanya blok CAMPURAN ini yang menyebabkan selisih CP1
 *   CP3: per-siswa mismatch — berapa siswa yang angkanya berbeda di dua jalur
 */

import fs from 'fs';

const envRaw = fs.readFileSync('.env', 'utf8');
const get = k => (envRaw.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1]?.trim().replace(/^<|>$/g, '');

const SUPABASE_URL = get('SUPABASE_URL');
const MGMT_TOKEN   = get('SUPABASE_ACCESS_TOKEN');
const PROJECT_REF  = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];

const SCHOOLS = [
  { nama: 'SMK Uji 1', school_id: '5d67c321-ec65-4ecb-b1d3-672ce7628a17' },
  { nama: 'SMA Uji 1', school_id: 'a41a1f24-3ed2-464e-8e06-754f4dfd3c1f' },
  { nama: 'SMP Uji 1', school_id: '4ba66164-4f9d-4973-9afe-cf7e473ef91b' },
];

const now   = new Date();
const tahun = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const P_FROM = `${tahun}-07-01`;
const P_TO   = `${tahun + 1}-06-30`;

const hasil = [];

function log(check, sekolah, status, pesan) {
  const ikon = { PASS: '✓', FAIL: '✗', ERR: '!', SKIP: '-' }[status] || '?';
  console.log(`  [${ikon}] ${check} | ${sekolah} | ${pesan}`);
  hasil.push({ check, sekolah, status, pesan });
}

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

function fmt(r) {
  if (!r) return 'null';
  return `H:${r.hadir} S:${r.sakit} I:${r.izin} A:${r.alpa}`;
}

/**
 * CTE portal: replikasi pivotAttendanceBlocks di SQL.
 * EKSKUL → HADIR sebelum cek keunikan status.
 * summary_status = CAMPURAN jika ≥2 status berbeda dalam satu (student × block).
 * Hitung hanya HADIR/SAKIT/IZIN/ALPA; CAMPURAN diabaikan (sama persis dengan klien).
 */
function portalAggregateCTE(school_id, from, to) {
  return `
    WITH raw AS (
      SELECT
        a.student_id,
        ts.block_group_id,
        CASE WHEN a.status::text = 'EKSKUL' THEN 'HADIR' ELSE a.status::text END AS eff_status
      FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE a.school_id = '${school_id}'
        AND ts.session_date BETWEEN '${from}'::date AND '${to}'::date
        AND a.is_void = false
        AND a.status IS NOT NULL
    ),
    pivot AS (
      SELECT
        student_id,
        block_group_id,
        CASE WHEN COUNT(DISTINCT eff_status) = 1
             THEN MAX(eff_status)
             ELSE 'CAMPURAN'
        END AS summary_status
      FROM raw
      GROUP BY student_id, block_group_id
    ),
    per_student AS (
      SELECT
        student_id,
        COUNT(*) FILTER (WHERE summary_status = 'HADIR')::int    AS hadir,
        COUNT(*) FILTER (WHERE summary_status = 'SAKIT')::int    AS sakit,
        COUNT(*) FILTER (WHERE summary_status = 'IZIN') ::int    AS izin,
        COUNT(*) FILTER (WHERE summary_status = 'ALPA') ::int    AS alpa,
        COUNT(*) FILTER (WHERE summary_status = 'CAMPURAN')::int AS campuran
      FROM pivot
      GROUP BY student_id
    )
  `;
}

/**
 * CTE summary: replikasi fn_class_attendance_summary di SQL.
 * Per (student × block): ambil status TERBURUK (ALPA > SAKIT > IZIN > HADIR/EKSKUL).
 */
function summaryAggregateCTE(school_id, from, to) {
  return `
    WITH pivot AS (
      SELECT
        a.student_id,
        ts.block_group_id,
        CASE MAX(CASE a.status::text
          WHEN 'ALPA'   THEN 4
          WHEN 'SAKIT'  THEN 3
          WHEN 'IZIN'   THEN 2
          WHEN 'HADIR'  THEN 1
          WHEN 'EKSKUL' THEN 1
          ELSE 0 END)
          WHEN 4 THEN 'ALPA'
          WHEN 3 THEN 'SAKIT'
          WHEN 2 THEN 'IZIN'
          WHEN 1 THEN 'HADIR'
        END AS status
      FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE a.school_id = '${school_id}'
        AND ts.session_date BETWEEN '${from}'::date AND '${to}'::date
        AND a.is_void = false
        AND a.status IS NOT NULL
      GROUP BY a.student_id, ts.block_group_id
    ),
    per_student AS (
      SELECT
        student_id,
        COUNT(*) FILTER (WHERE status = 'HADIR')::int AS hadir,
        COUNT(*) FILTER (WHERE status = 'SAKIT')::int AS sakit,
        COUNT(*) FILTER (WHERE status = 'IZIN') ::int AS izin,
        COUNT(*) FILTER (WHERE status = 'ALPA') ::int AS alpa
      FROM pivot
      WHERE status IS NOT NULL
      GROUP BY student_id
    )
  `;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cekSekolah(s) {
  console.log(`\n--- ${s.nama} ---`);

  // Cek apakah ada data absensi
  let total;
  try {
    const rows = await sql(`
      SELECT COUNT(*) AS n FROM attendance
      WHERE school_id = '${s.school_id}' AND is_void = false AND status IS NOT NULL
    `);
    total = +(rows[0]?.n || 0);
    if (total === 0) { log('CP1', s.nama, 'SKIP', 'tidak ada data absensi'); return; }
  } catch(e) { log('CP1', s.nama, 'ERR', `cek data: ${e.message}`); return; }

  await sleep(2500);

  // CP1: total H/S/I/A seluruh sekolah — portal vs summary
  try {
    const [portalRows, summaryRows] = await Promise.all([
      sql(`
        ${portalAggregateCTE(s.school_id, P_FROM, P_TO)}
        SELECT
          SUM(hadir)::int AS hadir, SUM(sakit)::int AS sakit,
          SUM(izin)::int  AS izin,  SUM(alpa)::int  AS alpa,
          SUM(campuran)::int AS campuran
        FROM per_student
      `),
      sql(`
        ${summaryAggregateCTE(s.school_id, P_FROM, P_TO)}
        SELECT
          SUM(hadir)::int AS hadir, SUM(sakit)::int AS sakit,
          SUM(izin)::int  AS izin,  SUM(alpa)::int  AS alpa
        FROM per_student
      `),
    ]);
    const p = portalRows[0];
    const su = summaryRows[0];
    if (!p || !su) {
      log('CP1', s.nama, 'SKIP', 'data tidak ditemukan');
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => +p[f] === +su[f]);
      if (cocok) {
        log('CP1', s.nama, 'PASS', `portal = summary — ${fmt(p)}${+p.campuran > 0 ? ` (+${p.campuran} blok CAMPURAN diabaikan portal)` : ''}`);
      } else {
        const beda = ['hadir','sakit','izin','alpa']
          .filter(f => +p[f] !== +su[f])
          .map(f => `${f}:portal=${p[f]} summary=${su[f]}`);
        log('CP1', s.nama, 'FAIL', `BEDA TOTAL — ${beda.join(' | ')}${+p.campuran > 0 ? ` (${p.campuran} blok CAMPURAN diabaikan portal)` : ''}`);
      }
    }
  } catch(e) { log('CP1', s.nama, 'ERR', e.message); }

  await sleep(2500);

  // CP2: deteksi blok CAMPURAN — satu siswa + satu block punya ≥2 status berbeda
  // Ini adalah SUMBER SATU-SATUNYA selisih antara portal dan summary.
  try {
    const rows = await sql(`
      WITH raw AS (
        SELECT
          a.student_id,
          ts.block_group_id,
          CASE WHEN a.status::text = 'EKSKUL' THEN 'HADIR' ELSE a.status::text END AS eff_status
        FROM attendance a
        JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
        WHERE a.school_id = '${s.school_id}'
          AND ts.session_date BETWEEN '${P_FROM}'::date AND '${P_TO}'::date
          AND a.is_void = false
          AND a.status IS NOT NULL
      )
      SELECT
        student_id, block_group_id,
        COUNT(DISTINCT eff_status) AS jml_status,
        STRING_AGG(DISTINCT eff_status, '/' ORDER BY eff_status) AS status_list
      FROM raw
      GROUP BY student_id, block_group_id
      HAVING COUNT(DISTINCT eff_status) > 1
      LIMIT 20
    `);
    if (rows.length === 0) {
      log('CP2', s.nama, 'PASS', 'tidak ada blok CAMPURAN — semua block_group_id konsisten per siswa');
    } else {
      const contoh = rows.slice(0, 3).map(r => `student=${r.student_id.slice(0,8)}… block=${r.block_group_id.slice(0,8)}… status=[${r.status_list}]`).join(' | ');
      log('CP2', s.nama, 'FAIL', `${rows.length} blok CAMPURAN ditemukan (maks 20 ditampilkan) — contoh: ${contoh}`);
    }
  } catch(e) { log('CP2', s.nama, 'ERR', e.message); }

  await sleep(2500);

  // CP3: per-siswa mismatch — berapa siswa angkanya berbeda di dua jalur
  try {
    const rows = await sql(`
      ${portalAggregateCTE(s.school_id, P_FROM, P_TO)}
      , summary_cte AS (
        ${summaryAggregateCTE(s.school_id, P_FROM, P_TO).replace(/^\s*WITH\s+/i, '')}
      )
      SELECT
        COUNT(*) FILTER (
          WHERE p.hadir <> COALESCE(su.hadir, 0)
             OR p.sakit <> COALESCE(su.sakit, 0)
             OR p.izin  <> COALESCE(su.izin,  0)
             OR p.alpa  <> COALESCE(su.alpa,  0)
        )::int AS mismatch,
        COUNT(*)::int AS total_siswa
      FROM per_student p
      FULL OUTER JOIN summary_cte.per_student su USING (student_id)
    `);
    const r = rows[0];
    if (!r) {
      log('CP3', s.nama, 'SKIP', 'data tidak ditemukan');
    } else if (+r.mismatch === 0) {
      log('CP3', s.nama, 'PASS', `semua ${r.total_siswa} siswa cocok di dua jalur`);
    } else {
      log('CP3', s.nama, 'FAIL', `${r.mismatch} dari ${r.total_siswa} siswa BERBEDA antara portal dan summary`);
    }
  } catch(e) {
    // Fallback: CP3 pakai JOIN eksplisit tanpa nested CTE name conflict
    try {
      const rows = await sql(`
        WITH portal AS (
          ${portalAggregateCTE(s.school_id, P_FROM, P_TO).replace(/^\s*WITH\s+/i, '')}
          SELECT student_id, hadir AS p_h, sakit AS p_s, izin AS p_i, alpa AS p_a
          FROM per_student
        ),
        summary AS (
          ${summaryAggregateCTE(s.school_id, P_FROM, P_TO).replace(/^\s*WITH\s+/i, '')}
          SELECT student_id, hadir AS s_h, sakit AS s_s, izin AS s_i, alpa AS s_a
          FROM per_student
        )
        SELECT
          COUNT(*) FILTER (
            WHERE p_h <> COALESCE(s_h, 0) OR p_s <> COALESCE(s_s, 0)
               OR p_i <> COALESCE(s_i, 0) OR p_a <> COALESCE(s_a, 0)
          )::int AS mismatch,
          COUNT(*)::int AS total_siswa
        FROM portal
        FULL OUTER JOIN summary USING (student_id)
      `);
      const r = rows[0];
      if (!r) {
        log('CP3', s.nama, 'SKIP', 'data tidak ditemukan');
      } else if (+r.mismatch === 0) {
        log('CP3', s.nama, 'PASS', `semua ${r.total_siswa} siswa cocok di dua jalur`);
      } else {
        log('CP3', s.nama, 'FAIL', `${r.mismatch} dari ${r.total_siswa} siswa BERBEDA antara portal dan summary`);
      }
    } catch(e2) { log('CP3', s.nama, 'ERR', e2.message); }
  }
}

async function main() {
  console.log('=== Verifikasi Konsistensi Portal (siswa/ortu) vs Guru/Wali ===');
  console.log(`Periode: ${P_FROM} s/d ${P_TO}\n`);
  console.log('Jalur dibandingkan:');
  console.log('  PORTAL  — pivot per block_group_id: status tunggal atau CAMPURAN (diabaikan), EKSKUL→HADIR');
  console.log('  SUMMARY — fn_class_attendance_summary: status TERBURUK per block_group_id\n');

  if (!MGMT_TOKEN || !PROJECT_REF) {
    console.error('ERROR: SUPABASE_ACCESS_TOKEN atau SUPABASE_URL tidak ada di .env');
    process.exit(1);
  }

  for (const s of SCHOOLS) {
    await cekSekolah(s);
    await sleep(3000);
  }

  const pass = hasil.filter(r => r.status === 'PASS').length;
  const fail = hasil.filter(r => r.status === 'FAIL').length;
  const skip = hasil.filter(r => r.status === 'SKIP').length;
  const err  = hasil.filter(r => r.status === 'ERR').length;

  console.log('\n=== RINGKASAN ===');
  console.log(`PASS: ${pass} | FAIL: ${fail} | SKIP: ${skip} | ERR: ${err}`);

  if (fail > 0) {
    console.log('\nCatatan interpretasi FAIL:');
    console.log('  CP1 FAIL + CP2 FAIL: selisih total disebabkan blok CAMPURAN yang diabaikan portal');
    console.log('  CP1 FAIL + CP2 PASS: bug pivot di salah satu jalur (investigasi lebih lanjut)');
    console.log('  CP2 FAIL: blok CAMPURAN ada — satu siswa punya ≥2 status di satu pertemuan');
    console.log('            → cek apakah ini data valid atau anomali input');
  }

  if (fail > 0 || err > 0) {
    console.log('\nPerlu ditindaklanjuti:');
    hasil.filter(r => r.status === 'FAIL' || r.status === 'ERR')
         .forEach(r => console.log(`  [${r.status}] ${r.check} (${r.sekolah}): ${r.pesan}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
