// Uji murni + statis: identitas penilaian (label satu pintu), urutan tunggal, dan status nilai rapor tertinggal (keputusan: perbaiki di akar, bukan per layar).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { labelPenilaian, urutkanPenilaian, opsiTpPenilaian, ringkasTp } from '../guru/js/penilaian-label.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };

const tp = { a: { kode_tp: 'TP1' }, b: { kode_tp: 'TP2' } };
const p1 = { id: 1, tpIds: ['a'], tanggal: '2026-10-19', teknik: 'TES', instrumen: 'Pilihan Ganda', created_at: '2026-10-19T02:00:00Z' };
const p2 = { id: 2, tpIds: ['b'], tanggal: '2026-10-19', teknik: 'TES', instrumen: 'Pilihan Ganda', created_at: '2026-10-19T03:00:00Z' };

uji('dua penilaian yang dulu sama-sama "TES Pilihan Ganda" kini punya label berbeda', () => {
  assert.notEqual(labelPenilaian(p1, tp), labelPenilaian(p2, tp));
  assert.equal(labelPenilaian(p1, tp), 'TP1 · 19/10 · TES TERTULIS Pilihan Ganda');
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
uji('tidak ada layar yang merakit label penilaian sendiri lagi', () => {
  const pen = src('guru/js/penilaian.js'), ui = src('guru/js/nilai-rapor-ui.js');
  assert.ok(!/esc\(a\.teknik\?\.replace/.test(pen), 'penilaian.js masih merakit label dari teknik');
  assert.ok(!/esc\(a\.instrumen \|\| a\.teknik/.test(ui), 'nilai-rapor-ui masih merakit label');
  assert.equal((pen.match(/labelPenilaian\(/g) ?? []).length >= 3, true);
  assert.ok(pen.includes('labelPenilaian(a, tpPeta)') && pen.includes('function _bobotRekapHtml'), 'bobot di Rekap harus memakai label satu pintu');
});
uji('urutan ditetapkan sekali di getAssessments; kolom saran sudah tiada', () => {
  const api = src('guru/js/api.js'), ui = src('guru/js/nilai-rapor-ui.js');
  assert.ok(/\.order\('tanggal', \{ ascending: true/.test(api) && /\.order\('created_at', \{ ascending: true \}\)/.test(api));
  assert.ok(!api.includes('saran_saat_simpan') && !ui.includes('saran_saat_simpan') && !ui.includes('statusNilaiRapor'));
});
uji('formulir penilaian punya judul dan migrasi 210000 menambah kolomnya', () => {
  const pen = src('guru/js/penilaian.js'), m = src('supabase/migrations/20261018210000_penilaian_judul_dan_saran_tersimpan.sql');
  assert.ok(pen.includes('id="pai-judul"') && /judul: judul \|\| null/.test(pen));
  assert.ok(/ADD COLUMN IF NOT EXISTS judul text/.test(m) && /ADD COLUMN IF NOT EXISTS saran_saat_simpan numeric/.test(m));
});
uji('formulir edit tidak menghapus tautan TP: TP tertaut selalu ada dalam opsi dan terpilih, walau daftar TP kosong atau milik kelas lain', () => {
  const daftar = [{ id: 'a', kode_tp: 'TP1' }, { id: 'b', kode_tp: 'TP2' }];
  const dipilih = (o) => o.filter((x) => x.terpilih).map((x) => x.id);
  assert.deepEqual(dipilih(opsiTpPenilaian(daftar, 'b')), ['b']);
  assert.deepEqual(dipilih(opsiTpPenilaian([], 'b')), ['b'], 'daftar kosong: TP tertaut harus tetap terpilih');
  assert.deepEqual(dipilih(opsiTpPenilaian([{ id: 'x', kode_tp: 'TP-lain' }], 'b')), ['b'], 'daftar kelas lain: TP tertaut harus tetap terpilih');
  assert.deepEqual(dipilih(opsiTpPenilaian(daftar, null)), [], 'tanpa tautan: tidak ada yang terpilih');
  assert.deepEqual(dipilih(opsiTpPenilaian(daftar, ['a', 'b'])), ['a', 'b'], 'beberapa TP tertaut: semuanya terpilih');
  assert.deepEqual(dipilih(opsiTpPenilaian(daftar, ['a', 'z'])), ['a', 'z'], 'salah satu TP tertaut di luar daftar tetap terpilih');
  assert.equal(opsiTpPenilaian(daftar, 'a').filter((o) => o.id === 'a').length, 1, 'tidak boleh ganda');
});
uji('satu penilaian untuk beberapa TP: label memuat semua kode TP', () => {
  const p = { id: 3, tpIds: ['a', 'b'], tanggal: '2026-10-19', teknik: 'TES', instrumen: 'Pilihan Ganda' };
  assert.equal(labelPenilaian(p, tp), 'TP1, TP2 · 19/10 · TES TERTULIS Pilihan Ganda');
  assert.equal(labelPenilaian({ ...p, tpIds: [] }, tp), 'Tanpa TP · 19/10 · TES TERTULIS Pilihan Ganda');
});
uji('ringkasan TP selalu terlihat, juga bila penilaian berjudul', () => {
  assert.equal(ringkasTp({ judul: 'UH 1', tpIds: ['a'] }, tp), 'TP: TP1');
  assert.equal(ringkasTp({ judul: 'UH 2', tpIds: ['a', 'b'] }, tp), 'TP: TP1, TP2');
  assert.equal(ringkasTp({ tpIds: ['b', 'a'] }, tp), 'TP: TP1, TP2', 'urutan mengikuti daftar TP, bukan urutan tautan');
  assert.equal(ringkasTp({ judul: 'UH 3', tpIds: [] }, tp), 'Tanpa TP');
  assert.equal(ringkasTp({ tpIds: ['zzz'] }, tp), 'TP: TP terkait');
});
uji('cache TP tidak ditimpa muatan kelas lain: setiap penulisan memeriksa konteks yang sama', () => {
  const pen = src('guru/js/penilaian.js');
  assert.ok(!/_tpCache = await getTps/.test(pen), 'masih ada penulisan cache langsung setelah await');
  assert.equal((pen.match(/kunciMuat === konteksKunci\(\)|kunciTp === konteksKunci\(\)/g) ?? []).length >= 4, true);
});
console.log(`\nPENILAIAN_LABEL: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
