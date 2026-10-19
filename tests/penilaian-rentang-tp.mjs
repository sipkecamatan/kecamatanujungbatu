// Uji statis: rentang predikat penilaian non-TES diambil dari KKTP TP yang DIPILIH pada penilaian (bukan KKTP TP pertama di kelas),
// dan nilai angka dihitung ulang saat menyimpan dengan rentang TP yang terpilih saat itu. Tanpa jaringan.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pen = readFileSync(join(ROOT, 'guru/js/penilaian.js'), 'utf8');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };

uji('rentang predikat memakai KKTP TP yang dipilih; tanpa TP/KKTP = rentang bawaan', () => {
  assert.ok(!/_allKktp/.test(pen), 'masih ada daftar KKTP gabungan semua TP (rentang TP pertama dipakai untuk semua)');
  const fn = pen.slice(pen.indexOf('function _sumCurrentRentang()'), pen.indexOf('let _kktpByTp'));
  assert.match(fn, /document\.querySelector\('\.pai-tp-cb:checked'\)/);
  assert.match(fn, /_kktpByTp\[terpilih\?\.value\]\?\.\[0\]\?\.rentang \|\| DEFAULT_RENTANG/);
});
uji('KKTP dimuat per TP', () => {
  assert.match(pen, /_kktpByTp\[tp\.id\] = await getKktps\(tp\.id\)/);
});
uji('nilai non-TES dihitung ulang dari predikat saat Simpan dengan rentang TP terpilih; TES (angka langsung) tidak disentuh', () => {
  assert.match(pen, /if \(teknik !== 'TES'\) \{\s*const rentSimpan = _sumCurrentRentang\(\);\s*for \(const d of Object\.values\(_sumNilai\)\) if \(d\.predikat\) d\.nilai = nilaiTengah\(d\.predikat, rentSimpan\);/);
});
uji('mengganti TP menggambar ulang panel siswa yang terbuka', () => {
  assert.match(pen, /querySelectorAll\('\.pai-tp-cb'\)\.forEach\(cb => cb\.addEventListener\('change', \(\) => \{ flushSumActive\(\); renderSumInput\(\); \}\)\)/);
});
console.log(`\nPENILAIAN_RENTANG_TP: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
