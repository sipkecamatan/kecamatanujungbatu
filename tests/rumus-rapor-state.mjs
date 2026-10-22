// Uji logika murni keadaan rumus bersama Rekap dan Nilai Rapor (guru/js/rumus-rapor-state.js). Tanpa jaringan dan tanpa DOM.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = await import(pathToFileURL(path.join(ROOT, 'guru', 'js', 'rumus-rapor-state.js')).href);

let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { R.setelUlang(); fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.message).slice(0, 300)); } };
const K1 = 'kelas1|mapel1|2026/2027|1', K2 = 'kelas2|mapel1|2026/2027|1';

uji('konteks baru dimulai dari rumus tersimpan; tanpa rumus tersimpan = Rata-rata bawaan', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'BOBOT', bobot: { a: 40, b: 60, hapus: 10 } }, sumatifIds: ['a', 'b'] });
  const s = R.getRumus();
  assert.equal(s.metode, 'BOBOT'); assert.deepEqual(s.bobot, { a: 40, b: 60 }, 'bobot penilaian yang sudah dihapus dibuang');
  assert.deepEqual(s.tersimpan, { metode: 'BOBOT', bobot: { a: 40, b: 60 } });
  R.setelUlang(); R.siapkanRumus({ kunci: K2, rumusSimpan: null, sumatifIds: ['a'] });
  assert.equal(R.getRumus().metode, 'RATA'); assert.equal(R.getRumus().tersimpan, null);
});
uji('metode tersimpan yang tidak dikenal diganti metode awal atau bawaan', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'ASING' }, metodeAwal: 'PERSEN', sumatifIds: [] });
  assert.equal(R.getRumus().metode, 'PERSEN');
});
uji('konteks SAMA dimuat ulang: perubahan guru yang belum disimpan dipertahankan (Rekap dan Nilai Rapor memuat bergantian)', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'RATA' }, sumatifIds: ['a', 'b'] });
  R.setMetode('BOBOT'); R.setBobot('a', 30); R.setBobot('b', 70);
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'RATA' }, sumatifIds: ['a', 'b'] });   // bagian lain memuat ulang
  assert.equal(R.getRumus().metode, 'BOBOT'); assert.deepEqual(R.getRumus().bobot, { a: 30, b: 70 });
});
uji('penilaian sumatif dihapus: bobotnya dibuang; konteks lain: keadaan dimulai ulang dari tersimpan', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: null, sumatifIds: ['a', 'b'] });
  R.setBobot('a', 50); R.setBobot('b', 50);
  R.siapkanRumus({ kunci: K1, rumusSimpan: null, sumatifIds: ['a'] });
  assert.deepEqual(R.getRumus().bobot, { a: 50 });
  R.siapkanRumus({ kunci: K2, rumusSimpan: { metode: 'PERSEN' }, sumatifIds: ['x'] });
  assert.equal(R.getRumus().metode, 'PERSEN'); assert.deepEqual(R.getRumus().bobot, {});
});
uji('setMetode/setBobot memberi tahu semua pendengar (Rekap dan Nilai Rapor); nilai yang sama tidak memberi tahu; berhenti mendengar bekerja', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: null, sumatifIds: ['a'] });
  const a = [], b = [];
  const stopA = R.langgan((x) => a.push(x)); R.langgan((x) => b.push(x));
  assert.equal(R.setMetode('BOBOT'), true); assert.equal(R.setMetode('BOBOT'), false);
  assert.equal(R.setBobot('a', 100), true); assert.equal(R.setBobot('a', 100), false);
  assert.equal(R.setMetode('TIDAK ADA'), false, 'metode tidak dikenal ditolak');
  assert.deepEqual(a, ['metode', 'bobot']); assert.deepEqual(b, ['metode', 'bobot']);
  stopA(); R.setBobot('a', 90);
  assert.equal(a.length, 2); assert.equal(b.length, 3);
});
uji('pendengar yang melempar galat tidak mengganggu pendengar lain', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: null, sumatifIds: [] });
  let sampai = 0; R.langgan(() => { throw new Error('rusak'); }); R.langgan(() => { sampai++; });
  R.setMetode('PERSEN'); assert.equal(sampai, 1);
});
uji('adaPerubahan membandingkan dengan rumus tersimpan: metode, atau bobot (hanya bila Pembobotan); tanpa tersimpan = tidak ada pembanding', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'BOBOT', bobot: { a: 40, b: 60 } }, sumatifIds: ['a', 'b'] });
  assert.equal(R.adaPerubahan(['a', 'b']), false);
  R.setBobot('a', 45); assert.equal(R.adaPerubahan(['a', 'b']), true);
  R.setBobot('a', 40); assert.equal(R.adaPerubahan(['a', 'b']), false, 'dikembalikan ke nilai tersimpan');
  R.setMetode('RATA'); assert.equal(R.adaPerubahan(['a', 'b']), true);
  R.setelUlang(); R.siapkanRumus({ kunci: K2, rumusSimpan: null, sumatifIds: ['a'] }); R.setMetode('PERSEN');
  assert.equal(R.adaPerubahan(['a']), false);
});
uji('bobot tidak dibandingkan bila metode bukan Pembobotan (bobot lama tidak membuat "belum disimpan")', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'RATA', bobot: { a: 10 } }, sumatifIds: ['a'] });
  R.setBobot('a', 99); assert.equal(R.adaPerubahan(['a']), false);
});
uji('catatTersimpan: rumus di layar menjadi rumus tersimpan dan semua pendengar diberi tahu (penanda "belum disimpan" di Rekap hilang)', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: { metode: 'RATA' }, sumatifIds: ['a', 'b'] });
  R.setMetode('BOBOT'); R.setBobot('a', 25); R.setBobot('b', 75);
  const kejadian = []; R.langgan((x) => kejadian.push(x));
  assert.equal(R.adaPerubahan(['a', 'b']), true);
  R.catatTersimpan(['a', 'b']);
  assert.equal(R.adaPerubahan(['a', 'b']), false); assert.deepEqual(kejadian, ['tersimpan']);
  assert.deepEqual(R.getRumus().tersimpan, { metode: 'BOBOT', bobot: { a: 25, b: 75 } });
});
uji('setBobot: isian kosong atau bukan angka dibaca 0', () => {
  R.siapkanRumus({ kunci: K1, rumusSimpan: null, sumatifIds: ['a'] });
  R.setBobot('a', 20); R.setBobot('a', ''); assert.equal(R.getRumus().bobot.a, 0);
  R.setBobot('a', 'abc'); assert.equal(R.getRumus().bobot.a, 0);
});
uji('kunciKonteks membedakan kelas, mapel, tahun, dan semester', () => {
  const c = { classId: 'k', subjectId: 'm', year: '2026/2027', semester: 1 };
  assert.notEqual(R.kunciKonteks(c), R.kunciKonteks({ ...c, semester: 2 }));
  assert.notEqual(R.kunciKonteks(c), R.kunciKonteks({ ...c, classId: 'k2' }));
  assert.equal(R.kunciKonteks(c), R.kunciKonteks({ ...c }));
});

console.log(`\nRUMUS_RAPOR_STATE: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
