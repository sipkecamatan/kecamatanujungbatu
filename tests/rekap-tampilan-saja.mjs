// Uji statis (tanpa jaringan): keputusan Romo 23 Okt 2026 (menggantikan keputusan 18 Okt) — guru memilih RUMUS nilai rapor (metode + bobot) di bagian REKAP, pada panel
// di bawah tabel; Rekap TIDAK menampilkan nilai rapor/nilai akhir; nilai hanya dapat diubah di Pelaksanaan (Rekap hanya-baca untuk nilai); nilai rapor tampil otomatis dan
// disimpan di Nilai Rapor; rumus hanya milik penilaian SUMATIF (formatif dan diagnostik tampil tanpa rumus).
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

uji('Rekap tidak menampilkan nilai akhir/nilai rapor dan tidak menyimpan apa pun', () => {
  for (const x of ['Simpan Rekap', 'rc-simpan', 'upsertGradeRecapBatch', 'Nilai Akhir', 'Nilai rapor</th>', 'kktpPredikat', '_rcMetode', '_rcBobots', 'upsertGradeFinalBatch']) assert.ok(!bagianRekap.includes(x), 'Rekap masih memuat ' + x);
  assert.ok(!pen.includes('upsertGradeRecapBatch') && !pen.includes('getGradeRecapRows'));
});
uji('Rekap hanya-baca untuk NILAI: sel dan judul kolom tabel tanpa isian atau tautan ke Edit; ada petunjuk bahwa nilai diubah di Pelaksanaan', () => {
  const tabel = bagianRekap.slice(bagianRekap.indexOf('let tableHtml'), bagianRekap.indexOf('const navHtml'));
  assert.ok(tabel.length > 100, 'bagian tabel tidak ditemukan');
  for (const x of ['data-action', '<input', 'contenteditable', 'asmt-edit']) assert.ok(!tabel.includes(x), 'tabel Rekap memuat ' + x);
  assert.ok(bagianRekap.includes('nilai hanya dapat diubah di bagian <strong>Pelaksanaan</strong>'));
});
uji('Rekap tetap menyaring jenis, teknik, dan TP dan menyediakan ekspor', () => {
  for (const x of ['id="rc-jenis"', 'id="rc-teknik"', 'id="rc-tp"', 'asmt-download-excel']) assert.ok(bagianRekap.includes(x), x);
});
uji('panel rumus ada DI BAWAH tabel dan hanya pada jenis Sumatif; formatif/diagnostik diberi tahu "tidak ikut nilai rapor" tanpa panel', () => {
  assert.match(bagianRekap, /const panelRumus = isSumatif \? await _siapkanPanelRumus\(tpPeta\) : '';/);
  assert.match(bagianRekap, /tableHtml \+ '<\/div>' \+ navHtml \+ panelRumus;/, 'panel harus setelah tabel dan navigasi');
  for (const x of ['id="rc-rumus"', 'id="rc-metode"', 'class="rc-bobot"', 'Rumus nilai rapor']) assert.ok(bagianRekap.includes(x), x);
  const nonSumatif = bagianRekap.slice(bagianRekap.indexOf('if (!isSumatif) {'), bagianRekap.indexOf('// load all results'));
  assert.ok(nonSumatif.includes('tidak ikut nilai rapor') && !nonSumatif.includes('panelRumus') && !nonSumatif.includes('rc-metode'));
});
uji('panel menghitung SEMUA penilaian sumatif, tidak terpengaruh filter teknik/TP/instrumen', () => {
  const fn = bagianRekap.slice(bagianRekap.indexOf('async function _siapkanPanelRumus'), bagianRekap.indexOf('function _statusBobotHtml'));
  assert.match(fn, /_asmtCache\.filter\(a => a\.jenis === 'SUMATIF'\)/);
  assert.ok(!/filtered/.test(fn) && !/_rcTeknik|_rcTp|_rcInstrumen/.test(fn), 'panel tidak boleh bergantung pada filter');
  assert.match(bagianRekap, /_wirePanelRumus\(body, _asmtCache\.filter\(a => a\.jenis === 'SUMATIF'\), tpPeta\)/);
});
uji('isian bobot di Rekap tidak digambar ulang saat diubah (fokus Tab tidak hilang): hanya teks total dan info yang diperbarui; metode berganti = daftar bobot digambar ulang', () => {
  assert.match(bagianRekap, /addEventListener\('change', \(\) => \{ setBobot\(i\.dataset\.aid, i\.value\); segarkanInfo\(\); \}\)/);
  assert.ok(bagianRekap.includes("document.getElementById('rc-bobot-status')"));
  assert.match(bagianRekap, /setMetode\(e\.target\.value\);[\s\S]*?kotak\.innerHTML = getRumus\(\)\.metode === 'BOBOT'/);
});
uji('Rekap dan Nilai Rapor memakai SATU keadaan rumus bersama (rumus-rapor-state.js); Rekap mendengar perubahan agar penanda "belum disimpan" ikut hilang setelah Simpan', () => {
  for (const x of ['siapkanRumus', 'getRumus', 'setMetode', 'setBobot', 'adaPerubahan', 'langgan']) assert.ok(pen.includes(x), 'penilaian.js tidak memakai ' + x);
  for (const x of ['siapkanRumus', 'getRumus', 'catatTersimpan', 'langgan']) assert.ok(ui.includes(x), 'nilai-rapor-ui.js tidak memakai ' + x);
  assert.match(bagianRekap, /_batalRumusRekap = langgan\(segarkanInfo\)/);
  assert.ok(!/let st = \{\s*metode/.test(ui) && !/metode:\s*rumusSimpan\?\.metode/.test(ui), 'Nilai Rapor masih memegang salinan metode sendiri');
});
uji('Nilai Rapor menyimpan rumus (metode + bobot persen tiap penilaian sumatif) bersama nilai', () => {
  assert.ok(/rumus:\s*\{\s*metode:\s*st\.metode,\s*bobot:/.test(ui));
  assert.ok(/rumus:\s*r\.rumus\s*\?\?\s*null/.test(api));
});
uji('Nilai Rapor memuat rumus tersimpan ke keadaan bersama (bobot penilaian yang sudah dihapus dibuang di modul keadaan; diuji di rumus-rapor-state.mjs)', () => {
  assert.ok(ui.includes('rumusSimpan') && ui.includes('siapkanRumus({ kunci: kunciKonteks(ctx), rumusSimpan'));
  const st = src('guru/js/rumus-rapor-state.js');
  assert.ok(st.includes('idSah') && st.includes('delete S.bobot[id]'));
});
uji('migrasi 200000 menambah kolom rumus berpagar objek JSON', () => {
  const m = src('supabase/migrations/20261018200000_nilai_rapor_rumus_tersimpan.sql');
  assert.ok(/ADD COLUMN IF NOT EXISTS rumus jsonb/.test(m) && /jsonb_typeof\(rumus\) = 'object'/.test(m));
});
console.log(`\nREKAP_TAMPILAN_SAJA: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
