#!/usr/bin/env node
/**
 * tools/cadangan-data.mjs
 *
 * Cadangan DATA seluruh tabel skema public proyek yang sedang ter-link
 * (`supabase link`). Tidak butuh Docker atau pg_dump; hanya CLI Supabase yang sudah login.
 *
 * Skema (tabel, fungsi, kebijakan) tidak diekspor: itu sudah ada di supabase/migrations.
 * Tidak termasuk: akun login (skema auth) dan berkas Storage. Pegawai wilayah yang
 * hilang didaftarkan ulang dari portal superadmin.
 *
 * Pemakaian (PowerShell):
 *   node tools/cadangan-data.mjs
 *   node tools/cadangan-data.mjs --tujuan "E:\cadangan-sip"
 *
 * Hasil: <tujuan>\<tanggal-jam>\<tabel>.ndjson dan manifest.json.
 * Bawaan tujuan: folder "SIP Kecamatan-cadangan" di samping folder repo (DI LUAR repo;
 * berkas cadangan memuat data nyata dan tidak boleh masuk repo publik).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jalankanSql, sqlDaftarTabel, sqlHalaman, sqlHitungSemua } from './cadangan-lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nama) => { const i = process.argv.indexOf(nama); return i >= 0 ? process.argv[i + 1] : null; };
const dasar = arg('--tujuan') || process.env.CADANGAN_DIR || join(REPO, '..', 'SIP Kecamatan-cadangan');
const UKURAN = 2000;

if (resolve(dasar).toLowerCase().startsWith(REPO.toLowerCase())) {
    console.error('Tujuan cadangan berada di dalam folder repo. Pilih folder di luar repo (repo ini publik).');
    process.exit(2);
}

const cap = new Date();
const stempel = cap.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const tujuan = join(dasar, stempel);
mkdirSync(tujuan, { recursive: true });

const refBerkas = join(REPO, 'supabase', '.temp', 'project-ref');
const ref = existsSync(refBerkas) ? readFileSync(refBerkas, 'utf8').trim() : 'tidak diketahui';

console.log(`Cadangan data proyek ${ref} -> ${tujuan}`);
const tabel = jalankanSql(sqlDaftarTabel).map((r) => r.table_name);
const hitung = {};
let total = 0, tak_cocok = 0;
const jumlahTabel = Object.fromEntries(jalankanSql(sqlHitungSemua(tabel)).map((r) => [r.t, r.n]));

for (const t of tabel) {
    const jumlah = jumlahTabel[t] ?? 0;
    const berkas = join(tujuan, `${t}.ndjson`);
    writeFileSync(berkas, '');
    let tertulis = 0;
    for (let mulai = 0; mulai < jumlah; mulai += UKURAN) {
        const isi = jalankanSql(sqlHalaman(t, UKURAN, mulai))[0].isi;
        const baris = typeof isi === 'string' ? JSON.parse(isi) : isi;
        appendFileSync(berkas, baris.map((b) => JSON.stringify(b)).join('\n') + (baris.length ? '\n' : ''));
        tertulis += baris.length;
    }
    hitung[t] = { baris_di_basis_data: jumlah, baris_tertulis: tertulis };
    total += tertulis;
    if (tertulis !== jumlah) tak_cocok++;
    if (jumlah > 0 || process.argv.includes('--rinci')) console.log(`  ${t}: ${tertulis}${tertulis !== jumlah ? ` (basis data: ${jumlah}, TIDAK COCOK)` : ''}`);
}

writeFileSync(join(tujuan, 'manifest.json'), JSON.stringify({
    dibuat: cap.toISOString(),
    proyek: ref,
    alat: 'tools/cadangan-data.mjs',
    skema: 'public',
    jumlah_tabel: tabel.length,
    jumlah_baris: total,
    tabel: hitung,
    tidak_termasuk: ['akun login (skema auth)', 'berkas Storage', 'skema dan fungsi (lihat supabase/migrations)'],
}, null, 1));

console.log(`\nSelesai: ${tabel.length} tabel, ${total} baris.`);
if (tak_cocok) {
    console.log(`PERHATIAN: ${tak_cocok} tabel berubah selama pencadangan atau tidak terbaca utuh; ulangi.`);
    process.exit(1);
}
