// Uji logika murni nilai rapor (guru/js/nilai-rapor.js): tiga opsi pengolahan resmi (rata-rata, pembobotan, persentase TP tercapai),
// saran tanda T/R, deskripsi, dan lembar e-Rapor satu baris per siswa. Tanpa jaringan dan tanpa basis data.
// Contoh angka diambil dari Panduan Pembelajaran dan Asesmen 2025 (Edisi Revisi), tabel pengolahan nilai rapor (hal. 57-58).
// Pakai: node tests/nilai-rapor-hitung.mjs [berkas-modul.js]
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sumber = process.argv[2] || path.join(ROOT, 'guru', 'js', 'nilai-rapor.js');
const M = await import(pathToFileURL(sumber).href);

let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.message).split('\n')[0]); } };
const A = (...ids) => ids.map((id) => ({ id, tpIds: [] }));

uji('opsi rata-rata: contoh panduan (Edo 85, 83, 60, 84 = 78)', () => {
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b', 'c', 'd'), nilai: { a: 85, b: 83, c: 60, d: 84 } }), 78);
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b', 'c', 'd'), nilai: { a: 64, b: 68, c: 80, d: 96 } }), 77);   // Dayu
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b', 'c', 'd'), nilai: { a: 90, b: 90, c: 90, d: 94 } }), 91);   // Lani (pembulatan normal 91)
});
uji('opsi rata-rata: nilai kosong diabaikan, bukan dianggap nol; tanpa nilai = null', () => {
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b', 'c'), nilai: { a: 80, b: null, c: 60 } }), 70);
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b'), nilai: { a: null, b: undefined } }), null);
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: [], nilai: {} }), null);
});
uji('opsi pembobotan: contoh panduan (bobot 20/20/20/40: Edo = 80, Dayu = 73, Siti = 80, Lani = 92)', () => {
  const bobot = { a: 20, b: 20, c: 20, d: 40 };
  const h = (nilai) => M.hitungNilaiRapor({ metode: 'BOBOT', asesmen: A('a', 'b', 'c', 'd'), nilai, bobot });
  assert.equal(h({ a: 85, b: 83, c: 60, d: 84 }), 80);
  assert.equal(h({ a: 64, b: 68, c: 40, d: 96 }), 73);
  assert.equal(h({ a: 87, b: 79, c: 80, d: 78 }), 80);
  assert.equal(h({ a: 90, b: 90, c: 90, d: 94 }), 92);
});
uji('opsi pembobotan: bobot harus tepat 100 (B-08); bobot sisa dinormalkan hanya bila penilaian belum bernilai', () => {
  const h = (asesmen, nilai, bobot) => M.hitungNilaiRapor({ metode: 'BOBOT', asesmen, nilai, bobot });
  assert.equal(h(A('a', 'b'), { a: 100, b: 50 }, { a: 1, b: 1 }), null);              // total 2: tanpa saran
  assert.equal(h(A('a', 'b'), { a: 100, b: 50 }, { a: 60, b: 20 }), null);            // total 80: tanpa saran
  assert.equal(h(A('a', 'b'), { a: 100, b: 50 }, { a: 50, b: 50 }), 75);
  assert.equal(h(A('a', 'b', 'c'), { a: 100, b: 50, c: null }, { a: 40, b: 40, c: 20 }), 75);   // c belum bernilai: sisa dinormalkan
  assert.equal(h(A('a'), { a: 90 }, {}), null);
  assert.equal(h(A('a'), { a: 90 }, { a: 0 }), null);
});
uji('totalBobot: sah hanya bila tepat 100', () => {
  assert.deepEqual(M.totalBobot(A('a', 'b'), { a: 60, b: 40 }), { total: 100, sah: true });
  assert.deepEqual(M.totalBobot(A('a', 'b'), { a: 60, b: 20 }), { total: 80, sah: false });
  assert.deepEqual(M.totalBobot(A('a', 'b'), { a: 60.5, b: 40.5 }), { total: 101, sah: false });
  assert.equal(M.totalBobot(A('a'), {}).sah, false);
});
uji('opsi persentase: contoh panduan (3 dari 4 TP tercapai = 75; 2 dari 4 = 50; 4 dari 4 = 100)', () => {
  const asesmen = ['t1', 't2', 't3', 't4'].map((tp) => ({ id: 'a-' + tp, tpIds: [tp] }));
  const nilai = (arr) => Object.fromEntries(arr.map((n, i) => ['a-t' + (i + 1), n]));
  const h = (n, ket) => M.hitungNilaiRapor({ metode: 'PERSEN', asesmen, nilai: nilai(n), tercapaiPerTp: ket });
  assert.equal(h([83, 83, 60, 84], { t1: true, t2: true, t3: false, t4: true }), 75);
  assert.equal(h([64, 78, 40, 80], { t1: false, t2: true, t3: false, t4: true }), 50);
  assert.equal(h([87, 79, 80, 78], { t1: true, t2: true, t3: true, t4: true }), 100);
});
uji('opsi persentase: TP tanpa nilai atau tanpa KKTP diabaikan; tanpa data = null', () => {
  const asesmen = [{ id: 'a1', tpIds: ['t1'] }, { id: 'a2', tpIds: ['t2'] }, { id: 'a3', tpIds: ['t3'] }];
  assert.equal(M.hitungNilaiRapor({ metode: 'PERSEN', asesmen, nilai: { a1: 80, a2: null, a3: 50 }, tercapaiPerTp: { t1: true, t2: true, t3: false } }), 50);   // t2 tanpa nilai
  assert.equal(M.hitungNilaiRapor({ metode: 'PERSEN', asesmen, nilai: { a1: 80, a2: 70, a3: 50 }, tercapaiPerTp: { t1: true } }), 100);                    // t2, t3 tanpa KKTP
  assert.equal(M.hitungNilaiRapor({ metode: 'PERSEN', asesmen, nilai: { a1: 80 }, tercapaiPerTp: {} }), null);
});
uji('hasil selalu bilangan bulat 0-100 dan metode tidak dikenal ditolak', () => {
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b', 'c'), nilai: { a: 100, b: 100, c: 99 } }), 100);   // 99,67 -> 100
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a'), nilai: { a: 150 } }), 100);                            // di luar rentang dijepit
  assert.equal(M.hitungNilaiRapor({ metode: 'RATA', asesmen: A('a', 'b'), nilai: { a: 70, b: 71 } }), 71);                  // 70,5 -> 71 (pembulatan normal)
  assert.throws(() => M.hitungNilaiRapor({ metode: 'TERBAIK', asesmen: A('a'), nilai: { a: 1 } }), /metode tidak dikenal/);
});
uji('rata-rata per TP: gabungan beberapa penilaian satu TP; penilaian tanpa TP atau tanpa nilai diabaikan', () => {
  const asesmen = [{ id: 'a1', tpIds: ['t1'] }, { id: 'a2', tpIds: ['t1'] }, { id: 'a3', tpIds: ['t2'] }, { id: 'a4', tpIds: [] }, { id: 'a5', tpIds: ['t3'] }];
  const r = M.nilaiPerTp(asesmen, { a1: 80, a2: 70, a3: 60, a4: 99, a5: null });
  assert.deepEqual(r, { t1: 75, t2: 60 });
});
uji('saran T/R: T = nilai TP tertinggi, R = terendah; satu TP atau semua sama = hanya T', () => {
  assert.deepEqual(M.sarankanTR({ t1: 75, t2: 60, t3: 90 }), { optimal: ['t3'], perlu: ['t2'] });
  assert.deepEqual(M.sarankanTR({ t1: 80, t2: 80 }), { optimal: ['t1', 't2'], perlu: [] });
  assert.deepEqual(M.sarankanTR({ t1: 80 }), { optimal: ['t1'], perlu: [] });
  assert.deepEqual(M.sarankanTR({}), { optimal: [], perlu: [] });
  assert.deepEqual(M.sarankanTR({ a: 90, b: 90, c: 50, d: 50 }), { optimal: ['a', 'b'], perlu: ['c', 'd'] });
});
uji('deskripsi: kalimat positif untuk capaian tertinggi dan "perlu peningkatan" untuk terendah; kosong bila tidak ada tanda', () => {
  const tpById = { t1: { kode_tp: 'TP-1', deskripsi_tp: 'menyelesaikan persamaan linear.' }, t2: { kode_tp: 'TP-2', deskripsi_tp: '' } };
  const d = M.susunDeskripsi({ optimal: ['t1'], perlu: ['t2'], tpById });
  assert.equal(d.tertinggi, 'Menunjukkan penguasaan yang baik dalam menyelesaikan persamaan linear.');
  assert.equal(d.terendah, 'Perlu peningkatan dalam TP-2.');
  assert.deepEqual(M.susunDeskripsi({ tpById }), { tertinggi: '', terendah: '' });
});
uji('lembar e-Rapor: satu baris per siswa (bukan per TP), T/R pada kolom TP, NIS terisi, urut nama', () => {
  const tps = [{ id: 't1', kode_tp: 'TP-1' }, { id: 't2', kode_tp: 'TP-2' }, { id: 't3', kode_tp: 'TP-3' }];
  const roster = [{ id: 's2', nama: 'Budi', nis: '2002' }, { id: 's1', nama: 'Adi', nis: '2001' }, { id: 's3', nama: 'Citra', nis: '2003' }];
  const rapor = { s1: { nilai_rapor: 82.5, tp_optimal: ['t1'], tp_perlu: ['t3'], deskripsi_tertinggi: 'A', deskripsi_terendah: 'B' }, s2: { nilai_rapor: 70, tp_optimal: ['t2'], tp_perlu: [], deskripsi_tertinggi: 'C', deskripsi_terendah: '' } };
  const { header, rows } = M.susunLembarERapor({ roster, tps, rapor });
  assert.deepEqual(header, ['NO', 'NIS', 'NAMA PESERTA DIDIK', 'NILAI AKHIR', 'TP-1', 'TP-2', 'TP-3', 'DESKRIPSI CAPAIAN TERTINGGI', 'DESKRIPSI CAPAIAN TERENDAH']);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], [1, '2001', 'Adi', 82.5, 'T', '', 'R', 'A', 'B']);
  assert.deepEqual(rows[1], [2, '2002', 'Budi', 70, '', 'T', '', 'C', '']);
  assert.deepEqual(rows[2], [3, '2003', 'Citra', '', '', '', '', '', '']);   // belum ada nilai rapor: baris kosong, tetap tampil
});

uji('satu penilaian menaut beberapa TP: nilainya berlaku untuk tiap TP (rata-rata per TP dan Persentase TP)', () => {
  const asesmen = [{ id: 'a1', tpIds: ['t1', 't2'] }, { id: 'a2', tpIds: ['t2'] }, { id: 'a3', tpIds: [] }];
  const nilai = { a1: 80, a2: 60, a3: 10 };
  assert.deepEqual(M.nilaiPerTp(asesmen, nilai), { t1: 80, t2: 70 });
  assert.equal(M.hitungNilaiRapor({ metode: 'PERSEN', asesmen, nilai, tercapaiPerTp: { t1: true, t2: false } }), 50);
  assert.deepEqual(M.nilaiPerTp([{ id: 'a1', tpIds: ['t1', 't1'] }], { a1: 90 }), { t1: 90 }, 'TP ganda pada satu penilaian tidak dihitung dua kali');
});

console.log(`\nNILAI_RAPOR_HITUNG: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
