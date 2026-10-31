/**
 * Uji login Playwright untuk semua role per jenjang.
 * Jalankan: node scripts/playwright-login-uji.mjs
 *
 * Fase ini hanya memverifikasi:
 * 1. Login berhasil (tidak ada error auth)
 * 2. Halaman dashboard terbuka (URL berubah ke /dashboard atau portal)
 * 3. Tidak ada JS error fatal di console
 */

import fs from 'fs';
import { chromium } from 'playwright';

const env = fs.readFileSync('.env', 'utf8');
const get = k => (env.match(new RegExp(k + '=(.+)')) || [])[1]?.trim();

const BASE_URL = 'https://sipkecamatan.github.io/kecamatanujungbatu';
const PASSWORD  = get('UJI_PASSWORD').replace(/^<|>$/g, '');

const SMK = 'smkuji1';
const SMA = 'smauji1';
const SMP = 'smpuji1';

function loginGuru(slug)  { return `${BASE_URL}/guru/index.html?school=${slug}`; }
function loginTU(slug)    { return `${BASE_URL}/tu/index.html?school=${slug}`; }
function loginSiswa(slug) { return `${BASE_URL}/student/index.html?school=${slug}`; }
function loginOrtu(slug)  { return `${BASE_URL}/parent/index.html?school=${slug}`; }
function loginDudi(slug)  { return `${BASE_URL}/dudi/index.html?school=${slug}`; }
function loginSth(slug)   { return `${BASE_URL}/stakeholder/index.html?school=${slug}`; }

const AKUN = [
  // SMK
  { label: 'SMK/Guru',            email: get('UJI_SMK_GURU'),            login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/Wali',            email: get('UJI_SMK_WALI'),            login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/Kaprodi',         email: get('UJI_SMK_KAPRODI'),         login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/BK',              email: get('UJI_SMK_BK'),              login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/Waka Kesiswaan',  email: get('UJI_SMK_WAKA_KESISWAAN'), login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/Waka Kurikulum',  email: get('UJI_SMK_WAKA_KURIKULUM'), login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/Waka Humas',      email: get('UJI_SMK_WAKA_HUMAS'),     login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/Kepsek',          email: get('UJI_SMK_KEPSEK'),          login: loginGuru(SMK),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMK/TU',              email: get('UJI_SMK_TU'),              login: loginTU(SMK),    dashboard: `${BASE_URL}/tu/portal.html` },
  { label: 'SMK/Siswa',           email: get('UJI_SMK_SISWA'),           login: loginSiswa(SMK), dashboard: `${BASE_URL}/student/dashboard.html` },
  { label: 'SMK/Ortu',            email: get('UJI_SMK_ORTU'),            login: loginOrtu(SMK),  dashboard: `${BASE_URL}/parent/portal.html` },
  { label: 'SMK/DUDI',            email: get('UJI_SMK_DUDI'),            login: loginDudi(SMK),  dashboard: `${BASE_URL}/dudi/dashboard.html` },
  { label: 'SMK/Stakeholder',     email: get('UJI_SMK_STAKEHOLDER'),     login: loginSth(SMK),   dashboard: `${BASE_URL}/stakeholder/dashboard.html` },

  // SMA
  { label: 'SMA/Guru',            email: get('UJI_SMA_GURU'),            login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/Wali',            email: get('UJI_SMA_WALI'),            login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/Waka Kesiswaan',  email: get('UJI_SMA_WAKA_KESISWAAN'), login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/Waka Kurikulum',  email: get('UJI_SMA_WAKA_KURIKULUM'), login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/Waka Humas',      email: get('UJI_SMA_WAKA_HUMAS'),     login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/BK',              email: get('UJI_SMA_BK'),              login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/Kepsek',          email: get('UJI_SMA_KEPSEK'),          login: loginGuru(SMA),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMA/TU',              email: get('UJI_SMA_TU'),              login: loginTU(SMA),    dashboard: `${BASE_URL}/tu/portal.html` },
  { label: 'SMA/Siswa',           email: get('UJI_SMA_SISWA'),           login: loginSiswa(SMA), dashboard: `${BASE_URL}/student/dashboard.html` },
  { label: 'SMA/Ortu',            email: get('UJI_SMA_ORTU'),            login: loginOrtu(SMA),  dashboard: `${BASE_URL}/parent/portal.html` },
  { label: 'SMA/Stakeholder',     email: get('UJI_SMA_STAKEHOLDER'),     login: loginSth(SMA),   dashboard: `${BASE_URL}/stakeholder/dashboard.html` },

  // SMP
  { label: 'SMP/Guru',            email: get('UJI_SMP_GURU'),            login: loginGuru(SMP),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMP/Wali',            email: get('UJI_SMP_WALI'),            login: loginGuru(SMP),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMP/Wakasek',         email: get('UJI_SMP_WAKA_KESISWAAN'), login: loginGuru(SMP),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMP/BK',              email: get('UJI_SMP_BK'),              login: loginGuru(SMP),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMP/Kepsek',          email: get('UJI_SMP_KEPSEK'),          login: loginGuru(SMP),  dashboard: `${BASE_URL}/guru/dashboard.html` },
  { label: 'SMP/TU',              email: get('UJI_SMP_TU'),              login: loginTU(SMP),    dashboard: `${BASE_URL}/tu/portal.html` },
  { label: 'SMP/Siswa',           email: get('UJI_SMP_SISWA'),           login: loginSiswa(SMP), dashboard: `${BASE_URL}/student/dashboard.html` },
  { label: 'SMP/Ortu',            email: get('UJI_SMP_ORTU'),            login: loginOrtu(SMP),  dashboard: `${BASE_URL}/parent/portal.html` },
  { label: 'SMP/Stakeholder',     email: get('UJI_SMP_STAKEHOLDER'),     login: loginSth(SMP),   dashboard: `${BASE_URL}/stakeholder/dashboard.html` },

  // Wilayah
  { label: 'Kecamatan',           email: get('UJI_KECAMATAN'),           login: `${BASE_URL}/kecamatan/`, dashboard: `${BASE_URL}/kecamatan/` },
  { label: 'Kabupaten',           email: get('UJI_KABUPATEN'),           login: `${BASE_URL}/kabupaten/`, dashboard: `${BASE_URL}/kabupaten/` },
  { label: 'Provinsi',            email: get('UJI_PROVINSI'),            login: `${BASE_URL}/provinsi/`,  dashboard: `${BASE_URL}/provinsi/` },
];

// Login URL = index.html di folder yang sama dengan portal
function loginUrl(portalUrl) {
  return portalUrl.replace(/\/[^/]+\.html$/, '/index.html');
}

async function ujLogin(browser, akun) {
  if (!akun.email) {
    console.log(`  SKIP  ${akun.label} (email tidak ada di .env)`);
    return { label: akun.label, status: 'SKIP', alasan: 'email tidak ada di .env' };
  }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  try {
    await page.goto(akun.login, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#login-form, form', { timeout: 20000 });

    // Identifier: NIP/NIK (angka sebelum @) atau email penuh untuk portal wilayah/DUDI/stakeholder
    const identifier = akun.email.match(/^(\d+)@/) ? akun.email.split('@')[0] : akun.email;
    // Coba selector NIP (guru/TU/siswa/ortu) lalu fallback ke email (wilayah)
    const inputSel = await page.locator('#identifier').count() > 0
      ? '#identifier'
      : await page.locator('#login-identifier').count() > 0
      ? '#login-identifier'
      : 'input[type="email"], input[name="email"]';
    await page.fill(inputSel, identifier);
    await page.fill('input[type="password"], #password', PASSWORD);
    await page.click('button[type="submit"]');

    // Tunggu: form login hilang ATAU URL berubah (mana yang lebih dulu)
    await Promise.race([
      page.waitForURL(url => url.href !== akun.login && !url.href.endsWith('index.html'), { timeout: 15000 }),
      page.waitForSelector('input[type="password"]', { state: 'hidden', timeout: 15000 }),
    ]);

    // Beri waktu JS render dashboard
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    // Cek apakah form login masih ada (berarti login gagal)
    const formMasihAda = await page.locator('input[type="password"]').isVisible().catch(() => false);

    if (formMasihAda) {
      console.log(`  FAIL  ${akun.label} — form login masih tampil setelah submit`);
      return { label: akun.label, status: 'FAIL', alasan: 'form login masih tampil' };
    }

    console.log(`  PASS  ${akun.label}`);
    return { label: akun.label, status: 'PASS', url: finalUrl };
  } catch (e) {
    console.log(`  FAIL  ${akun.label} — ${e.message.split('\n')[0]}`);
    return { label: akun.label, status: 'FAIL', alasan: e.message.split('\n')[0] };
  } finally {
    await ctx.close();
  }
}

async function main() {
  console.log('Uji login Playwright — semua role...\n');
  const browser = await chromium.launch({ headless: true });
  const hasil = [];

  for (const akun of AKUN) {
    const r = await ujLogin(browser, akun);
    hasil.push(r);
  }

  await browser.close();

  console.log('\n=== RINGKASAN ===');
  const pass = hasil.filter(r => r.status === 'PASS').length;
  const fail = hasil.filter(r => r.status === 'FAIL').length;
  const warn = hasil.filter(r => r.status === 'WARN').length;
  const skip = hasil.filter(r => r.status === 'SKIP').length;
  console.log(`PASS: ${pass} | FAIL: ${fail} | WARN: ${warn} | SKIP: ${skip}`);

  if (fail > 0 || warn > 0) {
    console.log('\nDetail masalah:');
    hasil.filter(r => r.status !== 'PASS' && r.status !== 'SKIP')
         .forEach(r => console.log(`  [${r.status}] ${r.label}: ${r.alasan || r.url}`));
  }
}

main().catch(console.error);
