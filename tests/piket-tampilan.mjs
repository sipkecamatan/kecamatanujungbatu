#!/usr/bin/env node
/**
 * tests/piket-tampilan.mjs
 *
 * Verifikasi tampilan piket sections — Layer T.
 *
 * T1. Template "Belum kembali" berwarna merah (color-danger) untuk return_time IS NULL
 *     — dicek di: tab-bk.js, tab-kaprodi.js, tab-waka-kesiswaan.js, tab-wali.js
 * T2. Pesan kosong "Tidak ada catatan" tersedia untuk kedua tabel (keterlambatan + keluar)
 * T3. Semua .kp-acc-body piket section default display:none di dashboard.html
 * T4. Dropdown kelas piket tersedia di HTML dengan option default
 * T5. Tombol ↓ Excel piket default display:none di dashboard.html
 * T6. Validasi rentang tanggal tidak valid ada di source (pesan merah)
 * T7a. downloadLateExcel — kolom benar (tanpa/dengan withKelas, withRecorder)
 * T7b. downloadExitExcel — kolom benar (tanpa/dengan withKelas, withRecorder)
 * T7c. downloadExitExcel — return_time null → '—' di kolom Jam Kembali
 *      (Belum kembali hanya di HTML render, bukan di Excel; Excel pakai '—')
 *
 * CARA JALANKAN:
 *   node tests/piket-tampilan.mjs
 *
 * EXIT CODE: 0 = semua lulus, 1 = ada kegagalan
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }                                            from 'node:os';
import { join, dirname }                                     from 'node:path';
import { fileURLToPath, pathToFileURL }                      from 'node:url';

const DIR  = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ── Logger ──────────────────────────────────────────────────────────────────
let lulus = 0, gagal = 0;
const log = {
    pass: (m) => { lulus++;  console.log(`  ✓ ${m}`); },
    fail: (m) => { gagal++;  console.log(`  ✗ FAIL: ${m}`); },
    head: (m) => console.log(`\n══ ${m}`),
};

// ── Baca sumber ─────────────────────────────────────────────────────────────
const html    = read('guru/dashboard.html');
const srcBk   = read('guru/js/tab-bk.js');
const srcKp   = read('guru/js/tab-kaprodi.js');
const srcWk   = read('guru/js/tab-waka-kesiswaan.js');
const srcWali = read('guru/js/tab-wali.js');

// ────────────────────────────────────────────────────────────────────────────
// GRUP 1 — Pemeriksaan statis HTML
// ────────────────────────────────────────────────────────────────────────────
log.head('T3 · T4 · T5 — Struktur HTML awal piket section');

// Piket section IDs yang kita uji (body acc + tombol excel + dropdown kelas)
const SEKSI = [
    // [prefiks, id-body, id-excel-btn, id-select-kelas, label]
    ['wali', 'wali-terlambat-card', 'wali-late-excel-btn', 'wali-late-date-start',   'Wali · Keterlambatan'],
    ['wali', 'wali-keluar-card',    'wali-exit-excel-btn', 'wali-exit-date-start',   'Wali · Izin Keluar'],
    ['bk',   'bk-late-card',       'bk-late-excel-btn',   'bk-late-class',          'BK · Keterlambatan'],
    ['bk',   'bk-exit-card',       'bk-exit-excel-btn',   'bk-exit-class',          'BK · Izin Keluar'],
    ['kp',   'kp-late-card',       'kp-late-excel-btn',   'kp-late-class',          'Kaprodi · Keterlambatan'],
    ['kp',   'kp-exit-card',       'kp-exit-excel-btn',   'kp-exit-class',          'Kaprodi · Izin Keluar'],
    ['wk',   'wk-late-card',       'wk-late-excel-btn',   'wk-late-class',          'Waka · Keterlambatan'],
    ['wk',   'wk-exit-card',       'wk-exit-excel-btn',   'wk-exit-class',          'Waka · Izin Keluar'],
];

for (const [, cardId, excelBtnId, selectOrInputId, label] of SEKSI) {
    // T3 — body default tertutup (display:none di dalam card ini)
    const cardIdx = html.indexOf(`id="${cardId}"`);
    if (cardIdx === -1) {
        log.fail(`T3 · ${label}: id="${cardId}" tidak ditemukan di HTML`);
        continue;
    }
    // Ambil snippet dalam card (~600 char) — cukup untuk menemukan kp-acc-body
    const snippet = html.slice(cardIdx, cardIdx + 800);
    const hasHiddenBody = /class="kp-acc-body[^"]*"[^>]*style="[^"]*display\s*:\s*none/.test(snippet)
        || /style="[^"]*display\s*:\s*none[^"]*"[^>]*class="kp-acc-body/.test(snippet);
    hasHiddenBody
        ? log.pass(`T3 · ${label}: .kp-acc-body default display:none`)
        : log.fail(`T3 · ${label}: .kp-acc-body TIDAK display:none di HTML`);

    // T5 — tombol Excel default tersembunyi
    const btnIdx = html.indexOf(`id="${excelBtnId}"`);
    if (btnIdx === -1) {
        log.fail(`T5 · ${label}: id="${excelBtnId}" tidak ditemukan di HTML`);
        continue;
    }
    // Cari style="display:none" di tag yang mengandung id ini
    const btnLine = html.slice(Math.max(0, btnIdx - 100), btnIdx + 150);
    const hasNone = /display\s*:\s*none/.test(btnLine);
    hasNone
        ? log.pass(`T5 · ${label}: tombol Excel default display:none`)
        : log.fail(`T5 · ${label}: tombol Excel TIDAK display:none di HTML`);

    // T4 — dropdown / input kelas ada di HTML
    const selExists = html.includes(`id="${selectOrInputId}"`);
    selExists
        ? log.pass(`T4 · ${label}: elemen filter "${selectOrInputId}" ditemukan`)
        : log.fail(`T4 · ${label}: elemen filter "${selectOrInputId}" TIDAK ditemukan`);
}

// Dropdown kelas piket (BK/Kaprodi/Waka) punya option "Semua kelas"
for (const selId of ['bk-late-class', 'bk-exit-class', 'kp-late-class', 'kp-exit-class', 'wk-late-class', 'wk-exit-class']) {
    const idx = html.indexOf(`id="${selId}"`);
    if (idx === -1) { log.fail(`T4 · dropdown ${selId} tidak ada di HTML`); continue; }
    const snippet = html.slice(idx, idx + 200);
    snippet.includes('Semua kelas')
        ? log.pass(`T4 · dropdown ${selId}: option "Semua kelas" ditemukan`)
        : log.fail(`T4 · dropdown ${selId}: option default "Semua kelas" TIDAK ditemukan`);
}

// ────────────────────────────────────────────────────────────────────────────
// GRUP 2 — Pattern source: T1 · T2 · T6
// ────────────────────────────────────────────────────────────────────────────
log.head('T1 · T2 · T6 — Pola source JS');

const SUMBER = [
    ['tab-bk.js',               srcBk,   'bk'],
    ['tab-kaprodi.js',          srcKp,   'kp'],
    ['tab-waka-kesiswaan.js',   srcWk,   'wk'],
    ['tab-wali.js',             srcWali, 'wali'],
];

for (const [namaFile, src] of SUMBER) {
    // T1 — Template "Belum kembali" dengan color-danger di fungsi exit recap
    const punya_belum_kembali = src.includes('Belum kembali') && src.includes('color-danger');
    punya_belum_kembali
        ? log.pass(`T1 · ${namaFile}: template "Belum kembali" dengan color-danger ditemukan`)
        : log.fail(`T1 · ${namaFile}: template "Belum kembali" / color-danger TIDAK ditemukan`);

    // T2 — Pesan kosong "Tidak ada catatan"
    const punya_kosong_late = src.includes('Tidak ada catatan keterlambatan');
    const punya_kosong_exit = src.includes('Tidak ada catatan izin keluar');
    punya_kosong_late
        ? log.pass(`T2 · ${namaFile}: pesan kosong keterlambatan ditemukan`)
        : log.fail(`T2 · ${namaFile}: pesan kosong keterlambatan TIDAK ditemukan`);
    punya_kosong_exit
        ? log.pass(`T2 · ${namaFile}: pesan kosong izin keluar ditemukan`)
        : log.fail(`T2 · ${namaFile}: pesan kosong izin keluar TIDAK ditemukan`);
}

// T6 — Validasi tanggal tidak valid (hanya di tab dengan validasi eksplisit)
for (const [namaFile, src] of [['tab-bk.js', srcBk], ['tab-kaprodi.js', srcKp], ['tab-waka-kesiswaan.js', srcWk]]) {
    const punyaValidasi = src.includes('Rentang tanggal tidak valid') || src.includes('tidak valid');
    punyaValidasi
        ? log.pass(`T6 · ${namaFile}: validasi rentang tanggal ditemukan`)
        : log.fail(`T6 · ${namaFile}: validasi rentang tanggal TIDAK ditemukan`);
}

// ────────────────────────────────────────────────────────────────────────────
// GRUP 3 — Fungsi download Excel (T7)
// ────────────────────────────────────────────────────────────────────────────
log.head('T7 — downloadLateExcel + downloadExitExcel kolom dan format');

// Buat salinan tab-shared.js di temp dir dengan import stripped
const tmpDir = mkdtempSync(join(tmpdir(), 'piket-tampilan-'));
try {
    const srcShared = read('guru/js/tab-shared.js');
    // Strip import dari branding.js (hanya diperlukan fungsi lain, bukan download Excel)
    const stripped = srcShared
        .replace(/^import\s+.*?from\s+['"][^'"]+['"];\s*\n/gm, '')
        .replace(/^import\s+.*?\n/gm, '');
    writeFileSync(join(tmpDir, 'tab-shared.mjs'), stripped, 'utf8');

    // Sediakan global mock untuk XLSX dan DOM API
    let capturedAoa = null;
    let capturedSheetName = null;
    globalThis.XLSX = {
        utils: {
            aoa_to_sheet: (data) => { capturedAoa = data; return { _data: data }; },
            book_new: () => ({ _sheets: {} }),
            book_append_sheet: (wb, ws, name) => { capturedSheetName = name; },
        },
        write: () => new Uint8Array([1, 2, 3]),
    };
    globalThis.URL = {
        createObjectURL: () => 'blob:mock',
        revokeObjectURL: () => {},
    };
    globalThis.document = {
        createElement: () => ({ href: '', download: '', click: () => {} }),
    };

    const mod = await import(pathToFileURL(join(tmpDir, 'tab-shared.mjs')).href);
    const { downloadLateExcel, downloadExitExcel } = mod;

    const barisSiswa = { date: '2026-11-01', student_name: 'Budi', nis: '001', class_name: 'X RPL 1', arrival_time: '07:30:00', reason: 'terlambat', recorder: 'Pak Guru' };
    const barisKeluar = { date: '2026-11-01', student_name: 'Citra', nis: '002', class_name: 'X RPL 1', exit_time: '10:00:00', return_time: null, reason: 'sakit', recorder: 'Pak Guru' };

    // T7a — downloadLateExcel tanpa opsi (Wali)
    capturedAoa = null; capturedSheetName = null;
    downloadLateExcel([barisSiswa], 'test');
    const hdrWali = capturedAoa?.[0];
    const ekspekWali = ['Tanggal', 'Nama Siswa', 'NIS', 'Jam Masuk', 'Alasan'];
    JSON.stringify(hdrWali) === JSON.stringify(ekspekWali)
        ? log.pass(`T7a · downloadLateExcel tanpa opsi: kolom [${hdrWali?.join(', ')}]`)
        : log.fail(`T7a · downloadLateExcel tanpa opsi: ekspek [${ekspekWali.join(', ')}], dapat [${hdrWali?.join(', ')}]`);
    capturedSheetName === 'Keterlambatan'
        ? log.pass(`T7a · sheet name "Keterlambatan"`)
        : log.fail(`T7a · sheet name ekspek "Keterlambatan", dapat "${capturedSheetName}"`);

    // T7a — downloadLateExcel dengan withKelas + withRecorder (BK/Kaprodi/Waka)
    capturedAoa = null;
    downloadLateExcel([barisSiswa], 'test', { withKelas: true, withRecorder: true });
    const hdrBk = capturedAoa?.[0];
    const ekspekBk = ['Tanggal', 'Nama Siswa', 'NIS', 'Kelas', 'Jam Masuk', 'Alasan', 'Dicatat Oleh'];
    JSON.stringify(hdrBk) === JSON.stringify(ekspekBk)
        ? log.pass(`T7a · downloadLateExcel withKelas+withRecorder: kolom [${hdrBk?.join(', ')}]`)
        : log.fail(`T7a · downloadLateExcel withKelas+withRecorder: ekspek [${ekspekBk.join(', ')}], dapat [${hdrBk?.join(', ')}]`);

    // T7a — data row: jam masuk diambil 5 karakter dari arrival_time
    const dataRowLate = capturedAoa?.[1];
    dataRowLate?.[4] === '07:30'
        ? log.pass(`T7a · arrival_time diformat 5 karakter: "${dataRowLate[4]}"`)
        : log.fail(`T7a · arrival_time ekspek "07:30", dapat "${dataRowLate?.[4]}"`);

    // T7b — downloadExitExcel tanpa opsi
    capturedAoa = null; capturedSheetName = null;
    downloadExitExcel([barisKeluar], 'test');
    const hdrExitWali = capturedAoa?.[0];
    const ekspekExitWali = ['Tanggal', 'Nama Siswa', 'NIS', 'Jam Keluar', 'Jam Kembali', 'Alasan'];
    JSON.stringify(hdrExitWali) === JSON.stringify(ekspekExitWali)
        ? log.pass(`T7b · downloadExitExcel tanpa opsi: kolom [${hdrExitWali?.join(', ')}]`)
        : log.fail(`T7b · downloadExitExcel tanpa opsi: ekspek [${ekspekExitWali.join(', ')}], dapat [${hdrExitWali?.join(', ')}]`);
    capturedSheetName === 'Izin Keluar'
        ? log.pass(`T7b · sheet name "Izin Keluar"`)
        : log.fail(`T7b · sheet name ekspek "Izin Keluar", dapat "${capturedSheetName}"`);

    // T7b — downloadExitExcel dengan withKelas + withRecorder
    capturedAoa = null;
    downloadExitExcel([barisKeluar], 'test', { withKelas: true, withRecorder: true });
    const hdrExitBk = capturedAoa?.[0];
    const ekspekExitBk = ['Tanggal', 'Nama Siswa', 'NIS', 'Kelas', 'Jam Keluar', 'Jam Kembali', 'Alasan', 'Dicatat Oleh'];
    JSON.stringify(hdrExitBk) === JSON.stringify(ekspekExitBk)
        ? log.pass(`T7b · downloadExitExcel withKelas+withRecorder: kolom [${hdrExitBk?.join(', ')}]`)
        : log.fail(`T7b · downloadExitExcel withKelas+withRecorder: ekspek [${ekspekExitBk.join(', ')}], dapat [${hdrExitBk?.join(', ')}]`);

    // T7c — return_time null → '—' di Excel (bukan span HTML)
    const dataRowExit = capturedAoa?.[1];
    const idxKembali  = hdrExitBk.indexOf('Jam Kembali');
    dataRowExit?.[idxKembali] === '—'
        ? log.pass(`T7c · return_time null → '—' di Excel (bukan span HTML merah)`)
        : log.fail(`T7c · return_time null: ekspek '—', dapat "${dataRowExit?.[idxKembali]}"`);

    // T7b — tanggal diformat dd Mon yyyy
    const dataRowExitNakedDate = capturedAoa?.[1];
    const tglFormatted = dataRowExitNakedDate?.[0];
    tglFormatted === '1 Nov 2026'
        ? log.pass(`T7b · tanggal diformat "1 Nov 2026"`)
        : log.fail(`T7b · format tanggal ekspek "1 Nov 2026", dapat "${tglFormatted}"`);

    // T7a — nilai null diganti '—' (student_name, nis)
    capturedAoa = null;
    downloadLateExcel([{ date: null, student_name: null, nis: null, arrival_time: null, reason: '' }], 'test');
    const rowNull = capturedAoa?.[1];
    const allDash = rowNull?.[1] === '—' && rowNull?.[2] === '—' && rowNull?.[3] === '—';
    allDash
        ? log.pass(`T7a · nilai null → '—' (student_name, nis, arrival_time)`)
        : log.fail(`T7a · nilai null tidak diganti '—': ${JSON.stringify(rowNull)}`);

} finally {
    rmSync(tmpDir, { recursive: true, force: true });
}

// ── Ringkasan ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`PIKET TAMPILAN: ${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);
