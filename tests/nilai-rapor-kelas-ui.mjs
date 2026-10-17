// Uji asap layar "Nilai Rapor Kelas" (guru/js/nilai-rapor-kelas-ui.js) TANPA peramban: api.js diganti tiruan, DOM diganti objek minimal.
// Memeriksa susunan matriks (siswa x mapel, sel kosong, duplikat guru, urut nama), HTML (escape, pesan kosong), pemasangan (di .page-body, sekali, wali langsung
// memuat, pimpinan memilih kelas), galat, dan ekspor. Hak baca sebenarnya diuji LIVE (tests/nilai-rapor.mjs, nilai-keterlihatan.mjs).
// Pakai: node tests/nilai-rapor-kelas-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nrk-ui-'));
globalThis.__api = { panggilan: [], kelas: [], siswa: [], rows: [], gagal: false };
fs.writeFileSync(path.join(dirTmp, 'api.js'), `
const A = globalThis.__api;
export const getKelasSekolah = async () => A.kelas;
export const getStudentsForClass = async (...a) => { A.panggilan.push(['siswa', a]); return A.siswa; };
export const getGradeFinalKelas = async (...a) => { A.panggilan.push(['rapor', a]); if (A.gagal) throw new Error('ditolak'); return A.rows; };
`);
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'nilai-rapor-kelas-ui.js'), path.join(dirTmp, 'nilai-rapor-kelas-ui.js'));
const M = await import(pathToFileURL(path.join(dirTmp, 'nilai-rapor-kelas-ui.js')).href);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siswa = [{ id: 's1', nama: 'Budi <b>', nis: '1' }, { id: 's2', nama: 'Adnan', nis: '2' }];
const r = (o) => ({ student_id: 's1', subject_id: 'm1', teacher_id: 'g1', nilai_rapor: '85.00', updated_at: '2026-10-17T10:00:00Z', subject: { name: 'Matematika' }, teacher: { full_name: 'Bu Guru' }, ...o });

let lulus = 0, gagal = 0;
const uji = async (nama, fn) => { try { await fn(); lulus++; console.log('  LULUS ', nama); } catch (e) { gagal++; console.log('  GAGAL ', nama, '\n        ', e.message); } };

await uji('matriks: kolom per mapel (urut nama), sel kosong null, terisi dihitung; duplikat guru memakai baris terbaru', () => {
  const m = M.susunMatriks(siswa, [r({}), r({ subject_id: 'm0', subject: { name: 'Akuntansi' }, nilai_rapor: '70' }),
    r({ teacher_id: 'g2', teacher: { full_name: 'Pak Lain' }, nilai_rapor: '90', updated_at: '2026-10-17T12:00:00Z' })]);
  assert.deepEqual(m.kolom.map((k) => k.nama), ['Akuntansi', 'Matematika']);
  const budi = m.baris.find((b) => b.id === 's1'), adnan = m.baris.find((b) => b.id === 's2');
  assert.equal(budi.sel.m1, 90, 'baris terbaru tidak dipakai'); assert.equal(budi.sel.m0, 70); assert.equal(budi.terisi, 2);
  assert.equal(adnan.sel.m1, null); assert.equal(adnan.terisi, 0);
  assert.match(m.kolom[1].guru, /Bu Guru/); assert.match(m.kolom[1].guru, /Pak Lain/);
});
await uji('HTML: escape nama, nilai berkoma, "—" untuk kosong, pesan untuk tanpa siswa dan tanpa nilai', () => {
  const m = M.susunMatriks(siswa, [r({ nilai_rapor: '85.5' })]);
  const h = M.htmlMatriks(m, esc);
  assert.ok(h.includes('85,5') && h.includes('—') && h.includes('1/1') && h.includes('0/1'));
  assert.ok(!h.includes('<b>') && h.includes('Budi &lt;b&gt;'));
  assert.match(M.htmlMatriks(M.susunMatriks([], []), esc), /Belum ada siswa/);
  assert.match(M.htmlMatriks(M.susunMatriks(siswa, []), esc), /Belum ada nilai rapor yang disimpan/);
});
await uji('baris Excel: header Nama, NIS, mapel; sel kosong menjadi string kosong', () => {
  const x = M.barisExcel(M.susunMatriks(siswa, [r({})]));
  assert.deepEqual(x[0], ['Nama', 'NIS', 'Matematika']); assert.deepEqual(x[1], ['Budi <b>', '1', 85]); assert.deepEqual(x[2], ['Adnan', '2', '']);
});

await uji('halaman cetak: mendatar bila mapel > 4, tegak bila sedikit; wadah gulir dimatikan; nama tidak terlipat; judul kolom diulang; judul di-escape', () => {
  const sedikit = M.htmlCetak(M.susunMatriks(siswa, [r({})]), 'XI <AKL>', esc);
  assert.ok(sedikit.includes('size:A4 portrait') && !sedikit.includes('landscape'));
  const banyak = M.htmlCetak(M.susunMatriks(siswa, ['a', 'b', 'c', 'd', 'e'].map((k) => r({ subject_id: k, subject: { name: k } }))), 'X', esc);
  assert.ok(banyak.includes('size:A4 landscape'));
  for (const h of [sedikit, banyak]) {
    assert.ok(h.includes('overflow:visible!important') && h.includes('white-space:nowrap') && h.includes('table-header-group') && h.includes('<table'));
  }
  assert.ok(sedikit.includes('XI &lt;AKL&gt;') && !sedikit.includes('<AKL>'));
});

// DOM minimal
const buatDom = () => {
  const el = {};
  const buat = (id, ekstra = {}) => (el[id] = { id, value: '', style: {}, innerHTML: '', disabled: false, _l: {}, addEventListener(t, f) { this._l[t] = f; }, appendChild(o) { (this.anak ??= []).push(o); }, ...ekstra });
  buat('#nrk-hasil'); buat('#nrk-muat'); buat('#nrk-excel'); buat('#nrk-cetak');
  buat('#nrk-tahun', { value: '2026/2027' }); buat('#nrk-semester', { value: '1' }); buat('#nrk-kelas', { value: '', selectedOptions: [{ textContent: 'XI AKL 1' }] });
  const kartu = { id: '', style: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelector: (s) => el[s] ?? null };
  globalThis.document = { createElement: (t) => (t === 'option' ? {} : kartu) };
  const kolom = { diisi: [], appendChild(k) { this.diisi.push(k); } };
  const panel = { querySelector: (s) => (s === '.page-body' ? kolom : s === '#nilai-rapor-kelas-card' ? (kolom.diisi[0] ?? null) : null) };
  return { el, panel, kolom, kartu };
};
const tunggu = () => new Promise((res) => setTimeout(res, 10));

await uji('wali kelas: kartu di .page-body, tanpa pilihan kelas, langsung memuat kelasnya dan menampilkan tabel', async () => {
  const d = buatDom(); Object.assign(globalThis.__api, { siswa, rows: [r({})], gagal: false, panggilan: [] });
  M.pasangNilaiRaporKelas(d.panel, { esc, mode: 'wali', classId: 'c1', className: 'XI AKL 1', tahun: '2026/2027', semester: 1 });
  assert.equal(d.kolom.diisi.length, 1); assert.ok(!d.kartu.innerHTML.includes('id="nrk-kelas"'));
  await tunggu();
  assert.deepEqual(globalThis.__api.panggilan.find((p) => p[0] === 'rapor')[1], ['c1', '2026/2027', '1']);
  assert.ok(d.el['#nrk-hasil'].innerHTML.includes('Matematika')); assert.equal(d.el['#nrk-excel'].style.display, '');
  M.pasangNilaiRaporKelas(d.panel, { esc, mode: 'wali', classId: 'c1' }); assert.equal(d.kolom.diisi.length, 1, 'terpasang ganda');
});
await uji('pimpinan: daftar kelas dimuat; tanpa kelas dipilih tidak memanggil server; memilih kelas lalu Tampilkan memuat; galat ditampilkan', async () => {
  const d = buatDom(); Object.assign(globalThis.__api, { siswa, rows: [r({})], gagal: false, panggilan: [], kelas: [{ class_id: 'c1', name: 'XI AKL 1' }] });
  M.pasangNilaiRaporKelas(d.panel, { esc, mode: 'pimpinan', tahun: '2026/2027', semester: 2 });
  await tunggu(); assert.equal(d.el['#nrk-kelas'].anak?.length, 1, 'daftar kelas kosong');
  await d.el['#nrk-muat']._l.click({ target: d.el['#nrk-muat'] });
  assert.match(d.el['#nrk-hasil'].innerHTML, /Pilih kelas/); assert.equal(globalThis.__api.panggilan.length, 0);
  d.el['#nrk-kelas'].value = 'c1'; d.el['#nrk-semester'].value = '2';
  await d.el['#nrk-muat']._l.click({ target: d.el['#nrk-muat'] });
  assert.deepEqual(globalThis.__api.panggilan.find((p) => p[0] === 'rapor')[1], ['c1', '2026/2027', '2']);
  assert.ok(d.el['#nrk-hasil'].innerHTML.includes('Adnan'));
  globalThis.__api.gagal = true; await d.el['#nrk-muat']._l.click({ target: d.el['#nrk-muat'] });
  assert.match(d.el['#nrk-hasil'].innerHTML, /Gagal memuat nilai rapor kelas.*ditolak/); assert.equal(d.el['#nrk-muat'].disabled, false);
});
await uji('tahun ajaran kosong: pesan, tidak memanggil server; Excel memakai pustaka bila ada dan memberi tahu bila tidak', async () => {
  const d = buatDom(); Object.assign(globalThis.__api, { siswa, rows: [r({})], gagal: false, panggilan: [] });
  M.pasangNilaiRaporKelas(d.panel, { esc, mode: 'wali', classId: 'c1', className: 'X', tahun: '', semester: 1 });
  d.el['#nrk-tahun'].value = ''; await d.el['#nrk-muat']._l.click({ target: d.el['#nrk-muat'] });
  assert.match(d.el['#nrk-hasil'].innerHTML, /Isi tahun ajaran/);
  d.el['#nrk-tahun'].value = '2026/2027'; await d.el['#nrk-muat']._l.click({ target: d.el['#nrk-muat'] });
  const pesan = []; globalThis.alert = (m) => pesan.push(m); delete globalThis.XLSX;
  d.el['#nrk-excel']._l.click(); assert.match(pesan[0], /Library Excel/);
  const tulis = []; globalThis.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: (a) => a, book_append_sheet: (wb, ws, n) => tulis.push([n, ws]) }, writeFile: (wb, nama) => tulis.push(['file', nama]) };
  d.el['#nrk-excel']._l.click();
  assert.equal(tulis[0][0], 'Nilai Rapor'); assert.deepEqual(tulis[0][1][0], ['Nama', 'NIS', 'Matematika']); assert.match(tulis[1][1], /^nilai_rapor_.*\.xlsx$/);
});

fs.rmSync(dirTmp, { recursive: true, force: true });
console.log(`\nNILAI_RAPOR_KELAS_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
