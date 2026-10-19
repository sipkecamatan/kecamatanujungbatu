// Uji statis: panduan "Cara membaca nilai" (angka punya predikat, predikat punya rentang) tampil untuk SEMUA teknik/instrumen sumatif,
// dan nama predikat tampil di samping angka/predikat. Tanpa jaringan.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pen = readFileSync(join(ROOT, 'guru/js/penilaian.js'), 'utf8');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };

uji('arti generik untuk keempat predikat (tidak menyebut teknik tertentu)', () => {
  const blok = pen.slice(pen.indexOf('const PREDIKAT_ARTI'), pen.indexOf('const namaPredikat'));
  for (const p of ['SB', 'BSH', 'MB', 'BB']) assert.match(blok, new RegExp(p + ":\\s+'[^']{20,}'"), 'arti ' + p + ' hilang');
  assert.ok(!/tes tertulis|proyek|portofolio|praktik/i.test(blok), 'arti predikat tidak boleh spesifik teknik');
});
uji('kotak "Cara membaca nilai" memuat rentang tiap predikat, arti, cara mengisi tes vs non-tes, dan batas tercapai', () => {
  const fn = pen.slice(pen.indexOf('function panduanPredikatHtml'), pen.indexOf('function renderPanduanPredikat'));
  assert.match(fn, /Cara membaca nilai/);
  assert.match(fn, /\['SB', 'BSH', 'MB', 'BB'\]\.map/);
  assert.match(fn, /r\[0\] \+ '–' \+ r\[1\]/);
  assert.match(fn, /<strong>Tes:<\/strong> ketik angka/);
  assert.match(fn, /<strong>Non-tes<\/strong>/);
  assert.match(fn, /Tercapai bila nilai/);
});
uji('panduan memakai rentang TP terpilih, digambar saat panel sumatif dibuka dan saat TP diganti', () => {
  assert.match(pen, /el\.innerHTML = panduanPredikatHtml\(_sumCurrentRentang\(\)\)/);
  assert.match(pen, /function renderSumPage\(container\) \{\s*renderPanduanPredikat\(container\);/);
  assert.match(pen, /flushSumActive\(\); renderPanduanPredikat\(_sumSiswaContainer\); renderSumInput\(\);/);
  assert.match(pen, /<div id="sum-panduan"><\/div>/);
});
uji('nama predikat tampil di samping angka/predikat (tes, pilihan predikat, ketik angka) dan sebagai tooltip pada tombol predikat', () => {
  assert.equal((pen.match(/teksPredikat\(/g) ?? []).length >= 4, true, 'teksPredikat belum dipakai di semua tempat');
  assert.match(pen, /title="' \+ esc\(namaPredikat\(p\) \+ ': ' \+ PREDIKAT_ARTI\[p\]\)/);
});
console.log(`\nPENILAIAN_PREDIKAT_INFO: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
