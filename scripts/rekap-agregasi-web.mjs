/**
 * Verifikasi end-to-end: angka di layar web (Waka Kesiswaan) vs angka di database.
 *
 * Rantai bukti:
 *   layar web → fn_attendance_recap_per_class (SECURITY DEFINER, dipanggil app nyata)
 *   database  → pivot langsung dari tabel (rekap-agregasi.mjs)
 *   jika keduanya cocok → angka dapat dipercaya sepenuhnya
 *
 * Jalankan: node scripts/rekap-agregasi-web.mjs
 * Butuh:    SUPABASE_URL, SUPABASE_ACCESS_TOKEN di .env
 * Output:   docs/rekap-agregasi-web-<tanggal>.md
 */

import fs from 'fs';
import { chromium } from 'playwright';

// ── Baca .env ────────────────────────────────────────────────────────────────
const envRaw = fs.readFileSync('.env', 'utf8');
const get = k => (envRaw.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1]?.trim().replace(/^<|>$/g, '');

const SUPABASE_URL = get('SUPABASE_URL');
const MGMT_TOKEN   = get('SUPABASE_ACCESS_TOKEN');
const PROJECT_REF  = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];

const APP_BASE = 'https://sipkecamatan.github.io/kecamatanujungbatu';
const PASSWORD = '123456789';

// tab_hash: hash URL dashboard yang dipakai role ini
//   WAKA_KESISWAAN → #waka_kesiswaan
//   WAKASEK        → #wakasek (DOM dari waka_kesiswaan dipindah ke sini oleh dashboard.js)
const SEKOLAH = [
  {
    nama: 'SMK Uji 1',
    school_id: '5d67c321-ec65-4ecb-b1d3-672ce7628a17',
    nip: '197803232004111903',
    slug: 'smkuji1',
    tab_hash: 'waka_kesiswaan',
  },
  {
    nama: 'SMA Uji 1',
    school_id: 'a41a1f24-3ed2-464e-8e06-754f4dfd3c1f',
    nip: '199104302016031986',
    slug: 'smauji1',
    tab_hash: 'waka_kesiswaan',
  },
  {
    nama: 'SMP Uji 1',
    school_id: '4ba66164-4f9d-4973-9afe-cf7e473ef91b',
    nip: '199005272016031912',
    slug: 'smpuji1',
    tab_hash: 'wakasek',
  },
];

// Rentang tahun ajaran berjalan
const now   = new Date();
const tahun = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const P_FROM = `${tahun}-07-01`;
const P_TO   = `${tahun + 1}-06-30`;

// ── Output ───────────────────────────────────────────────────────────────────
if (!fs.existsSync('docs')) fs.mkdirSync('docs');
const outFile = `docs/rekap-agregasi-web-${new Date().toISOString().slice(0,10)}.md`;
const lines = [];
function emit(s = '') { process.stdout.write(s + '\n'); lines.push(s); }
function flush() {
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log(`\nHasil ditulis ke: ${outFile}`);
}

function fmt(v) {
  if (!v) return 'null';
  return `H:${String(v.h).padStart(5)} S:${String(v.s).padStart(4)} I:${String(v.i).padStart(4)} A:${String(v.a).padStart(4)}`;
}
function cocok(a, b) {
  return a && b && a.h === b.h && a.s === b.s && a.i === b.i && a.a === b.a;
}

// ── Query database langsung (replikasi logika fn_attendance_recap_per_class) ──
async function sqlQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return Array.isArray(json) ? json : [];
}

async function getDbTotals(school_id) {
  // Total sekolah (logika fn_attendance_recap_per_class)
  const rows = await sqlQuery(`
    WITH att_pivot AS (
      SELECT
        a.student_id,
        ts.class_id,
        ts.block_group_id,
        CASE MAX(CASE a.status::text
          WHEN 'ALPA'  THEN 4 WHEN 'SAKIT' THEN 3
          WHEN 'IZIN'  THEN 2 WHEN 'HADIR' THEN 1 ELSE 0 END)
          WHEN 4 THEN 'ALPA' WHEN 3 THEN 'SAKIT'
          WHEN 2 THEN 'IZIN' WHEN 1 THEN 'HADIR'
        END AS status
      FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE a.school_id = '${school_id}'
        AND ts.session_date BETWEEN '${P_FROM}'::date AND '${P_TO}'::date
        AND a.is_void = false AND a.status IS NOT NULL
      GROUP BY a.student_id, ts.class_id, ts.block_group_id
    )
    SELECT
      c.name AS class_name,
      COUNT(*) FILTER (WHERE ap.status='HADIR')::int AS hadir,
      COUNT(*) FILTER (WHERE ap.status='SAKIT')::int AS sakit,
      COUNT(*) FILTER (WHERE ap.status='IZIN') ::int AS izin,
      COUNT(*) FILTER (WHERE ap.status='ALPA') ::int AS alpa
    FROM att_pivot ap
    JOIN classes c ON c.class_id = ap.class_id
    GROUP BY c.name
    ORDER BY c.name
  `);

  // Map: nama_kelas → {h,s,i,a}
  const perKelas = {};
  let total = { h: 0, s: 0, i: 0, a: 0 };
  for (const r of rows) {
    perKelas[r.class_name] = { h: +r.hadir, s: +r.sakit, i: +r.izin, a: +r.alpa };
    total.h += +r.hadir; total.s += +r.sakit;
    total.i += +r.izin;  total.a += +r.alpa;
  }
  return { total, perKelas };
}

// ── Login via form (NIP + password) ──────────────────────────────────────────
// Pakai form login persis seperti user nyata: NIP → fn_resolve_login_email → signIn.
// Jauh lebih sederhana dan andal daripada inject auth manual.
async function login(page, nip, slug, sekolahNama) {
  const LOGIN_URL = `${APP_BASE}/guru/index.html?school=${slug}`;
  await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 30000 });

  // Tunggu tombol aktif (applyBranding() harus selesai dulu — lihat auth.js)
  await page.waitForSelector('#login-btn:not([disabled])', { timeout: 15000 });

  await page.fill('#identifier', nip);
  await page.fill('#password', PASSWORD);
  await page.click('#login-btn');

  // Tunggu redirect ke dashboard setelah login berhasil
  await page.waitForURL('**/dashboard.html**', { timeout: 20000 });
  emit(`  Login berhasil (${sekolahNama})`);
  return true;
}

// ── Baca rekap dari DOM (Waka Kesiswaan / Wakasek) ───────────────────────────
// Struktur: #wk-att-recap berisi flex-div per kelas dengan span "143H", "10S", "12I", "15A"
// (bukan tabel). Data hanya muncul setelah accordion dibuka + Filter diklik.
// tab_hash: 'waka_kesiswaan' untuk WAKA_KESISWAAN, 'wakasek' untuk WAKASEK
//   (dashboard.js memindah DOM dari #tab-waka_kesiswaan ke #tab-wakasek untuk role WAKASEK)
async function getWebTotals(page, tab_hash, dateFrom, dateTo) {
  const DASH_URL = `${APP_BASE}/guru/dashboard.html#${tab_hash}`;

  // Navigasi ke tab yang benar (login sudah redirect ke dashboard.html tanpa hash)
  await page.goto(DASH_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(4000); // tunggu auth check + tab init

  // Cek tidak redirect ke login
  if (!page.url().includes('dashboard')) {
    emit(`  [!] Redirect ke login — sesi tidak valid (url: ${page.url()})`);
    return null;
  }

  // Tunggu onclick filter button terpasang (initWakaKesiswaanTab selesai)
  await page.waitForFunction(
    () => !!document.getElementById('wk-att-filter-btn')?.onclick,
    { timeout: 20000 }
  );

  // Force-show body, set tanggal, klik filter — semuanya via DOM (bypass visibility)
  await page.evaluate(([df, dt]) => {
    const body = document.getElementById('wk-att-body');
    if (body) body.style.display = 'block';
    const start = document.getElementById('wk-att-start');
    const end   = document.getElementById('wk-att-end');
    if (start) start.value = df;
    if (end)   end.value   = dt;
    const btn = document.getElementById('wk-att-filter-btn');
    if (btn) btn.click();
  }, [dateFrom, dateTo]);

  // Tunggu konten muncul di #wk-att-recap (bukan lagi "hint" / "Memuat")
  await page.waitForFunction(
    () => {
      const el = document.getElementById('wk-att-recap');
      if (!el) return false;
      const text = el.textContent || '';
      return text.includes('H') && !text.includes('Memuat') && !text.includes('Pilih rentang');
    },
    { timeout: 20000 }
  );

  // Parse span "143H", "10S", "12I", "15A" dari setiap baris kelas
  const result = await page.evaluate(() => {
    const container = document.getElementById('wk-att-recap');
    if (!container) return null;

    // Setiap baris kelas adalah div langsung di dalam container (atau di dalam details)
    // Cari semua div yang mengandung span-span H/S/I/A
    const parseNum = (text, suffix) => {
      const m = text.match(new RegExp('(\\d+)' + suffix + '$'));
      return m ? parseInt(m[1], 10) : null;
    };

    const perKelas = {};

    // Kumpulkan semua row-div: bisa flat atau di dalam <details>
    const rowDivs = [...container.querySelectorAll('div')].filter(div => {
      const spans = div.querySelectorAll('span');
      // Baris kelas: punya span dengan teks seperti "143H"
      return [...spans].some(s => /^\d+H$/.test(s.textContent.trim()));
    });

    for (const div of rowDivs) {
      const spans = [...div.querySelectorAll('span')];
      let nama = null, h = null, s = null, i = null, a = null;

      for (const sp of spans) {
        const t = sp.textContent.trim();
        if (/^\d+H$/.test(t)) h = parseInt(t, 10);
        else if (/^\d+S$/.test(t)) s = parseInt(t, 10);
        else if (/^\d+I$/.test(t)) i = parseInt(t, 10);
        else if (/^\d+A$/.test(t) && !/^\d+%$/.test(t)) a = parseInt(t, 10);
        else if (sp.style.flex === '1' || sp.getAttribute('style')?.includes('flex:1')) {
          // span nama kelas — ambil teks, strip nomor urut di awal
          const txt = t.replace(/^\d+$/, '').trim();
          if (txt) nama = txt;
        }
      }

      // Fallback nama: span pertama yang bukan angka murni dan bukan H/S/I/A/%
      if (!nama) {
        for (const sp of spans) {
          const t = sp.textContent.trim();
          if (t && !/^\d+[HSIA%]?$/.test(t) && t.length > 1) { nama = t; break; }
        }
      }

      if (nama && h !== null && s !== null && i !== null && a !== null) {
        perKelas[nama] = { h, s, i, a };
      }
    }

    let total = { h: 0, s: 0, i: 0, a: 0 };
    for (const v of Object.values(perKelas)) {
      total.h += v.h; total.s += v.s; total.i += v.i; total.a += v.a;
    }
    return { total, perKelas };
  });

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
emit(`# Verifikasi End-to-End: Layar Web vs Database`);
emit(`\nTahun ajaran: ${tahun}/${tahun + 1} (${P_FROM} s.d. ${P_TO})`);
emit(`Dijalankan: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
emit(`App: ${APP_BASE}\n`);

const browser = await chromium.launch({ headless: true });

let totalPass = 0, totalFail = 0;

for (const s of SEKOLAH) {
  emit(`\n${'═'.repeat(60)}`);
  emit(`  ${s.nama}`);
  emit(`${'═'.repeat(60)}`);

  // Ambil angka database
  let db;
  try {
    db = await getDbTotals(s.school_id);
    emit(`\n  DATABASE (SQL langsung)`);
    emit(`  Total: ${fmt(db.total)}`);
    emit(`  Kelas: ${Object.keys(db.perKelas).length} kelas`);
  } catch (e) {
    emit(`  [!] ERROR database: ${e.message}`);
    continue;
  }

  // Login dan baca layar
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  let web = null;
  try {
    const ok = await login(page, s.nip, s.slug, s.nama);
    if (ok) {
      web = await getWebTotals(page, s.tab_hash, P_FROM, P_TO);
    }
  } catch (e) {
    emit(`  [!] ERROR Playwright: ${e.message}`);
  } finally {
    await context.close();
  }

  if (!web) {
    emit(`  [!] Tidak bisa membaca angka dari layar web`);
    totalFail++;
    continue;
  }

  emit(`\n  LAYAR WEB (Waka Kesiswaan)`);
  emit(`  Total: ${fmt(web.total)}`);
  emit(`  Kelas: ${Object.keys(web.perKelas).length} kelas`);

  // Bandingkan total
  emit(`\n  ${'─'.repeat(55)}`);
  emit(`  PERBANDINGAN TOTAL SEKOLAH`);
  emit(`  DB : ${fmt(db.total)}`);
  emit(`  Web: ${fmt(web.total)}`);

  if (cocok(db.total, web.total)) {
    emit(`  ✓ COCOK — total sekolah identik`);
    totalPass++;
  } else {
    const sel = { h: db.total.h - web.total.h, s: db.total.s - web.total.s, i: db.total.i - web.total.i, a: db.total.a - web.total.a };
    emit(`  ✗ BEDA — selisih H:${sel.h} S:${sel.s} I:${sel.i} A:${sel.a}`);
    totalFail++;
  }

  // Bandingkan per kelas
  const kelasSemua = new Set([...Object.keys(db.perKelas), ...Object.keys(web.perKelas)]);
  if (kelasSemua.size > 0) {
    emit(`\n  PERBANDINGAN PER KELAS`);
    let kelasFail = 0;
    for (const nama of [...kelasSemua].sort()) {
      const d = db.perKelas[nama];
      const w = web.perKelas[nama];
      if (!d) { emit(`  ? ${nama.padEnd(20)} — ada di web, tidak di DB`); kelasFail++; continue; }
      if (!w) { emit(`  ? ${nama.padEnd(20)} — ada di DB, tidak di web`); kelasFail++; continue; }
      if (cocok(d, w)) {
        emit(`  ✓ ${nama.padEnd(20)} ${fmt(d)}`);
      } else {
        emit(`  ✗ ${nama.padEnd(20)}`);
        emit(`      DB : ${fmt(d)}`);
        emit(`      Web: ${fmt(w)}`);
        kelasFail++;
      }
    }
    if (kelasFail === 0) emit(`\n  ✓ Semua ${kelasSemua.size} kelas cocok`);
    else emit(`\n  ✗ ${kelasFail} dari ${kelasSemua.size} kelas bermasalah`);
  }

  await new Promise(r => setTimeout(r, 2000));
}

await browser.close();

emit(`\n${'═'.repeat(60)}`);
emit(`RINGKASAN: ${totalPass} sekolah COCOK, ${totalFail} sekolah BERMASALAH`);
emit(`Selesai.`);
flush();
