/**
 * Verifikasi konsistensi data absensi dari hulu ke hilir.
 * Jalankan: node scripts/absensi-konsistensi.mjs
 *
 * Menggunakan Management API dengan query langsung ke tabel (bukan SECURITY DEFINER RPC)
 * karena auth.uid() tidak bisa di-set dari Management API (jebakan injeksi_via_service_key).
 *
 * Check:
 *   C1: pivot per-kelas (fn_attendance_recap_per_class logic) vs aggregate per-kelas dari pivot per-siswa
 *       → deteksi siswa dengan absensi yang tidak terdaftar di kelas (orphan records)
 *   C2: pivot per-kelas vs pivot school-wide total (waka vs TU)
 *   C3: pivot per-siswa di kelas ≤ pivot per-siswa di rekap kelas
 *   C4: 12× pivot per-bulan vs pivot full tahun (Excel Wali — tidak ada data hilang antar bulan)
 *   C5: pivot school-wide path-A (per-class SUM) vs path-B (per-student SUM ke kelas)
 *       → deteksi perbedaan fn_attendance_recap_per_class vs fn_class_attendance_summary
 */

import fs from 'fs';

const envRaw = fs.readFileSync('.env', 'utf8');
const get = k => (envRaw.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1]?.trim().replace(/^<|>$/g, '');

const SUPABASE_URL = get('SUPABASE_URL');
const SERVICE_KEY  = get('SUPABASE_SERVICE_KEY');
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

function totalHSIA(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((s, r) => ({
    hadir: s.hadir + (+r.hadir || 0),
    sakit: s.sakit + (+r.sakit || 0),
    izin:  s.izin  + (+r.izin  || 0),
    alpa:  s.alpa  + (+r.alpa  || 0),
  }), { hadir: 0, sakit: 0, izin: 0, alpa: 0 });
}

function fmt(t) { return t ? `H:${t.hadir} S:${t.sakit} I:${t.izin} A:${t.alpa}` : 'null'; }

// CTE dasar: status terburuk per (siswa × block_group_id × kelas) dalam rentang
// Identik dengan logika fn_attendance_recap_per_class dan fn_class_attendance_summary
function pivotCTE(school_id, from, to) {
  return `
    WITH att_pivot AS (
      SELECT
        a.student_id,
        ts.class_id,
        ts.block_group_id,
        CASE MAX(CASE a.status::text
          WHEN 'ALPA'  THEN 4
          WHEN 'SAKIT' THEN 3
          WHEN 'IZIN'  THEN 2
          WHEN 'HADIR' THEN 1
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
      GROUP BY a.student_id, ts.class_id, ts.block_group_id
    )
  `;
}

async function cekSekolah(s) {
  console.log(`\n--- ${s.nama} ---`);

  // Ambil kelas pertama yang ada datanya
  let class_id, class_name;
  try {
    const rows = await sql(`
      SELECT DISTINCT c.class_id, c.name
      FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      JOIN classes c ON c.class_id = ts.class_id
      WHERE a.school_id = '${s.school_id}'
        AND a.is_void = false AND a.status IS NOT NULL
      LIMIT 1
    `);
    if (!rows[0]) { log('setup', s.nama, 'SKIP', 'tidak ada data absensi'); return; }
    class_id   = rows[0].class_id;
    class_name = rows[0].name;
  } catch(e) { log('setup', s.nama, 'ERR', `cari kelas: ${e.message}`); return; }

  // C1: pivot dengan semua siswa vs pivot hanya siswa terdaftar di class_members
  // Perbedaan = ada siswa dengan absensi tapi tidak terdaftar di kelas (orphan records)
  try {
    const cte = pivotCTE(s.school_id, P_FROM, P_TO);
    const [pathAll, pathEnrolled] = await Promise.all([
      // Path A: semua siswa yang ada di att_pivot (logika fn_attendance_recap_per_class)
      sql(`${cte}
        SELECT class_id,
          COUNT(*) FILTER (WHERE status = 'HADIR')::int AS hadir,
          COUNT(*) FILTER (WHERE status = 'SAKIT')::int AS sakit,
          COUNT(*) FILTER (WHERE status = 'IZIN') ::int AS izin,
          COUNT(*) FILTER (WHERE status = 'ALPA') ::int AS alpa
        FROM att_pivot WHERE class_id = '${class_id}'
        GROUP BY class_id
      `),
      // Path B: hanya siswa yang terdaftar di class_members (logika fn_class_attendance_summary)
      sql(`${cte}
        SELECT ap.class_id,
          COUNT(*) FILTER (WHERE ap.status = 'HADIR')::int AS hadir,
          COUNT(*) FILTER (WHERE ap.status = 'SAKIT')::int AS sakit,
          COUNT(*) FILTER (WHERE ap.status = 'IZIN') ::int AS izin,
          COUNT(*) FILTER (WHERE ap.status = 'ALPA') ::int AS alpa
        FROM att_pivot ap
        JOIN class_enrollments cm ON cm.student_id = ap.student_id AND cm.class_id = ap.class_id
        WHERE ap.class_id = '${class_id}'
        GROUP BY ap.class_id
      `),
    ]);
    const rA = pathAll[0];
    const rB = pathEnrolled[0];
    if (!rA || !rB) {
      log('C1', s.nama, 'SKIP', `data tidak ditemukan untuk kelas ${class_name}`);
    } else {
      const tA = { hadir: +rA.hadir, sakit: +rA.sakit, izin: +rA.izin, alpa: +rA.alpa };
      const tB = { hadir: +rB.hadir, sakit: +rB.sakit, izin: +rB.izin, alpa: +rB.alpa };
      const cocok = ['hadir','sakit','izin','alpa'].every(f => tA[f] === tB[f]);
      if (cocok) {
        log('C1', s.nama, 'PASS', `semua siswa terdaftar di kelas, tidak ada orphan — ${fmt(tA)} (${class_name})`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => tA[f] !== tB[f]).map(f => `${f}:total=${tA[f]} terdaftar=${tB[f]}`);
        log('C1', s.nama, 'FAIL', `ORPHAN RECORDS — siswa absen tapi tidak di class_members: ${beda.join(' | ')}`);
      }
    }
  } catch(e) { log('C1', s.nama, 'ERR', e.message); }

  // C2: sum per-kelas vs total school-wide (verifikasi tidak ada double-count antar kelas)
  try {
    const cte = pivotCTE(s.school_id, P_FROM, P_TO);
    const [perKelas, schoolWide] = await Promise.all([
      // Path A: per kelas dulu, lalu sum
      sql(`${cte}
        SELECT SUM(hadir)::int as hadir, SUM(sakit)::int as sakit,
               SUM(izin)::int as izin, SUM(alpa)::int as alpa
        FROM (
          SELECT class_id,
            COUNT(*) FILTER (WHERE status='HADIR') as hadir,
            COUNT(*) FILTER (WHERE status='SAKIT') as sakit,
            COUNT(*) FILTER (WHERE status='IZIN')  as izin,
            COUNT(*) FILTER (WHERE status='ALPA')  as alpa
          FROM att_pivot GROUP BY class_id
        ) x
      `),
      // Path B: total school-wide langsung
      sql(`${cte}
        SELECT COUNT(*) FILTER (WHERE status='HADIR')::int AS hadir,
               COUNT(*) FILTER (WHERE status='SAKIT')::int AS sakit,
               COUNT(*) FILTER (WHERE status='IZIN') ::int AS izin,
               COUNT(*) FILTER (WHERE status='ALPA') ::int AS alpa
        FROM att_pivot
      `),
    ]);
    const totPK = perKelas[0];
    const totSW = schoolWide[0];
    if (!totPK || !totSW) {
      log('C2', s.nama, 'SKIP', 'data tidak ditemukan');
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => +totPK[f] === +totSW[f]);
      if (cocok) {
        log('C2', s.nama, 'PASS', `sum per-kelas = total sekolah, tidak ada double-count — H:${totSW.hadir} S:${totSW.sakit} I:${totSW.izin} A:${totSW.alpa}`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => +totPK[f] !== +totSW[f]).map(f => `${f}:kelas=${totPK[f]} total=${totSW[f]}`);
        log('C2', s.nama, 'FAIL', `DOUBLE-COUNT antar kelas: ${beda.join(' | ')}`);
      }
    }
  } catch(e) { log('C2', s.nama, 'ERR', e.message); }

  // C3: pivot per-siswa pertama di kelas ≤ total kelas
  try {
    const siswaRows = await sql(`
      SELECT a.student_id FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE ts.class_id = '${class_id}' AND a.school_id = '${s.school_id}'
        AND a.is_void = false AND a.status IS NOT NULL
      GROUP BY a.student_id LIMIT 1
    `);
    if (!siswaRows[0]) { log('C3', s.nama, 'SKIP', 'tidak ada siswa di kelas ini'); }
    else {
      const student_id = siswaRows[0].student_id;
      const cte = pivotCTE(s.school_id, P_FROM, P_TO);
      const [rowSiswa, rowKelas] = await Promise.all([
        sql(`${cte}
          SELECT COUNT(*) FILTER (WHERE status='HADIR')::int as hadir,
                 COUNT(*) FILTER (WHERE status='SAKIT')::int as sakit,
                 COUNT(*) FILTER (WHERE status='IZIN') ::int as izin,
                 COUNT(*) FILTER (WHERE status='ALPA') ::int as alpa
          FROM att_pivot WHERE student_id = '${student_id}' AND class_id = '${class_id}'
        `),
        sql(`${cte}
          SELECT COUNT(*) FILTER (WHERE status='HADIR')::int as hadir,
                 COUNT(*) FILTER (WHERE status='SAKIT')::int as sakit,
                 COUNT(*) FILTER (WHERE status='IZIN') ::int as izin,
                 COUNT(*) FILTER (WHERE status='ALPA') ::int as alpa
          FROM att_pivot WHERE class_id = '${class_id}'
        `),
      ]);
      const ts = rowSiswa[0], tk = rowKelas[0];
      const totalS = (+ts?.hadir||0) + (+ts?.sakit||0) + (+ts?.izin||0) + (+ts?.alpa||0);
      const totalK = (+tk?.hadir||0) + (+tk?.sakit||0) + (+tk?.izin||0) + (+tk?.alpa||0);
      if (totalS <= totalK) {
        log('C3', s.nama, 'PASS', `siswa (${fmt(ts)}) ≤ kelas (${fmt(tk)})`);
      } else {
        log('C3', s.nama, 'FAIL', `siswa melebihi kelas — anomali: siswa=${totalS} kelas=${totalK}`);
      }
    }
  } catch(e) { log('C3', s.nama, 'ERR', e.message); }

  // C4: 12× bulan vs full tahun (Excel Wali — tidak ada data hilang)
  try {
    const MONTHS = Array.from({ length: 12 }, (_, m) => {
      const year  = m < 6 ? tahun + 1 : tahun;
      const month = m < 6 ? m + 1 : m + 7 - 6;
      const from  = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to    = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;
      return { from, to };
    });

    const monthPromises = MONTHS.map(m => sql(`
      ${pivotCTE(s.school_id, m.from, m.to)}
      SELECT COUNT(*) FILTER (WHERE status='HADIR')::int as hadir,
             COUNT(*) FILTER (WHERE status='SAKIT')::int as sakit,
             COUNT(*) FILTER (WHERE status='IZIN') ::int as izin,
             COUNT(*) FILTER (WHERE status='ALPA') ::int as alpa
      FROM att_pivot WHERE class_id = '${class_id}'
    `));
    const [monthResults, fullResult] = await Promise.all([
      Promise.all(monthPromises),
      sql(`
        ${pivotCTE(s.school_id, P_FROM, P_TO)}
        SELECT COUNT(*) FILTER (WHERE status='HADIR')::int as hadir,
               COUNT(*) FILTER (WHERE status='SAKIT')::int as sakit,
               COUNT(*) FILTER (WHERE status='IZIN') ::int as izin,
               COUNT(*) FILTER (WHERE status='ALPA') ::int as alpa
        FROM att_pivot WHERE class_id = '${class_id}'
      `),
    ]);

    const tot12   = totalHSIA(monthResults.flat());
    const totFull = fullResult[0] ? { hadir: +fullResult[0].hadir, sakit: +fullResult[0].sakit, izin: +fullResult[0].izin, alpa: +fullResult[0].alpa } : null;

    if (!tot12 || !totFull) {
      log('C4', s.nama, 'SKIP', 'data tidak ditemukan');
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => tot12[f] === totFull[f]);
      if (cocok) {
        log('C4', s.nama, 'PASS', `12×bulan = full tahun — ${fmt(totFull)} (${class_name})`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => tot12[f] !== totFull[f]).map(f => `${f}:12bln=${tot12[f]} full=${totFull[f]}`);
        log('C4', s.nama, 'FAIL', `DATA HILANG antar bulan: ${beda.join(' | ')} — cek block_group_id yang melintas bulan`);
      }
    }
  } catch(e) { log('C4', s.nama, 'ERR', e.message); }

  // C5 (PRIORITAS TINGGI): Path fn_attendance_recap_per_class vs fn_class_attendance_summary
  // fn_recap_per_class: pivot per (student × class × block) → GROUP BY class
  // fn_class_summary: pivot per (student × class × block) → GROUP BY student, class → SUM
  // Keduanya harus identik. Perbedaan = orphan records atau bug pivot.
  try {
    const cte = pivotCTE(s.school_id, P_FROM, P_TO);
    const [pathRecap, pathSummary] = await Promise.all([
      // Path A (fn_attendance_recap_per_class): GROUP BY class_id langsung
      sql(`${cte}
        SELECT class_id,
          COUNT(*) FILTER (WHERE status='HADIR')::int as hadir,
          COUNT(*) FILTER (WHERE status='SAKIT')::int as sakit,
          COUNT(*) FILTER (WHERE status='IZIN') ::int as izin,
          COUNT(*) FILTER (WHERE status='ALPA') ::int as alpa
        FROM att_pivot WHERE class_id = '${class_id}'
        GROUP BY class_id
      `),
      // Path B (fn_class_attendance_summary × semua siswa, lalu agregasi):
      // pivot per siswa → GROUP BY student → SUM ke kelas
      sql(`${cte}
        SELECT '${class_id}'::text as class_id,
          SUM(h)::int as hadir, SUM(s)::int as sakit, SUM(i)::int as izin, SUM(a)::int as alpa
        FROM (
          SELECT student_id,
            COUNT(*) FILTER (WHERE status='HADIR') h,
            COUNT(*) FILTER (WHERE status='SAKIT') s,
            COUNT(*) FILTER (WHERE status='IZIN')  i,
            COUNT(*) FILTER (WHERE status='ALPA')  a
          FROM att_pivot WHERE class_id = '${class_id}'
          GROUP BY student_id
        ) x
      `),
    ]);
    const rA = pathRecap[0];
    const rB = pathSummary[0];
    if (!rA || !rB) {
      log('C5', s.nama, 'SKIP', 'data tidak ditemukan');
    } else {
      const tA = { hadir: +rA.hadir, sakit: +rA.sakit, izin: +rA.izin, alpa: +rA.alpa };
      const tB = { hadir: +rB.hadir, sakit: +rB.sakit, izin: +rB.izin, alpa: +rB.alpa };
      const cocok = ['hadir','sakit','izin','alpa'].every(f => tA[f] === tB[f]);
      if (cocok) {
        log('C5', s.nama, 'PASS', `BK Excel: jalur RINGKASAN (recap_per_class) vs per-kelas (class_summary) cocok — ${fmt(tA)}`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => tA[f] !== tB[f]).map(f => `${f}:recap=${tA[f]} summary=${tB[f]}`);
        log('C5', s.nama, 'FAIL', `JALUR BERBEDA TIDAK COCOK — bug di pivot: ${beda.join(' | ')}`);
      }
    }
  } catch(e) { log('C5', s.nama, 'ERR', e.message); }
}

// Cek bug fn_tu_attendance_recap overload (terpisah dari loop sekolah)
async function cekFnTuOverload() {
  console.log('\n--- Cek fn_tu_attendance_recap overload ---');
  try {
    const rows = await sql(`
      SELECT count(*) as n FROM pg_proc
      WHERE proname = 'fn_tu_attendance_recap' AND pronamespace = (
        SELECT oid FROM pg_namespace WHERE nspname = 'public'
      )
    `);
    const n = +(rows[0]?.n || 0);
    if (n === 1) {
      log('fn_tu_overload', 'DB', 'PASS', 'fn_tu_attendance_recap tidak ada overload duplikat');
    } else {
      log('fn_tu_overload', 'DB', 'FAIL', `DITEMUKAN ${n} overload fn_tu_attendance_recap — perlu DROP + CREATE ulang (jebakan create_or_replace_overload)`);
    }
  } catch(e) { log('fn_tu_overload', 'DB', 'ERR', e.message); }
}

async function main() {
  console.log('=== Verifikasi Konsistensi Absensi (Fase 2 — Data Nyata) ===');
  console.log(`Periode: ${P_FROM} s/d ${P_TO}\n`);

  if (!MGMT_TOKEN || !PROJECT_REF) {
    console.error('ERROR: SUPABASE_ACCESS_TOKEN atau PROJECT_REF tidak ada');
    process.exit(1);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await cekFnTuOverload();
  for (const s of SCHOOLS) {
    await cekSekolah(s);
    await sleep(3000);  // hindari rate limit Management API
  }

  const pass = hasil.filter(r => r.status === 'PASS').length;
  const fail = hasil.filter(r => r.status === 'FAIL').length;
  const skip = hasil.filter(r => r.status === 'SKIP').length;
  const err  = hasil.filter(r => r.status === 'ERR').length;

  console.log('\n=== RINGKASAN ===');
  console.log(`PASS: ${pass} | FAIL: ${fail} | SKIP: ${skip} | ERR: ${err}`);

  if (fail > 0 || err > 0) {
    console.log('\nPerlu ditindaklanjuti:');
    hasil.filter(r => r.status === 'FAIL' || r.status === 'ERR')
         .forEach(r => console.log(`  [${r.status}] ${r.check} (${r.sekolah}): ${r.pesan}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
