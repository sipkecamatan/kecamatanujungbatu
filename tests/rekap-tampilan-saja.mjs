// Uji statis (tanpa jaringan): keputusan Romo 18 Okt 2026 — Rekap Penilaian hanya wadah tampilan hasil penilaian (semua jenis); nilai rapor hanya dari penilaian
// SUMATIF dengan rumus persentase yang ditentukan guru, diisi SEKALI di Nilai Rapor dan tersimpan (tidak hilang saat halaman dimuat ulang).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };
const pen = src('guru/js/penilaian.js'), ui = src('guru/js/nilai-rapor-ui.js'), api = src('guru/js/api.js');
const bagianRekap = pen.slice(pen.indexOf('async function _renderRecapContent'), pen.indexOf('// ── Event delegation'));

uji('Rekap tidak punya metode, bobot, atau tombol simpan', () => {
  for (const x of ['Simpan Rekap', 'rc-simpan', 'rc-bobot-input', 'rc-metode', '_rcMetode', '_rcBobots', 'upsertGradeRecapBatch', 'Nilai Akhir', 'kktpPredikat']) assert.ok(!bagianRekap.includes(x), 'Rekap masih memuat ' + x);
  assert.ok(!pen.includes('upsertGradeRecapBatch') && !pen.includes('getGradeRecapRows'));
});
uji('Rekap tetap menyaring jenis, teknik, dan TP dan menyediakan ekspor; menerangkan bahwa rumus ada di Nilai Rapor', () => {
  for (const x of ['id="rc-jenis"', 'id="rc-teknik"', 'id="rc-tp"', 'asmt-download-excel']) assert.ok(bagianRekap.includes(x), x);
  assert.ok(bagianRekap.includes('Rekap hanya menampilkan hasil penilaian') && bagianRekap.includes('Nilai Rapor'));
});
uji('Nilai Rapor menyimpan rumus (metode + bobot persen tiap penilaian sumatif) bersama nilai', () => {
  assert.ok(/rumus:\s*\{\s*metode:\s*st\.metode,\s*bobot:/.test(ui));
  assert.ok(/rumus:\s*r\.rumus\s*\?\?\s*null/.test(api));
});
uji('Nilai Rapor memuat rumus tersimpan dan membuang bobot penilaian yang sudah dihapus', () => {
  assert.ok(ui.includes('rumusSimpan') && ui.includes('idSumatif.has(id)'));
  assert.ok(/bobot:\s*bobotSimpan/.test(ui));
  assert.ok(ui.includes('tidak perlu diisi ulang'));
});
uji('migrasi 200000 menambah kolom rumus berpagar objek JSON', () => {
  const m = src('supabase/migrations/20261018200000_nilai_rapor_rumus_tersimpan.sql');
  assert.ok(/ADD COLUMN IF NOT EXISTS rumus jsonb/.test(m) && /jsonb_typeof\(rumus\) = 'object'/.test(m));
});
console.log(`\nREKAP_TAMPILAN_SAJA: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
