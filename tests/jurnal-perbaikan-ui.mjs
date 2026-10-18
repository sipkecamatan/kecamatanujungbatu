// Uji statis: validasi rentang KKTP, nilai 0-100 dengan pesan ramah, penyegaran Rekap/Nilai Rapor setelah simpan, pesan catatan kosong.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const pen = src('guru/js/penilaian.js'), jur = src('guru/js/jurnal.js');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };

uji('KKTP: rentang tumpang tindih, terbalik, atau di luar 0-100 ditolak sebelum disimpan', () => {
  assert.ok(/function validasiRentangKktp\(rentang\)/.test(pen));
  assert.ok(pen.includes('tumpang tindih dengan'));
  assert.ok(/const galatRentang = validasiRentangKktp\(rentang\);\s*if \(galatRentang\) throw new Error\(galatRentang\);/.test(pen));
});
uji('KKTP: logika validasi benar (diuji langsung)', () => {
  const m = pen.match(/function validasiRentangKktp\(rentang\) \{[\s\S]*?\r?\n\}\r?\n/)[0];
  const PREDIKAT_RUBRIK = [{ val: 'BB' }, { val: 'MB' }, { val: 'BSH' }, { val: 'SB' }];
  const f = new Function('PREDIKAT_RUBRIK', m + '; return validasiRentangKktp;')(PREDIKAT_RUBRIK);
  assert.equal(f({ BB: [0, 54], MB: [55, 69], BSH: [70, 84], SB: [85, 100] }), null);
  assert.match(f({ BB: [0, 54], MB: [55, 69], BSH: [70, 84], SB: [80, 100] }), /tumpang tindih/);
  assert.match(f({ BB: [0, 54], MB: [55, 69], BSH: [84, 70], SB: [85, 100] }), /tidak boleh lebih besar/);
  assert.match(f({ BB: [0, 54], MB: [55, 69], BSH: [70, 84], SB: [85, 120] }), /0 dan 100/);
});
uji('Nilai di luar 0-100: ditolak di klien dengan nama siswa, dan galat database diubah menjadi kalimat ramah', () => {
  assert.ok(pen.includes("harus antara 0 dan 100.'"));
  assert.ok(pen.includes('Nilai harus 0–100'));
  assert.ok(/function pesanGalatRamah\(err\)/.test(pen) && pen.includes('errEl.textContent = pesanGalatRamah(err);'));
  assert.ok(!/errEl\.textContent = err\.message/.test(pen));
});
uji('Rekap dan Nilai Rapor yang terbuka digambar ulang setelah penilaian disimpan', () => {
  assert.ok(/async function segarkanBagianTerbuka\(\)/.test(pen));
  assert.ok(/await renderPelaksanaan\(\);\s*await segarkanBagianTerbuka\(\);/.test(pen));
});
uji('Catatan mengajar kosong menampilkan pesan, bukan diam', () => {
  assert.ok(jur.includes('Tulis catatan terlebih dahulu.'));
});
console.log(`\nJURNAL_PERBAIKAN_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
