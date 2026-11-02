#!/usr/bin/env node
/**
 * tests/piket-agregasi-web.mjs
 *
 * Verifikasi piket — Layer A: angka di layar = angka di database.
 *
 * Untuk setiap role yang punya akses piket, skrip ini:
 *   1. Login ke app live via form Playwright
 *   2. Membuka tab + section piket yang sesuai
 *   3. Men-trigger filter tanggal
 *   4. Membaca jumlah catatan dari UI
 *   5. Membandingkan dengan COUNT(*) dari DB via simulasiRLS (Management API)
 *
 * Role yang diuji:
 *   A1. BK SMK — keterlambatan  (wk-bk, semua kelas sekolah)
 *   A2. BK SMK — izin keluar
 *   A3. Waka Kesiswaan SMK — keterlambatan
 *   A4. Waka Kesiswaan SMK — izin keluar
 *   A5. Wakasek SMP — keterlambatan
 *   A6. Wakasek SMP — izin keluar
 *   A7. Wali Kelas SMK — keterlambatan (hanya kelas waliannya)
 *   A8. Wali Kelas SMK — izin keluar
 *
 * Kaprodi tidak diuji di sini karena butuh akun kaprodi di .env terpisah.
 *
 * PRASYARAT .env:
 *   SUPABASE_ACCESS_TOKEN = sbp_...  (Management API)
 *   UJI_SMK_BK            = <email/NIP>
 *   UJI_SMK_BK_PASSWORD   = <password>
 *   UJI_SMK_WAKA_KESISWAAN         = <email/NIP>
 *   UJI_SMK_WAKA_KESISWAAN_PASSWORD = <password>
 *   UJI_SMP_WAKA_KESISWAAN         = <email/NIP> (WAKASEK SMP)
 *   UJI_SMP_WAKA_KESISWAAN_PASSWORD = <password>
 *   UJI_SMK_WALI_PASSWORD  = <password> (NIP dipilih otomatis dari DB)
 *
 * CARA JALANKAN:
 *   node tests/piket-agregasi-web.mjs
 *
 * EXIT CODE: 0 = semua yang dijalankan lulus, 1 = ada kegagalan
 */

// ── Auto-load .env ──────────────────────────────────────────────────────────
{
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join }  = await import('node:path');
    try {
        const dir   = dirname(fileURLToPath(import.meta.url));
        const lines = readFileSync(join(dir, '..', '.env'), 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]])
                process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
    } catch { /* .env tidak ada */ }
}

import { chromium }         from 'playwright';
import { fileURLToPath }    from 'node:url';
import { dirname, join }    from 'node:path';

const DIR  = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');

// ── Konfigurasi ─────────────────────────────────────────────────────────────
const TOKEN    = process.env.SUPABASE_ACCESS_TOKEN;
const REF      = (process.env.SUPABASE_URL || '').match(/\/\/([^.]+)/)?.[1] || 'lqgzpiohxdzkkmxjtwor';
const MGMT     = `https://api.supabase.com/v1/projects/${REF}`;
const APP_BASE = process.env.APP_BASE_URL || 'https://sipkecamatan.github.io/kecamatanujungbatu';

// Rentang tanggal yang diuji (sama dengan piket-verifikasi.mjs)
const DARI   = '2026-10-01';
const HINGGA = '2026-11-30';

if (!TOKEN) { console.error('FATAL: SUPABASE_ACCESS_TOKEN wajib diisi di .env'); process.exit(2); }

// ── Logger ──────────────────────────────────────────────────────────────────
let lulus = 0, gagal = 0, lewat = 0;
const log = {
    pass: (m)  => { lulus++;  console.log(`  ✓ ${m}`); },
    fail: (m)  => { gagal++;  console.log(`  ✗ FAIL: ${m}`); },
    skip: (m)  => { lewat++;  console.log(`  ⊘ SKIP: ${m}`); },
    head: (m)  => console.log(`\n══ ${m}`),
    info: (m)  => console.log(`     ${m}`),
    warn: (m)  => console.log(`  ⚠ WARN: ${m}`),
};

// ── Supabase Management API ─────────────────────────────────────────────────
async function mgmtQuery(sql) {
    const res = await fetch(`${MGMT}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) throw new Error(`mgmtQuery HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
}

async function simulasiRLS(authUserId, sql) {
    const jwtClaims = JSON.stringify({ sub: authUserId, role: 'authenticated' }).replace(/'/g, "''");
    return mgmtQuery(
        `BEGIN;
         SELECT set_config('request.jwt.claims', '${jwtClaims}', true);
         SET LOCAL ROLE authenticated;
         ${sql}
         ROLLBACK;`
    );
}

// ── Temukan data sekolah dan pengguna dari DB ────────────────────────────────
log.head('Persiapan — ambil data dari DB');

// Temukan slug sekolah uji dan auth_user_id untuk akun .env
let schoolSlugs = {};
let userMap = {};   // key = env_var_name → { nip, auth_user_id, school_slug, school_id, extra }

try {
    // Cari sekolah aktif yang punya data piket dalam rentang
    const sekolah = await mgmtQuery(`
        SELECT s.school_id, s.name, s.jenjang, s.slug
        FROM schools s
        WHERE s.is_active = true
          AND s.school_id IN (
              SELECT DISTINCT school_id FROM late_arrivals
              WHERE late_date BETWEEN '${DARI}' AND '${HINGGA}'
          )
        ORDER BY s.jenjang, s.name
    `);
    for (const row of sekolah) {
        if (!schoolSlugs[row.jenjang]) schoolSlugs[row.jenjang] = [];
        schoolSlugs[row.jenjang].push({ school_id: row.school_id, name: row.name, slug: row.slug });
        log.info(`${row.jenjang} | ${row.name} | slug=${row.slug}`);
    }
    log.pass(`Ditemukan ${sekolah.length} sekolah dengan data piket`);
} catch (e) {
    log.fail(`Query sekolah gagal: ${e.message}`);
    process.exit(1);
}

// Resolusi NIP→auth_user_id untuk setiap akun .env yang dibutuhkan
const AKUN_BUTUH = [
    ['UJI_SMK_BK',             'SMK'],
    ['UJI_SMK_WAKA_KESISWAAN', 'SMK'],
    ['UJI_SMP_WAKA_KESISWAAN', 'SMP'],
    ['UJI_SMK_WALI',           'SMK'],
    ['UJI_SMK_KAPRODI',        'SMK'],
];

for (const [envKey, jenjang] of AKUN_BUTUH) {
    const rawVal = process.env[envKey];
    if (!rawVal) { log.skip(`${envKey} tidak ada di .env`); continue; }

    // rawVal adalah email penuh (format: NIP@school.staff.internal atau xxx@uji.test)
    // login_identifier = bagian sebelum @  (NIP)
    const loginId = rawVal.split('@')[0];

    const sekolahList = schoolSlugs[jenjang] || [];
    if (!sekolahList.length) { log.skip(`${envKey}: tidak ada sekolah ${jenjang} dengan data piket`); continue; }

    try {
        const rows = await mgmtQuery(`
            SELECT u.auth_user_id, u.login_identifier, u.email,
                   s.slug AS school_slug, s.school_id, s.name AS school_name,
                   u.wali_kelas_class_id, u.kaprodi_program_id, u.role_type
            FROM users u
            JOIN schools s ON s.school_id = u.school_id
            WHERE u.email = '${rawVal.replace(/'/g, "''")}'
              AND s.is_active = true
            LIMIT 1
        `);
        if (!rows.length) { log.warn(`${envKey}: email tidak ditemukan di DB`); continue; }
        const r = rows[0];
        userMap[envKey] = {
            nip:          r.login_identifier,
            email:        r.email,
            auth_user_id: r.auth_user_id,
            school_slug:  r.school_slug,
            school_id:    r.school_id,
            school_name:  r.school_name,
            role_type:    r.role_type,
        };
        log.info(`${envKey}: login=${r.login_identifier}, role=${r.role_type}, sekolah=${r.school_name}`);
    } catch (e) {
        log.warn(`${envKey}: query gagal — ${e.message}`);
    }
}


// ── Helper: login + cek piket ────────────────────────────────────────────────

/**
 * Login ke app live, navigasi ke tab + section piket,
 * trigger filter, baca count UI, bandingkan dengan DB.
 *
 * @param {object} opts
 * @param {string}   opts.label          — label untuk log
 * @param {string}   opts.slug           — school slug untuk ?school=
 * @param {string}   opts.nip            — NIP untuk form login
 * @param {string}   opts.password       — password
 * @param {string}   opts.auth_user_id   — untuk simulasiRLS
 * @param {string}   opts.tabKey         — data-tab key (e.g., 'bk', 'wali_kelas')
 * @param {string}   opts.sectionCardId  — id card header untuk diklik buka (e.g., 'bk-late-card')
 * @param {string}   opts.filterBtnId    — id tombol filter
 * @param {string}   opts.startInputId   — id input tanggal mulai
 * @param {string}   opts.endInputId     — id input tanggal selesai
 * @param {string}   opts.contentId      — id container hasil (untuk baca count)
 * @param {string}   opts.tabel          — 'late_arrivals' atau 'student_exits'
 * @param {string}   opts.kolom_tanggal  — 'late_date' atau 'exit_date'
 * @param {function} [opts.extraFilter]  — SQL WHERE tambahan untuk DB query (mis. per kelas)
 * @param {boolean}  [opts.countRows]    — jika true: hitung <tr> di tbody, bukan cari "X catatan"
 */
async function cekPiket(browser, opts) {
    const { label, slug, nip, password, auth_user_id,
            tabKey, sectionCardId, filterBtnId, startInputId, endInputId,
            contentId, tabel, kolom_tanggal, extraFilter = '', countRows = false } = opts;

    log.head(`${label}`);

    // 1. DB count via simulasiRLS — pakai TEMP TABLE agar SELECT terakhir = hasil COUNT
    let dbCount;
    try {
        const rows = await simulasiRLS(auth_user_id, `
            CREATE TEMP TABLE _cek_n (n bigint) ON COMMIT DROP;
            INSERT INTO _cek_n SELECT COUNT(*) FROM ${tabel}
            WHERE ${kolom_tanggal} BETWEEN '${DARI}' AND '${HINGGA}'
            ${extraFilter};
            SELECT n FROM _cek_n;
        `);
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].n !== undefined) { dbCount = parseInt(rows[i].n); break; }
        }
        dbCount = dbCount ?? 0;
        log.info(`DB simulasiRLS: ${dbCount} baris`);
    } catch (e) {
        log.fail(`${label}: simulasiRLS gagal — ${e.message}`);
        return;
    }

    // 2. Playwright login
    const context = await browser.newContext({ timezoneId: 'Asia/Jakarta' });
    const page    = await context.newPage();

    try {
        const loginUrl = `${APP_BASE}/guru/index.html?school=${encodeURIComponent(slug)}`;
        await page.goto(loginUrl, { timeout: 30000 });

        // Tunggu tombol login aktif (applyBranding selesai)
        await page.waitForSelector('#login-btn:not([disabled])', { timeout: 20000 });
        await page.locator('#identifier').fill(nip);
        await page.locator('#password').fill(password);
        await page.locator('#login-btn').click();

        // Tunggu redirect ke dashboard
        await page.waitForURL('**/dashboard.html**', { timeout: 30000 });
        log.info('Login berhasil, dashboard.html dimuat');

        // Tunggu tab nav tersedia
        await page.waitForSelector('[data-tab]', { timeout: 15000 });

        // 3. Navigasi ke tab yang benar
        const tabBtn = page.locator(`button.tab-btn[data-tab="${tabKey}"]`).first();
        await tabBtn.waitFor({ timeout: 10000 });
        await tabBtn.click();

        // Tunggu panel tab aktif
        await page.waitForFunction(
            (key) => document.getElementById('tab-' + key)?.classList.contains('active'),
            tabKey, { timeout: 15000 }
        );

        // Kaprodi/wali: accordion diwire SETELAH async load — tunggu sinyal default date terisi
        if (tabKey === 'kaprodi') {
            await page.waitForFunction(() => {
                const el = document.getElementById('kp-late-start');
                return el && el.value !== '';
            }, { timeout: 30000 });
        }
        if (tabKey === 'wali_kelas') {
            await page.waitForFunction(() => {
                const el = document.getElementById('wali-late-date-start');
                return el && el.value !== '';
            }, { timeout: 30000 });
        }

        // 4. Buka accordion section (klik header)
        // Kaprodi butuh waktu lebih karena inisialisasi clone program accordion
        const cardHeader = page.locator(`#${sectionCardId} .kp-acc-header`).first();
        await cardHeader.waitFor({ timeout: 20000 });
        // Pastikan body masih tertutup sebelum klik
        const bodyOpen = await page.evaluate(
            (cardId) => document.getElementById(cardId)?.querySelector('.kp-acc-body')?.style.display !== 'none',
            sectionCardId
        );
        if (!bodyOpen) await cardHeader.click();

        // Tunggu body terbuka (max 10 detik)
        await page.waitForFunction(
            (cardId) => {
                const card = document.getElementById(cardId);
                const body = card?.querySelector('.kp-acc-body');
                return body && body.style.display !== 'none';
            },
            sectionCardId, { timeout: 10000 }
        );

        // 5. Set tanggal dan klik filter
        await page.locator(`#${startInputId}`).fill(DARI);
        await page.locator(`#${endInputId}`).fill(HINGGA);
        await page.locator(`#${filterBtnId}`).click();

        // 6. Tunggu hasil muncul (bukan "Memuat…")
        await page.waitForFunction(
            (cid) => {
                const el = document.getElementById(cid);
                if (!el) return false;
                const text = el.textContent || '';
                return !text.includes('Memuat') && !text.includes('Pilih rentang');
            },
            contentId, { timeout: 20000 }
        );

        // 7. Baca count dari UI
        let uiCount;
        if (countRows) {
            // Hitung <tr> di tbody (untuk wali: tabel tanpa hint "X catatan ditemukan")
            uiCount = await page.evaluate((cid) => {
                const el = document.getElementById(cid);
                return el?.querySelectorAll('tbody tr').length ?? 0;
            }, contentId);
        } else {
            // Cari teks "X catatan ditemukan" di hint
            const hintText = await page.evaluate((cid) => {
                const el = document.getElementById(cid);
                const hint = el?.querySelector('.hint');
                return hint?.textContent ?? '';
            }, contentId);
            const m = hintText.match(/(\d+)\s+catatan ditemukan/);
            if (!m) {
                // Cek apakah "Tidak ada catatan" (0 baris)
                if (hintText.includes('Tidak ada catatan')) {
                    uiCount = 0;
                } else {
                    log.warn(`${label}: teks hint tidak dikenali: "${hintText.slice(0, 80)}"`);
                    return;
                }
            } else {
                uiCount = parseInt(m[1], 10);
            }
        }

        log.info(`UI: ${uiCount} baris, DB: ${dbCount} baris`);

        // 8. Bandingkan
        if (uiCount === dbCount) {
            log.pass(`${label}: UI (${uiCount}) = DB (${dbCount})`);
        } else {
            log.fail(`${label}: UI (${uiCount}) ≠ DB (${dbCount})`);
        }

    } catch (e) {
        log.fail(`${label}: error — ${e.message}`);
    } finally {
        await page.close();
        await context.close();
    }
}

// ── Jalankan semua checks ─────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

try {
    // ── A1 + A2 — BK SMK ───────────────────────────────────────────────────
    const bkInfo = userMap['UJI_SMK_BK'];
    const bkPwd  = process.env.UJI_SMK_BK_PASSWORD;
    if (bkInfo && bkPwd) {
        await cekPiket(browser, {
            label: 'A1 · BK SMK · Keterlambatan',
            slug:        bkInfo.school_slug,
            nip:         bkInfo.nip,
            password:    bkPwd,
            auth_user_id: bkInfo.auth_user_id,
            tabKey:      'bk',
            sectionCardId: 'bk-late-card',
            filterBtnId:   'bk-late-filter-btn',
            startInputId:  'bk-late-start',
            endInputId:    'bk-late-end',
            contentId:     'bk-late-recap',
            tabel:         'late_arrivals',
            kolom_tanggal: 'late_date',
        });
        await cekPiket(browser, {
            label: 'A2 · BK SMK · Izin Keluar',
            slug:        bkInfo.school_slug,
            nip:         bkInfo.nip,
            password:    bkPwd,
            auth_user_id: bkInfo.auth_user_id,
            tabKey:      'bk',
            sectionCardId: 'bk-exit-card',
            filterBtnId:   'bk-exit-filter-btn',
            startInputId:  'bk-exit-start',
            endInputId:    'bk-exit-end',
            contentId:     'bk-exit-recap',
            tabel:         'student_exits',
            kolom_tanggal: 'exit_date',
        });
    } else {
        log.skip(`A1/A2: UJI_SMK_BK atau UJI_SMK_BK_PASSWORD tidak ada di .env`);
    }

    // ── A3 + A4 — Waka Kesiswaan SMK ───────────────────────────────────────
    const wkInfo = userMap['UJI_SMK_WAKA_KESISWAAN'];
    const wkPwd  = process.env.UJI_SMK_WAKA_KESISWAAN_PASSWORD;
    if (wkInfo && wkPwd) {
        await cekPiket(browser, {
            label: 'A3 · Waka SMK · Keterlambatan',
            slug:        wkInfo.school_slug,
            nip:         wkInfo.nip,
            password:    wkPwd,
            auth_user_id: wkInfo.auth_user_id,
            tabKey:      'waka_kesiswaan',
            sectionCardId: 'wk-late-card',
            filterBtnId:   'wk-late-filter-btn',
            startInputId:  'wk-late-start',
            endInputId:    'wk-late-end',
            contentId:     'wk-late-recap',
            tabel:         'late_arrivals',
            kolom_tanggal: 'late_date',
        });
        await cekPiket(browser, {
            label: 'A4 · Waka SMK · Izin Keluar',
            slug:        wkInfo.school_slug,
            nip:         wkInfo.nip,
            password:    wkPwd,
            auth_user_id: wkInfo.auth_user_id,
            tabKey:      'waka_kesiswaan',
            sectionCardId: 'wk-exit-card',
            filterBtnId:   'wk-exit-filter-btn',
            startInputId:  'wk-exit-start',
            endInputId:    'wk-exit-end',
            contentId:     'wk-exit-recap',
            tabel:         'student_exits',
            kolom_tanggal: 'exit_date',
        });
    } else {
        log.skip(`A3/A4: UJI_SMK_WAKA_KESISWAAN atau UJI_SMK_WAKA_KESISWAAN_PASSWORD tidak ada di .env`);
    }

    // ── A5 + A6 — Wakasek SMP ──────────────────────────────────────────────
    const wsInfo = userMap['UJI_SMP_WAKA_KESISWAAN'];
    const wsPwd  = process.env.UJI_SMP_WAKA_KESISWAAN_PASSWORD;
    if (wsInfo && wsPwd) {
        await cekPiket(browser, {
            label: 'A5 · Wakasek SMP · Keterlambatan',
            slug:        wsInfo.school_slug,
            nip:         wsInfo.nip,
            password:    wsPwd,
            auth_user_id: wsInfo.auth_user_id,
            tabKey:      'wakasek',
            sectionCardId: 'wk-late-card',
            filterBtnId:   'wk-late-filter-btn',
            startInputId:  'wk-late-start',
            endInputId:    'wk-late-end',
            contentId:     'wk-late-recap',
            tabel:         'late_arrivals',
            kolom_tanggal: 'late_date',
        });
        await cekPiket(browser, {
            label: 'A6 · Wakasek SMP · Izin Keluar',
            slug:        wsInfo.school_slug,
            nip:         wsInfo.nip,
            password:    wsPwd,
            auth_user_id: wsInfo.auth_user_id,
            tabKey:      'wakasek',
            sectionCardId: 'wk-exit-card',
            filterBtnId:   'wk-exit-filter-btn',
            startInputId:  'wk-exit-start',
            endInputId:    'wk-exit-end',
            contentId:     'wk-exit-recap',
            tabel:         'student_exits',
            kolom_tanggal: 'exit_date',
        });
    } else {
        log.skip(`A5/A6: UJI_SMP_WAKA_KESISWAAN atau UJI_SMP_WAKA_KESISWAAN_PASSWORD tidak ada di .env`);
    }

    // ── A7 + A8 — Wali Kelas SMK ───────────────────────────────────────────
    const waliInfo = userMap['UJI_SMK_WALI'];
    const waliPwd  = process.env.UJI_SMK_WALI_PASSWORD;
    if (waliInfo && waliPwd) {
        await cekPiket(browser, {
            label: `A7 · Wali SMK · Keterlambatan`,
            slug:        waliInfo.school_slug,
            nip:         waliInfo.nip,
            password:    waliPwd,
            auth_user_id: waliInfo.auth_user_id,
            tabKey:      'wali_kelas',
            sectionCardId: 'wali-terlambat-card',
            filterBtnId:   'wali-late-filter-btn',
            startInputId:  'wali-late-date-start',
            endInputId:    'wali-late-date-end',
            contentId:     'wali-late-content',
            tabel:         'late_arrivals',
            kolom_tanggal: 'late_date',
            countRows:     true,
        });
        await cekPiket(browser, {
            label: `A8 · Wali SMK · Izin Keluar`,
            slug:        waliInfo.school_slug,
            nip:         waliInfo.nip,
            password:    waliPwd,
            auth_user_id: waliInfo.auth_user_id,
            tabKey:      'wali_kelas',
            sectionCardId: 'wali-keluar-card',
            filterBtnId:   'wali-exit-filter-btn',
            startInputId:  'wali-exit-date-start',
            endInputId:    'wali-exit-date-end',
            contentId:     'wali-exit-content',
            tabel:         'student_exits',
            kolom_tanggal: 'exit_date',
            countRows:     true,
        });
    } else {
        log.skip('A7/A8: UJI_SMK_WALI atau UJI_SMK_WALI_PASSWORD tidak ada di .env');
    }

    // ── A9 + A10 — Kaprodi SMK ─────────────────────────────────────────────
    const kpInfo = userMap['UJI_SMK_KAPRODI'];
    const kpPwd  = process.env.UJI_SMK_KAPRODI_PASSWORD;
    if (kpInfo && kpPwd) {
        await cekPiket(browser, {
            label: 'A9 · Kaprodi SMK · Keterlambatan',
            slug:        kpInfo.school_slug,
            nip:         kpInfo.nip,
            password:    kpPwd,
            auth_user_id: kpInfo.auth_user_id,
            tabKey:      'kaprodi',
            sectionCardId: 'kp-late-card',
            filterBtnId:   'kp-late-filter-btn',
            startInputId:  'kp-late-start',
            endInputId:    'kp-late-end',
            contentId:     'kp-late-recap',
            tabel:         'late_arrivals',
            kolom_tanggal: 'late_date',
        });
        await cekPiket(browser, {
            label: 'A10 · Kaprodi SMK · Izin Keluar',
            slug:        kpInfo.school_slug,
            nip:         kpInfo.nip,
            password:    kpPwd,
            auth_user_id: kpInfo.auth_user_id,
            tabKey:      'kaprodi',
            sectionCardId: 'kp-exit-card',
            filterBtnId:   'kp-exit-filter-btn',
            startInputId:  'kp-exit-start',
            endInputId:    'kp-exit-end',
            contentId:     'kp-exit-recap',
            tabel:         'student_exits',
            kolom_tanggal: 'exit_date',
        });
    } else {
        log.skip('A9/A10: UJI_SMK_KAPRODI atau UJI_SMK_KAPRODI_PASSWORD tidak ada di .env');
    }

} finally {
    await browser.close();
}

// ── Ringkasan ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`PIKET AGREGASI WEB: ${lulus} lulus, ${gagal} gagal, ${lewat} dilewati`);
if (gagal > 0) process.exit(1);
