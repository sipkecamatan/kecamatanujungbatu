// Uji murni + statis: identitas penilaian (label satu pintu), urutan tunggal, dan status nilai rapor tertinggal (keputusan: perbaiki di akar, bukan per layar).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { labelPenilaian, urutkanPenilaian, statusNilaiRapor } from '../guru/js/penilaian-label.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };

const tp = { a: { kode_tp: 'TP1' }, b: { kode_tp: 'TP2' } };
const p1 = { id: 1, learning_objective_id: 'a', tanggal: '2026-10-19', teknik: 'TES', instrumen: 'Pilihan Ganda', created_at: '2026-10-19T02:00:00Z' };
const p2 = { id: 2, learning_objective_id: 'b', tanggal: '2026-10-19', teknik: 'TES', instrumen: 'Pilihan Ganda', created_at: '2026-10-19T03:00:00Z' };

uji('dua penilaian yang dulu sama-sama "TES Pilihan Ganda" kini punya label berbeda', () => {
  assert.notEqual(labelPenilaian(p1, tp), labelPenilaian(p2, tp));
  assert.equal(labelPenilaian(p1, tp), 'TP1 · 19/10 · TES Pilihan Ganda');
});
uji('judul guru menang atas label turunan; tanpa TP dan tanpa tanggal tetap terbaca', () => {
  assert.equal(labelPenilaian({ ...p1, judul: '  UH 1  ' }, tp), 'UH 1');
  assert.equal(labelPenilaian({ teknik: 'OBSERVASI', instrumen: 'Lembar Observasi' }, {}), 'Tanpa TP · OBSERVASI Lembar Observasi');
});
uji('urutan tunggal kronologis, tanpa tanggal paling akhir, tidak mengubah daftar asli', () => {
  const daftar = [p2, { id: 3, created_at: '2026-10-20T00:00:00Z' }, p1];
  assert.deepEqual(urutkanPenilaian(daftar).map((a) => a.id), [1, 2, 3]);
  assert.deepEqual(daftar.map((a) => a.id), [2, 3, 1]);
});
uji('status nilai rapor: baru, sinkron, manual, basi, tak diketahui', () => {
  assert.equal(statusNilaiRapor({ nilaiTersimpan: '', saranSaatSimpan: null, saranSekarang: 65 }), 'BARU');
  assert.equal(statusNilaiRapor({ nilaiTersimpan: 65, saranSaatSimpan: 65, saranSekarang: 65 }), 'SINKRON');
  assert.equal(statusNilaiRapor({ nilaiTersimpan: 60, saranSaatSimpan: 65, saranSekarang: 65 }), 'MANUAL');
  assert.equal(statusNilaiRapor({ nilaiTersimpan: 65, saranSaatSimpan: 65, saranSekarang: 49 }), 'BASI');
  assert.equal(statusNilaiRapor({ nilaiTersimpan: 60, saranSaatSimpan: 65, saranSekarang: 49 }), 'BASI');
  assert.equal(statusNilaiRapor({ nilaiTersimpan: 65, saranSaatSimpan: null, saranSekarang: 49 }), 'TAK_DIKETAHUI');
});
uji('tidak ada layar yang merakit label penilaian sendiri lagi', () => {
  const pen = src('guru/js/penilaian.js'), ui = src('guru/js/nilai-rapor-ui.js');
  assert.ok(!/esc\(a\.teknik\?\.replace/.test(pen), 'penilaian.js masih merakit label dari teknik');
  assert.ok(!/esc\(a\.instrumen \|\| a\.teknik/.test(ui), 'nilai-rapor-ui masih merakit label');
  assert.equal((pen.match(/labelPenilaian\(/g) ?? []).length >= 3, true);
  assert.ok(ui.includes('labelPenilaian(a, tpById)'));
});
uji('urutan ditetapkan sekali di getAssessments; nilai rapor menyimpan dan menandai saran', () => {
  const api = src('guru/js/api.js'), ui = src('guru/js/nilai-rapor-ui.js');
  assert.ok(/\.order\('tanggal', \{ ascending: true/.test(api) && /\.order\('created_at', \{ ascending: true \}\)/.test(api));
  assert.ok(/saran_saat_simpan: r\.saran_saat_simpan \?\? null/.test(api));
  assert.ok(/saran_saat_simpan: saran,/.test(ui) && ui.includes('statusNilaiRapor(') && ui.includes('nr-basi'));
});
uji('formulir penilaian punya judul dan migrasi 210000 menambah kolomnya', () => {
  const pen = src('guru/js/penilaian.js'), m = src('supabase/migrations/20261018210000_penilaian_judul_dan_saran_tersimpan.sql');
  assert.ok(pen.includes('id="pai-judul"') && /judul: judul \|\| null/.test(pen));
  assert.ok(/ADD COLUMN IF NOT EXISTS judul text/.test(m) && /ADD COLUMN IF NOT EXISTS saran_saat_simpan numeric/.test(m));
});
console.log(`\nPENILAIAN_LABEL: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
