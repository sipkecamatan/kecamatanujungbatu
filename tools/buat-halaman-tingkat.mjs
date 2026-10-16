// Membuat halaman masuk dasbor per tingkat dari kecamatan/index.html (sumber tunggal):
//   node tools/buat-halaman-tingkat.mjs
// kecamatan/index.html tetap sumbernya; kabupaten/index.html dan provinsi/index.html dibuat ulang darinya dan hanya
// berbeda pada judul, data-tingkat, dan jalur berkas bersama. Jalankan setiap kali kecamatan/index.html diubah.
// tests/halaman-tingkat.mjs memastikan ketiganya tidak menyimpang.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const sumber = readFileSync(new URL('kecamatan/index.html', ROOT), 'utf8');

// Bentuk netral kecamatan/index.html (judul Kecamatan) -> halaman tingkat tertentu.
const pasang = (html, { tingkat, label, bersama }) => {
  const awalan = bersama ? '../kecamatan/' : '';
  const ganti = [
    ['<title>Dashboard Kecamatan — SIP</title>', `<title>Dashboard ${label} — SIP</title>`],
    ['<h1>Dashboard Kecamatan</h1>', `<h1>Dashboard ${label}</h1>`],
    ['<div class="brand">Dashboard Kecamatan</div>', `<div class="brand">Dashboard ${label}</div>`],
    ['href="css/kecamatan.css"', `href="${awalan}css/kecamatan.css"`],
    ['src="js/app.js"', `src="${awalan}js/app.js"`],
    ['<body data-tingkat="KECAMATAN">', `<body data-tingkat="${tingkat}">`],
  ];
  let out = html;
  for (const [dari, ke] of ganti) {
    if (out.split(dari).length !== 2) throw new Error(`harus tepat satu kemunculan di kecamatan/index.html: ${dari}`);
    out = out.replace(dari, ke);
  }
  return out;
};

for (const h of [
  { dir: 'kabupaten', tingkat: 'KABUPATEN', label: 'Kabupaten', bersama: true },
  { dir: 'provinsi', tingkat: 'PROVINSI', label: 'Provinsi', bersama: true },
]) {
  mkdirSync(new URL(`${h.dir}/`, ROOT), { recursive: true });
  writeFileSync(new URL(`${h.dir}/index.html`, ROOT), pasang(sumber, h));
  console.log('ditulis', `${h.dir}/index.html`);
}
