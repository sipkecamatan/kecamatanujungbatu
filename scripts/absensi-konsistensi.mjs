/**
 * Verifikasi konsistensi data absensi dari hulu ke hilir.
 * Jalankan: node scripts/absensi-konsistensi.mjs
 *
 * Fase 2 (data nyata, read-only): bandingkan angka antar fungsi SQL.
 * Pembuktian dilakukan via Management API (asUser pattern dari tenant-isolation.mjs).
 *
 * Check:
 *   C1: fn_attendance_recap_per_class vs fn_class_attendance_summary (waka vs guru/wali)
 *   C2: fn_attendance_recap_per_class vs fn_tu_attendance_recap (waka vs TU)
 *   C3: fn_portal_attendance per siswa vs fn_class_attendance_summary (siswa vs rekap kelas)
 *   C4: Excel Wali — fn_class_attendance_summary 12× bulan vs full tahun
 *   C5: Excel BK — fn_attendance_recap_per_class vs fn_class_attendance_summary (jalur berbeda)
 */

import fs from 'fs';

// === Baca .env ===
const envRaw = fs.readFileSync('.env', 'utf8');
const get = k => (envRaw.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1]?.trim().replace(/^<|>$/g, '');

const SUPABASE_URL  = get('SUPABASE_URL');
const SERVICE_KEY   = get('SUPABASE_SERVICE_KEY');
const MGMT_TOKEN    = get('SUPABASE_ACCESS_TOKEN');  // sbp_... personal access token
const PROJECT_REF   = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];

// Sekolah uji
const SCHOOLS = [
  { nama: 'SMK Uji 1', school_id: '5d67c321-ec65-4ecb-b1d3-672ce7628a17', slug: 'smkuji1', guru_env: 'UJI_SMK_GURU', bk_env: 'UJI_SMK_BK', waka_env: 'UJI_SMK_WAKA_KESISWAAN', siswa_env: 'UJI_SMK_SISWA' },
  { nama: 'SMA Uji 1', school_id: 'a41a1f24-3ed2-464e-8e06-754f4dfd3c1f', slug: 'smauji1', guru_env: 'UJI_SMA_GURU', bk_env: 'UJI_SMA_BK', waka_env: 'UJI_SMA_WAKA_KESISWAAN', siswa_env: 'UJI_SMA_SISWA' },
  { nama: 'SMP Uji 1', school_id: '4ba66164-4f9d-4973-9afe-cf7e473ef91b', slug: 'smpuji1', guru_env: 'UJI_SMP_GURU', bk_env: 'UJI_SMP_BK', waka_env: 'UJI_SMP_WAKA_KESISWAAN', siswa_env: 'UJI_SMP_SISWA' },
];

// Periode: tahun ajaran saat ini (Jul tahun lalu s/d Jun tahun ini)
const now   = new Date();
const tahun = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const P_FROM = `${tahun}-07-01`;
const P_TO   = `${tahun + 1}-06-30`;

const hasil = [];

function log(check, sekolah, status, pesan) {
  const ikon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'ERR' ? '!' : '-';
  console.log(`  [${ikon}] ${check} | ${sekolah} | ${pesan}`);
  hasil.push({ check, sekolah, status, pesan });
}

// === Management API query (asUser pattern) ===
async function asUser(email, sql) {
  if (!MGMT_TOKEN || !PROJECT_REF) throw new Error('SUPABASE_ACCESS_TOKEN atau PROJECT_REF tidak tersedia');

  const { rows } = await fetchMgmt(sql, { user_email: email });
  return rows;
}

async function fetchMgmt(sql, opts = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MGMT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;  // { rows: [...] }
}

// Ambil user_id dari email
async function getUserId(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const json = await res.json();
  return json?.users?.[0]?.id || null;
}

// Ambil kelas pertama dengan data absensi di sekolah ini
async function ambilKelasData(school_id) {
  const rows = await fetchMgmt(`
    SELECT DISTINCT c.class_id, c.name
    FROM attendance a
    JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
    JOIN classes c ON c.class_id = ts.class_id
    WHERE a.school_id = '${school_id}'
      AND a.is_void = false
      AND a.status IS NOT NULL
    LIMIT 1
  `);
  return rows?.rows?.[0] || null;
}

// Ambil satu siswa dari kelas ini
async function ambilSiswa(class_id) {
  const rows = await fetchMgmt(`
    SELECT u.user_id, u.full_name, u.email
    FROM class_members cm
    JOIN users u ON u.user_id = cm.student_id
    WHERE cm.class_id = '${class_id}'
    LIMIT 1
  `);
  return rows?.rows?.[0] || null;
}

// fn_attendance_recap_per_class — dipanggil sebagai waka/BK
async function getRecapPerClass(userEmail, school_id) {
  const userId = await getUserId(userEmail);
  if (!userId) return null;
  const sql = `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SELECT class_id, name, hadir, alpa, izin, sakit
    FROM fn_attendance_recap_per_class('${P_FROM}'::date, '${P_TO}'::date)
    WHERE school_id IS NOT DISTINCT FROM '${school_id}'::uuid
       OR school_id IS NULL;
    ROLLBACK;
  `;
  // Management API kembalikan hasil SELECT terakhir sebelum ROLLBACK
  return fetchMgmt(sql);
}

// fn_class_attendance_summary — dipanggil sebagai guru/wali
async function getClassSummary(userEmail, class_id) {
  const userId = await getUserId(userEmail);
  if (!userId) return null;
  const sql = `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SELECT student_id, hadir, alpa, izin, sakit
    FROM fn_class_attendance_summary('${class_id}'::uuid, NULL::text, '${P_FROM}'::date, '${P_TO}'::date, NULL::uuid, NULL::semester);
    ROLLBACK;
  `;
  return fetchMgmt(sql);
}

// fn_tu_attendance_recap — dipanggil sebagai TU
async function getTuRecap(tuEmail) {
  const userId = await getUserId(tuEmail);
  if (!userId) return null;
  const sql = `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SELECT hadir, alpa, izin, sakit
    FROM fn_tu_attendance_recap('${P_FROM}'::date, '${P_TO}'::date);
    ROLLBACK;
  `;
  return fetchMgmt(sql);
}

// fn_portal_attendance — dipanggil sebagai siswa
async function getPortalAttendance(siswaEmail) {
  const userId = await getUserId(siswaEmail);
  if (!userId) return null;
  const sql = `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SELECT fn_portal_attendance('${userId}'::uuid, '${P_FROM}'::date, '${P_TO}'::date) as data;
    ROLLBACK;
  `;
  return fetchMgmt(sql);
}

// Jumlahkan semua baris dari rows
function totalHSIA(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((s, r) => ({
    hadir: s.hadir + (parseInt(r.hadir) || 0),
    sakit: s.sakit + (parseInt(r.sakit) || 0),
    izin:  s.izin  + (parseInt(r.izin)  || 0),
    alpa:  s.alpa  + (parseInt(r.alpa)  || 0),
  }), { hadir: 0, sakit: 0, izin: 0, alpa: 0 });
}

function fmt(t) { return t ? `H:${t.hadir} S:${t.sakit} I:${t.izin} A:${t.alpa}` : 'null'; }

// === Cek per sekolah ===
async function cekSekolah(s) {
  console.log(`\n--- ${s.nama} ---`);

  const wakaEmail = get(s.waka_env);
  const guruEmail = get(s.guru_env);
  const bkEmail   = get(s.bk_env);
  const siswaEmail = get(s.siswa_env);
  const tuEnvKey  = s.waka_env.replace('WAKA_KESISWAAN', 'TU');
  const tuEmail   = get(tuEnvKey);

  // Cari kelas dengan data absensi
  let kelasData;
  try {
    const res = await ambilKelasData(s.school_id);
    kelasData = res;
  } catch(e) { log('setup', s.nama, 'ERR', `gagal cari kelas: ${e.message}`); return; }
  if (!kelasData) { log('setup', s.nama, 'SKIP', 'tidak ada data absensi'); return; }
  const { class_id, name: class_name } = kelasData;

  // === C1: fn_attendance_recap_per_class (waka) vs fn_class_attendance_summary (guru/wali) ===
  try {
    const [recapRes, summaryRes] = await Promise.all([
      wakaEmail ? getRecapPerClass(wakaEmail, s.school_id) : null,
      guruEmail ? getClassSummary(guruEmail, class_id) : null,
    ]);

    const recapRows   = recapRes?.rows;
    const summaryRows = summaryRes?.rows;
    const rowRecap    = Array.isArray(recapRows)   ? recapRows.find(r => r.class_id === class_id || r.name === class_name) : null;
    const totSummary  = totalHSIA(summaryRows);
    const totRecap    = rowRecap ? { hadir: +rowRecap.hadir, sakit: +rowRecap.sakit, izin: +rowRecap.izin, alpa: +rowRecap.alpa } : null;

    if (!totRecap || !totSummary) {
      log('C1', s.nama, 'SKIP', `data tidak lengkap (recap:${!!totRecap} summary:${!!totSummary})`);
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => totRecap[f] === totSummary[f]);
      if (cocok) {
        log('C1', s.nama, 'PASS', `waka vs guru/wali cocok — ${fmt(totRecap)} (kelas: ${class_name})`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => totRecap[f] !== totSummary[f]).map(f => `${f}:recap=${totRecap[f]} summary=${totSummary[f]}`);
        log('C1', s.nama, 'FAIL', `tidak cocok: ${beda.join(' | ')}`);
      }
    }
  } catch(e) { log('C1', s.nama, 'ERR', e.message); }

  // === C2: fn_attendance_recap_per_class (waka) vs fn_tu_attendance_recap (TU) ===
  try {
    const [recapRes, tuRes] = await Promise.all([
      wakaEmail ? getRecapPerClass(wakaEmail, s.school_id) : null,
      tuEmail   ? getTuRecap(tuEmail) : null,
    ]);

    const recapRows = recapRes?.rows;
    const tuRows    = tuRes?.rows;
    const totRecap  = totalHSIA(Array.isArray(recapRows) ? recapRows : []);
    const totTu     = tuRows?.[0] ? { hadir: +tuRows[0].hadir, sakit: +tuRows[0].sakit, izin: +tuRows[0].izin, alpa: +tuRows[0].alpa } : null;

    if (!totRecap || !totTu) {
      log('C2', s.nama, 'SKIP', `data tidak lengkap (waka:${!!totRecap} tu:${!!totTu})`);
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => totRecap[f] === totTu[f]);
      if (cocok) {
        log('C2', s.nama, 'PASS', `waka vs TU cocok — ${fmt(totRecap)}`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => totRecap[f] !== totTu[f]).map(f => `${f}:waka=${totRecap[f]} tu=${totTu[f]}`);
        log('C2', s.nama, 'FAIL', `tidak cocok: ${beda.join(' | ')}`);
      }
    }
  } catch(e) { log('C2', s.nama, 'ERR', e.message); }

  // === C3: fn_portal_attendance (siswa) vs fn_class_attendance_summary (guru) ===
  // Portal siswa harus punya H+S+I+A ≤ total kelas
  try {
    const [portalRes, summaryRes] = await Promise.all([
      siswaEmail ? getPortalAttendance(siswaEmail) : null,
      guruEmail  ? getClassSummary(guruEmail, class_id) : null,
    ]);

    const portalJsonb  = portalRes?.rows?.[0]?.data;
    const summaryRows  = summaryRes?.rows;
    const totSummary   = totalHSIA(summaryRows);

    if (!portalJsonb || !totSummary) {
      log('C3', s.nama, 'SKIP', `data tidak lengkap`);
    } else {
      // Parse JSONB portal: array schedule objects, masing-masing punya attendance[0].status
      let schedules;
      try { schedules = typeof portalJsonb === 'string' ? JSON.parse(portalJsonb) : portalJsonb; } catch(e) { schedules = []; }

      // Group per block_group_id, ambil status terburuk (prio: ALPA > SAKIT > IZIN > HADIR)
      const PRIO = { ALPA: 4, SAKIT: 3, IZIN: 2, HADIR: 1 };
      const blockMap = {};
      for (const sch of (Array.isArray(schedules) ? schedules : [])) {
        const bg  = sch.block_group_id;
        const st  = sch.attendance?.[0]?.status;
        if (!bg || !st) continue;
        if (!blockMap[bg] || PRIO[st] > PRIO[blockMap[bg]]) blockMap[bg] = st;
      }

      const totPortal = { hadir: 0, sakit: 0, izin: 0, alpa: 0 };
      for (const st of Object.values(blockMap)) {
        if (st === 'HADIR') totPortal.hadir++;
        else if (st === 'SAKIT') totPortal.sakit++;
        else if (st === 'IZIN')  totPortal.izin++;
        else if (st === 'ALPA')  totPortal.alpa++;
      }

      const totalPortal  = totPortal.hadir + totPortal.sakit + totPortal.izin + totPortal.alpa;
      const totalSummary = totSummary.hadir + totSummary.sakit + totSummary.izin + totSummary.alpa;
      const masukAkal    = totalPortal <= totalSummary;

      if (masukAkal) {
        log('C3', s.nama, 'PASS', `portal siswa ${fmt(totPortal)} ≤ rekap kelas ${fmt(totSummary)}`);
      } else {
        log('C3', s.nama, 'FAIL', `portal siswa melebihi rekap kelas — anomali. Portal: ${fmt(totPortal)}, Rekap: ${fmt(totSummary)}`);
      }
    }
  } catch(e) { log('C3', s.nama, 'ERR', e.message); }

  // === C4: Excel Wali — 12× fn_class_attendance_summary per bulan vs full tahun ===
  // Total 12 bulan harus = full tahun (tidak ada data hilang / double-count)
  try {
    if (!guruEmail) { log('C4', s.nama, 'SKIP', 'tidak ada email guru'); return; }
    const userId = await getUserId(guruEmail);
    if (!userId) { log('C4', s.nama, 'SKIP', 'user_id guru tidak ditemukan'); return; }

    const MONTHS = [];
    for (let m = 0; m < 12; m++) {
      const year  = m < 6 ? tahun + 1 : tahun;
      const month = m < 6 ? m + 1 : m - 5;
      const from  = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to    = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;
      MONTHS.push({ from, to });
    }

    const monthQueries = MONTHS.map(m => `
      SELECT SUM(hadir)::int as hadir, SUM(alpa)::int as alpa, SUM(izin)::int as izin, SUM(sakit)::int as sakit
      FROM fn_class_attendance_summary('${class_id}'::uuid, NULL::text, '${m.from}'::date, '${m.to}'::date, NULL::uuid, NULL::semester)
    `).join(' UNION ALL ');

    const sql12 = `
      BEGIN;
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      SELECT SUM(hadir)::int as hadir, SUM(alpa)::int as alpa, SUM(izin)::int as izin, SUM(sakit)::int as sakit FROM (${monthQueries}) x;
      ROLLBACK;
    `;
    const sqlFull = `
      BEGIN;
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      SELECT SUM(hadir)::int as hadir, SUM(alpa)::int as alpa, SUM(izin)::int as izin, SUM(sakit)::int as sakit
      FROM fn_class_attendance_summary('${class_id}'::uuid, NULL::text, '${P_FROM}'::date, '${P_TO}'::date, NULL::uuid, NULL::semester);
      ROLLBACK;
    `;

    const [res12, resFull] = await Promise.all([fetchMgmt(sql12), fetchMgmt(sqlFull)]);
    const tot12   = res12?.rows?.[0];
    const totFull = resFull?.rows?.[0];

    if (!tot12 || !totFull) {
      log('C4', s.nama, 'SKIP', 'data tidak lengkap');
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => parseInt(tot12[f]) === parseInt(totFull[f]));
      if (cocok) {
        log('C4', s.nama, 'PASS', `12×bulan vs full tahun cocok — ${fmt({ hadir: +totFull.hadir, sakit: +totFull.sakit, izin: +totFull.izin, alpa: +totFull.alpa })}`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => parseInt(tot12[f]) !== parseInt(totFull[f])).map(f => `${f}:12bln=${tot12[f]} full=${totFull[f]}`);
        log('C4', s.nama, 'FAIL', `TIDAK cocok: ${beda.join(' | ')} — data hilang atau double-count antar bulan`);
      }
    }
  } catch(e) { log('C4', s.nama, 'ERR', e.message); }

  // === C5 (PRIORITAS TINGGI): Excel BK — fn_attendance_recap_per_class vs fn_class_attendance_summary ===
  // BK Excel RINGKASAN pakai getAttendanceRecapPerClass, sedangkan BK Excel per-kelas pakai buildWaliSheetsMonthly
  // (yang memanggil fn_class_attendance_summary). Keduanya harus cocok.
  try {
    if (!bkEmail || !wakaEmail) { log('C5', s.nama, 'SKIP', 'tidak ada email BK atau Waka'); return; }

    const [recapRes, summaryRes] = await Promise.all([
      getRecapPerClass(wakaEmail, s.school_id),  // fn_attendance_recap_per_class (jalur BK RINGKASAN)
      getClassSummary(guruEmail, class_id),       // fn_class_attendance_summary (jalur BK per-kelas)
    ]);

    const recapRows  = recapRes?.rows;
    const summaryRows = summaryRes?.rows;
    const rowRecap   = Array.isArray(recapRows) ? recapRows.find(r => r.class_id === class_id || r.name === class_name) : null;
    const totSummary = totalHSIA(summaryRows);
    const totRecap   = rowRecap ? { hadir: +rowRecap.hadir, sakit: +rowRecap.sakit, izin: +rowRecap.izin, alpa: +rowRecap.alpa } : null;

    if (!totRecap || !totSummary) {
      log('C5', s.nama, 'SKIP', `data tidak lengkap (recap:${!!totRecap} summary:${!!totSummary})`);
    } else {
      const cocok = ['hadir','sakit','izin','alpa'].every(f => totRecap[f] === totSummary[f]);
      if (cocok) {
        log('C5', s.nama, 'PASS', `BK Excel: jalur RINGKASAN vs per-kelas cocok — ${fmt(totRecap)}`);
      } else {
        const beda = ['hadir','sakit','izin','alpa'].filter(f => totRecap[f] !== totSummary[f]).map(f => `${f}:recap=${totRecap[f]} summary=${totSummary[f]}`);
        log('C5', s.nama, 'FAIL', `JALUR BERBEDA TIDAK COCOK: ${beda.join(' | ')} — BK Excel RINGKASAN ≠ BK Excel per-kelas`);
      }
    }
  } catch(e) { log('C5', s.nama, 'ERR', e.message); }
}

// === Main ===
async function main() {
  console.log('=== Verifikasi Konsistensi Absensi (Fase 2 — Data Nyata) ===');
  console.log(`Periode: ${P_FROM} s/d ${P_TO}\n`);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: SUPABASE_URL atau SUPABASE_SERVICE_KEY tidak ada di .env');
    process.exit(1);
  }
  if (!MGMT_TOKEN) {
    console.warn('PERINGATAN: SUPABASE_ACCESS_TOKEN tidak ada — C1/C2/C3/C4/C5 akan gagal (butuh Management API)');
  }

  for (const s of SCHOOLS) {
    await cekSekolah(s);
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
