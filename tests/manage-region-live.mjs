#!/usr/bin/env node
/**
 * tests/manage-region-live.mjs
 *
 * Uji LIVE untuk fungsi edge manage-region: ensure_region, add_staff,
 * reset_staff_password, remove_staff, delete_region.
 *
 * Membuat data uji berkode 99 / 9999 / 9999999 (tidak ada di daftar resmi), lalu
 * MEMBERSIHKANNYA di akhir (blok finally). Tidak menyentuh data lain.
 *
 * Perlu:
 *   SUPERADMIN_KEY   kunci superadmin (JANGAN ditempel di chat atau berkas)
 * Opsional:
 *   SUPABASE_URL     bawaan: proyek ini
 *   SUPABASE_ANON_KEY bawaan: dibaca dari kecamatan/js/app.js (kunci anon memang publik)
 *   SERTAKAN_SEKOLAH=1  ikut menguji "wilayah dipakai sekolah ditolak"; membuat lalu
 *                       menghapus satu sekolah uji lewat provision-school dan delete-school.
 *
 * Jalankan (PowerShell):
 *   $env:SUPERADMIN_KEY = "<kunci>"
 *   node tests/manage-region-live.mjs
 *
 * EXIT CODE: 0 = semua lulus, 1 = ada yang gagal, 2 = galat persiapan.
 */
import { readFileSync } from 'node:fs';

const URL_BASE = (process.env.SUPABASE_URL || 'https://lqgzpiohxdzkkmxjtwor.supabase.co').replace(/\/$/, '');
const KEY = process.env.SUPERADMIN_KEY;
if (!KEY) { console.error('SUPERADMIN_KEY belum diatur.'); process.exit(2); }

let ANON = process.env.SUPABASE_ANON_KEY;
if (!ANON) {
    try {
        const src = readFileSync(new URL('../kecamatan/js/app.js', import.meta.url), 'utf8');
        ANON = (src.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
    } catch { /* biarkan */ }
}

let gagal = 0, lulus = 0;
const cek = (kondisi, pesan, detail = '') => {
    if (kondisi) { lulus++; console.log(`  ✓ ${pesan}`); }
    else { gagal++; console.log(`  ✗ ${pesan}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`); }
};

async function fn(nama, body, method = 'POST') {
    const res = await fetch(`${URL_BASE}/functions/v1/${nama}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-superadmin-key': KEY },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}
const region = (body) => fn('manage-region', body);

async function login(email, password) {
    const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON },
        body: JSON.stringify({ email, password }),
    });
    return res.status;
}

// delete-school mensyaratkan sekolah nonaktif dan dapat membalas sebagian (resume_from).
async function hapusSekolah(schoolId) {
    await fn('update-school-status', { school_id: schoolId, is_active: false }, 'PATCH');
    let resume = null;
    for (let i = 0; i < 6; i++) {
        const r = await fn('delete-school', { school_id: schoolId, ...(resume && { resume_from: resume }) }, 'DELETE');
        if (r.status >= 400) return { ok: false, status: r.status, error: r.json.error };
        if (r.json.status === 'complete') return { ok: true };
        resume = r.json.resume_from;
        if (!resume) return { ok: false, status: r.status, error: 'tanpa resume_from' };
    }
    return { ok: false, status: 0, error: 'terlalu banyak lanjutan' };
}

const PROV = { kode: '99', name: 'UJI Provinsi Otomatis', level: 'PROVINSI' };
const KAB  = { kode: '9999', name: 'UJI Kabupaten Otomatis', level: 'KABUPATEN' };
const KEC  = { kode: '9999999', name: 'UJI Kecamatan Otomatis, UJI Kabupaten Otomatis', level: 'KECAMATAN' };
const dibuat = { regions: [], staff: [], school: null };

async function bersihkan() {
    if (dibuat.school) {
        const r = await hapusSekolah(dibuat.school);
        if (!r.ok) console.log(`  ! sekolah uji ${dibuat.school} perlu dihapus manual (${r.status} ${r.error ?? ''})`);
    }
    for (const a of dibuat.staff) await region({ action: 'remove_staff', auth_user_id: a });
    // urutan bebas (wilayah bukan komando); coba semuanya
    for (const id of dibuat.regions) await region({ action: 'delete_region', region_id: id });
}

console.log(`manage-region live → ${URL_BASE}`);
try {
    console.log('\n── ensure_region');
    const ids = {};
    for (const w of [PROV, KAB, KEC]) {
        const r = await region({ action: 'ensure_region', ...w });
        cek(r.status === 200 && r.json.region?.region_id, `${w.level}: dibuat atau sudah ada`, JSON.stringify(r.json));
        if (r.json.region?.region_id) { ids[w.level] = r.json.region.region_id; dibuat.regions.push(r.json.region.region_id); }
    }
    const ulang = await region({ action: 'ensure_region', ...KEC });
    cek(ulang.status === 200 && ulang.json.dibuat === false, 'ensure_region idempoten (kedua kali tidak membuat baru)');
    const salah = await region({ action: 'ensure_region', kode: '12', name: 'UJI Kode Salah', level: 'KECAMATAN' });
    cek(salah.status === 400, 'kode dengan panjang salah untuk jenisnya ditolak 400', salah.status);

    console.log('\n── add_staff dan reset_staff_password');
    const email = `uji-wilayah-${Date.now()}@contoh.test`;
    const tambah = await region({ action: 'add_staff', region_id: ids.KECAMATAN, full_name: 'Pegawai Uji Otomatis', email });
    cek(tambah.status === 200 && tambah.json.password, 'add_staff berhasil dan mengembalikan kata sandi sementara', JSON.stringify(tambah.json));
    const sandiAwal = tambah.json.password;

    const daftar = await region({ action: 'list' });
    const pegawai = daftar.json.regions?.flatMap((r) => r.staff).find((s) => s.email === email);
    cek(!!pegawai, 'pegawai uji muncul pada daftar wilayah');
    if (pegawai) dibuat.staff.push(pegawai.auth_user_id);

    if (pegawai) {
        const loginAwal = ANON ? await login(email, sandiAwal) : null;
        cek(loginAwal === null || loginAwal === 200, 'login dengan kata sandi sementara awal berhasil', loginAwal);

        const reset = await region({ action: 'reset_staff_password', auth_user_id: pegawai.auth_user_id });
        cek(reset.status === 200 && reset.json.password && reset.json.password !== sandiAwal, 'reset_staff_password mengembalikan kata sandi baru yang berbeda', JSON.stringify(reset.json));
        if (ANON && reset.json.password) {
            cek(await login(email, reset.json.password) === 200, 'login dengan kata sandi baru berhasil');
            cek(await login(email, sandiAwal) !== 200, 'kata sandi lama tidak lagi berlaku');
        }
        const tidakAda = await region({ action: 'reset_staff_password', auth_user_id: '00000000-0000-4000-8000-000000000000' });
        cek(tidakAda.status === 404, 'reset untuk akun yang bukan pegawai wilayah ditolak 404', tidakAda.status);
        const tidakSah = await region({ action: 'reset_staff_password', auth_user_id: 'bukan-uuid' });
        cek(tidakSah.status === 400, 'auth_user_id tidak valid ditolak 400', tidakSah.status);
    }

    console.log('\n── delete_region: syarat pegawai');
    const tolakPegawai = await region({ action: 'delete_region', region_id: ids.KECAMATAN });
    cek(tolakPegawai.status === 409, 'wilayah yang masih punya pegawai ditolak 409', `${tolakPegawai.status} ${tolakPegawai.json.error ?? ''}`);

    if (pegawai) {
        const hapus = await region({ action: 'remove_staff', auth_user_id: pegawai.auth_user_id });
        cek(hapus.status === 200, 'remove_staff berhasil');
        dibuat.staff = dibuat.staff.filter((a) => a !== pegawai.auth_user_id);
    }

    if (process.env.SERTAKAN_SEKOLAH === '1') {
        console.log('\n── delete_region: syarat sekolah (membuat satu sekolah uji)');
        const sufiks = String(Date.now()).slice(-6);
        const sek = await fn('provision-school', {
            school_name: `UJI Sekolah Otomatis ${sufiks}`, admin_name: 'Admin Uji', admin_identifier: `99${sufiks}0000000000`.slice(0, 16),
            jenjang: 'SMA', region_id: ids.KECAMATAN, kabupaten_id: ids.KABUPATEN, provinsi_id: ids.PROVINSI,
        });
        cek(sek.status === 200 || sek.status === 201, 'provision-school menerima kabupaten_id dan provinsi_id', JSON.stringify(sek.json));
        dibuat.school = sek.json.school_id || null;
        if (dibuat.school) {
            for (const [nama, id] of [['kecamatan', ids.KECAMATAN], ['kabupaten', ids.KABUPATEN], ['provinsi', ids.PROVINSI]]) {
                const r = await region({ action: 'delete_region', region_id: id });
                cek(r.status === 409, `wilayah ${nama} yang dipakai sekolah ditolak 409`, `${r.status} ${r.json.error ?? ''}`);
            }
        }
    }

    console.log('\n── delete_region: urutan bebas (kabupaten lebih dulu dari kecamatan)');
    // Bersihkan sekolah uji (bila ada) agar wilayah tidak lagi dipakai.
    if (dibuat.school) {
        const h = await hapusSekolah(dibuat.school);
        cek(h.ok, 'sekolah uji dinonaktifkan dan dihapus', h.error);
        if (h.ok) dibuat.school = null;
    }
    const hapusKab = await region({ action: 'delete_region', region_id: ids.KABUPATEN });
    cek(hapusKab.status === 200, 'kabupaten dapat dihapus sebelum kecamatannya', `${hapusKab.status} ${hapusKab.json.error ?? ''}`);
    const hapusKec = await region({ action: 'delete_region', region_id: ids.KECAMATAN });
    cek(hapusKec.status === 200, 'kecamatan dapat dihapus setelah kabupatennya');
    const hapusProv = await region({ action: 'delete_region', region_id: ids.PROVINSI });
    cek(hapusProv.status === 200, 'provinsi dapat dihapus');
    const hilang = await region({ action: 'delete_region', region_id: ids.PROVINSI });
    cek(hilang.status === 404, 'menghapus wilayah yang sudah tidak ada memberi 404', hilang.status);
    dibuat.regions = [];
} catch (e) {
    console.error('GALAT:', e.message);
    gagal++;
} finally {
    await bersihkan();
}

console.log(`\n${'='.repeat(52)}\n${gagal === 0 ? '✅ LULUS' : '❌ GAGAL'} — ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
