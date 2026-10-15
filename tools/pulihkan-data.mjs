#!/usr/bin/env node
/**
 * tools/pulihkan-data.mjs
 *
 * Memulihkan data dari folder cadangan (hasil tools/cadangan-data.mjs) ke proyek yang
 * sedang ter-link. Dirancang untuk LATIHAN PULIH pada proyek uji kosong yang sudah
 * menerapkan seluruh migrasi (`supabase db push`), bukan untuk produksi.
 *
 * Pengaman:
 *  - Proyek tujuan harus disebut eksplisit: --proyek <ref>, dan harus sama dengan proyek
 *    yang ter-link (supabase\.temp\project-ref).
 *  - Memulihkan ke proyek produksi butuh --produksi-ya-saya-yakin.
 *  - Baris yang sudah ada dilewati (tidak menimpa).
 *
 * Pemakaian (PowerShell), setelah `supabase link --project-ref <ref uji>`:
 *   node tools/pulihkan-data.mjs "D:\...\SIP Kecamatan-cadangan\20261015-153000" --proyek <ref uji>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jalankanSql, sqlDaftarTabel, sqlKolom, sqlKunciAsing, sqlHitung, urutkanTabel, sqlPulihBaris } from './cadangan-lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUKSI = 'lqgzpiohxdzkkmxjtwor';
const arg = (nama) => { const i = process.argv.indexOf(nama); return i >= 0 ? process.argv[i + 1] : null; };
const sumber = process.argv[2];
const proyek = arg('--proyek');
const BAGIAN = 200;

if (!sumber || sumber.startsWith('--') || !existsSync(join(sumber, 'manifest.json'))) {
    console.error('Pemakaian: node tools/pulihkan-data.mjs <folder cadangan> --proyek <ref>');
    process.exit(2);
}
const refTerhubung = readFileSync(join(REPO, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
if (!proyek) { console.error('--proyek <ref> wajib disebut.'); process.exit(2); }
if (proyek !== refTerhubung) {
    console.error(`Proyek yang ter-link (${refTerhubung}) berbeda dari --proyek (${proyek}). Jalankan supabase link dulu.`);
    process.exit(2);
}
if (proyek === PRODUKSI && !process.argv.includes('--produksi-ya-saya-yakin')) {
    console.error('Tujuan adalah proyek produksi. Tambahkan --produksi-ya-saya-yakin hanya bila Anda sungguh yakin.');
    process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(sumber, 'manifest.json'), 'utf8'));
console.log(`Memulihkan cadangan ${manifest.dibuat} (proyek asal ${manifest.proyek}) -> ${proyek}`);

const tabelTujuan = new Set(jalankanSql(sqlDaftarTabel).map((r) => r.table_name));
const adaBerkas = readdirSync(sumber).filter((f) => f.endsWith('.ndjson')).map((f) => f.replace(/\.ndjson$/, ''));
const tabel = urutkanTabel(adaBerkas.filter((t) => tabelTujuan.has(t)), jalankanSql(sqlKunciAsing));
const hilang = adaBerkas.filter((t) => !tabelTujuan.has(t));
if (hilang.length) console.log(`Dilewati (tabel tidak ada di tujuan): ${hilang.join(', ')}`);

let ringkas = [];
for (const t of tabel) {
    const baris = readFileSync(join(sumber, `${t}.ndjson`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (!baris.length) continue;
    const kolom = jalankanSql(sqlKolom(t)).map((r) => r.column_name);
    const sebelum = jalankanSql(sqlHitung(t))[0].n;
    for (let i = 0; i < baris.length; i += BAGIAN) {
        const sql = sqlPulihBaris(t, kolom, baris.slice(i, i + BAGIAN));
        jalankanSql(sql);
    }
    const sesudah = jalankanSql(sqlHitung(t))[0].n;
    ringkas.push({ t, cadangan: baris.length, sebelum, sesudah });
    console.log(`  ${t}: ${baris.length} baris cadangan; tabel ${sebelum} -> ${sesudah}`);
}
const kurang = ringkas.filter((r) => r.sesudah < r.cadangan);
console.log(kurang.length
    ? `\nPERHATIAN: ${kurang.length} tabel berisi lebih sedikit dari cadangan: ${kurang.map((r) => r.t).join(', ')}`
    : `\nSelesai: ${ringkas.length} tabel dipulihkan.`);
process.exit(kurang.length ? 1 : 0);
