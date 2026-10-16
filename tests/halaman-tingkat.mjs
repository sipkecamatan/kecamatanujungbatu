// Uji penjaga: tiga halaman dasbor (kecamatan, kabupaten, provinsi) harus identik kecuali judul, tingkat, dan jalur
// berkas bersama; alamat pada app.js dan portal superadmin harus menunjuk halaman yang benar-benar ada.
//   node tests/halaman-tingkat.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const baca = (p) => readFileSync(new URL(p, ROOT), 'utf8');
let lulus = 0;
const uji = (nama, fn) => { fn(); console.log(`PASS TINGKAT ${++lulus}: ${nama}`); };

const HALAMAN = [
  { dir: 'kecamatan', tingkat: 'KECAMATAN', label: 'Kecamatan' },
  { dir: 'kabupaten', tingkat: 'KABUPATEN', label: 'Kabupaten' },
  { dir: 'provinsi', tingkat: 'PROVINSI', label: 'Provinsi' },
];

// Kembalikan HTML ke bentuk netral agar ketiganya dapat dibandingkan.
const netral = (html, { tingkat, label, dir }) => html
  .replaceAll(`Dashboard ${label}`, 'Dashboard {LABEL}')
  .replace(`<body data-tingkat="${tingkat}">`, '<body data-tingkat="{TINGKAT}">')
  .replaceAll(dir === 'kecamatan' ? 'href="css/kecamatan.css"' : 'href="../kecamatan/css/kecamatan.css"', 'href="{CSS}"')
  .replaceAll(dir === 'kecamatan' ? 'src="js/app.js"' : 'src="../kecamatan/js/app.js"', 'src="{JS}"');

const html = Object.fromEntries(HALAMAN.map((h) => [h.dir, baca(`${h.dir}/index.html`)]));

uji('ketiga halaman ada', () => {
  for (const h of HALAMAN) assert.ok(existsSync(new URL(`${h.dir}/index.html`, ROOT)), h.dir);
});
uji('tiap halaman memuat data-tingkat dan judul yang benar tepat satu kali', () => {
  for (const h of HALAMAN) {
    const t = html[h.dir];
    assert.equal(t.split(`<body data-tingkat="${h.tingkat}">`).length - 1, 1, `${h.dir}: data-tingkat`);
    assert.equal(t.split(`<title>Dashboard ${h.label} — SIP</title>`).length - 1, 1, `${h.dir}: title`);
    assert.equal(t.split(`<h1>Dashboard ${h.label}</h1>`).length - 1, 1, `${h.dir}: h1`);
    for (const lain of HALAMAN.filter((x) => x.dir !== h.dir)) {
      assert.ok(!t.includes(`Dashboard ${lain.label}`), `${h.dir} memuat judul ${lain.label}`);
    }
  }
});
uji('ketiga halaman identik setelah judul, tingkat, dan jalur dinetralkan', () => {
  const dasar = netral(html.kecamatan, HALAMAN[0]);
  for (const h of HALAMAN.slice(1)) assert.equal(netral(html[h.dir], h), dasar, `${h.dir} menyimpang dari kecamatan`);
});
uji('halaman kabupaten dan provinsi memakai berkas bersama milik kecamatan yang benar-benar ada', () => {
  for (const h of HALAMAN.slice(1)) {
    assert.ok(html[h.dir].includes('href="../kecamatan/css/kecamatan.css"') && html[h.dir].includes('src="../kecamatan/js/app.js"'), h.dir);
  }
  assert.ok(existsSync(new URL('kecamatan/css/kecamatan.css', ROOT)) && existsSync(new URL('kecamatan/js/app.js', ROOT)));
});

const app = baca('kecamatan/js/app.js');
uji('app.js memetakan setiap tingkat ke halaman yang ada dan mengalihkan hanya ke daftar tetap itu', () => {
  const m = app.match(/const ALAMAT_TINGKAT = \{([^}]*)\}/);
  assert.ok(m, 'ALAMAT_TINGKAT tidak ditemukan');
  for (const h of HALAMAN) {
    assert.ok(new RegExp(`${h.tingkat}:\\s*'\\.\\./${h.dir}/'`).test(m[1]), `${h.tingkat} -> ../${h.dir}/`);
  }
  assert.ok(app.includes('location.replace(new URL(ALAMAT_TINGKAT[data.tingkat], location.href).href)'));
  assert.ok(/data\.tingkat !== TINGKAT_HALAMAN/.test(app));
  assert.ok(app.includes("document.body.dataset.tingkat || 'KECAMATAN'"));
});
uji('portal superadmin memberi tautan menurut jenis wilayah yang sama', () => {
  const sa = baca('superadmin/js/dashboard.js');
  assert.ok(/ALAMAT_DASBOR = \{ KABUPATEN: '\.\.\/kabupaten\/', PROVINSI: '\.\.\/provinsi\/' \}/.test(sa));
  assert.ok(sa.includes("ALAMAT_DASBOR[level] ?? '../kecamatan/'"));
  assert.ok(sa.includes('barisTautan(r.level)'));
});

console.log(`LULUS TINGKAT: ${lulus} uji`);
