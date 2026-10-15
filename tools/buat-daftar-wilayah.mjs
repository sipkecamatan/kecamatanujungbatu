#!/usr/bin/env node
/**
 * tools/buat-daftar-wilayah.mjs
 *
 * Membuat daftar wilayah resmi satu provinsi (kabupaten/kota dan kecamatan, berkode
 * Kemendagri/BPS) untuk dropdown portal superadmin, lalu memperbarui indeksnya.
 *
 * Sumber: https://emsifa.github.io/api-wilayah-indonesia
 *
 * Pemakaian:
 *   node tools/buat-daftar-wilayah.mjs 14          # Riau
 *   node tools/buat-daftar-wilayah.mjs 13 15 16    # beberapa provinsi sekaligus
 *   OUT_DIR=<folder> node tools/buat-daftar-wilayah.mjs 14   # tulis ke folder lain
 *
 * Hasil: <OUT_DIR>/wilayah-<nama-provinsi>.json dan <OUT_DIR>/index.json.
 * Setelah itu commit berkas-berkas itu dan push; portal membacanya tanpa perubahan kode.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT_DIR || join(ROOT, 'superadmin', 'data');
const API = 'https://emsifa.github.io/api-wilayah-indonesia/api';

const judul = (s) => s.toLowerCase().split(/\s+/).filter(Boolean)
    .map((w) => (/^[ivx]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const rapikan = (s) => String(s).replace(/\bS I A K\b/i, 'SIAK').replace(/\bD U M A I\b/i, 'DUMAI').replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function ambil(path) {
    const res = await fetch(`${API}/${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
}

async function buat(kodeProv) {
    const provinsi = (await ambil('provinces.json')).find((p) => p.id === kodeProv);
    if (!provinsi) throw new Error(`provinsi ${kodeProv} tidak ditemukan`);
    const nama = judul(rapikan(provinsi.name));
    const regencies = await ambil(`regencies/${kodeProv}.json`);

    const kabupaten = [];
    for (const r of regencies) {
        const bersih = rapikan(r.name);
        const kota = /^KOTA\b/i.test(bersih);
        const districts = await ambil(`districts/${r.id}.json`);
        kabupaten.push({
            kode: r.id,
            jenis: kota ? 'KOTA' : 'KABUPATEN',
            nama: judul(bersih.replace(/^(KABUPATEN|KOTA)\s+/i, '')),
            kecamatan: districts.map((d) => ({ kode: d.id, nama: judul(rapikan(d.name)) })),
        });
    }

    const semua = kabupaten.flatMap((k) => k.kecamatan.map((c) => c.kode));
    if (new Set(semua).size !== semua.length) throw new Error('kode kecamatan ganda');
    if (!kabupaten.length) throw new Error('tidak ada kabupaten/kota');

    const berkas = `wilayah-${slug(nama)}.json`;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, berkas), JSON.stringify({
        provinsi: { kode: kodeProv, nama },
        sumber: `${API} (kode Kemendagri/BPS), diambil ${new Date().toISOString().slice(0, 10)}`,
        catatan: 'Nama ditulis ulang dari huruf besar; kode wilayah mengikuti sumber. Periksa bila ada pemekaran baru.',
        kabupaten,
    }, null, 1) + '\n');

    // indeks
    const fIndeks = join(OUT, 'index.json');
    const indeks = existsSync(fIndeks) ? JSON.parse(readFileSync(fIndeks, 'utf8')) : [];
    const sisa = indeks.filter((p) => p.kode !== kodeProv);
    sisa.push({ kode: kodeProv, nama, berkas });
    sisa.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    writeFileSync(fIndeks, JSON.stringify(sisa, null, 1) + '\n');

    console.log(`${nama} (${kodeProv}): ${kabupaten.length} kabupaten/kota, ${semua.length} kecamatan -> ${berkas}`);
}

const kode = process.argv.slice(2);
if (!kode.length) { console.error('Pemakaian: node tools/buat-daftar-wilayah.mjs <kode provinsi> [...]'); process.exit(2); }
for (const k of kode) await buat(k.trim());
