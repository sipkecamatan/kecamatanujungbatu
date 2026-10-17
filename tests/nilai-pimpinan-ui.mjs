// Uji asap layar "Nilai per TP" untuk Waka Kurikulum dan Kepala Sekolah (guru/js/nilai-pimpinan-ui.js) TANPA peramban: api.js diganti tiruan.
// Memeriksa pembuatan HTML (pengelompokan, escape, TP tanpa nilai, tanpa KKTP) dan pemasangan kartu (idempoten, tombol Tampilkan, galat, rincian siswa).
// Perhitungan angka sendiri diuji LIVE di tests/nilai-keterlihatan.mjs. Pakai: node tests/nilai-pimpinan-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-ui-'));
globalThis.__api = { panggilan: [], rows: [], siswa: [], gagal: false };
fs.writeFileSync(path.join(dirTmp, 'api.js'), `
const A = globalThis.__api;
export const getNilaiPerTp = async (...a) => { A.panggilan.push(['tp', a]); if (A.gagal) throw new Error('ditolak'); return A.rows; };
export const getNilaiPerTpSiswa = async (...a) => { A.panggilan.push(['siswa', a]); return A.siswa; };
`);
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'nilai-pimpinan-ui.js'), path.join(dirTmp, 'nilai-pimpinan-ui.js'));
const M = await import(pathToFileURL(path.join(dirTmp, 'nilai-pimpinan-ui.js')).href);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
globalThis.CSS = { escape: (s) => s };
const tp = (o) => ({ tp_id: 't1', kode_tp: 'TP-1', deskripsi_tp: 'persamaan', class_id: 'c1', class_name: 'X-A', subject_id: 'm1', subject_name: 'Matematika', teacher_id: 'g1', teacher_name: 'Bu Guru',
  jumlah_siswa: 2, rata_rata: 70.5, nilai_min: 60, nilai_maks: 80, tercapai: 1, belum_tercapai: 1, ada_kktp: true, ...o });

let lulus = 0, gagal = 0;
const uji = async (nama, fn) => { try { await fn(); lulus++; console.log('  LULUS ', nama); } catch (e) { gagal++; console.log('  GAGAL ', nama, '\n        ', e.message); } };

await uji('tabel: dikelompokkan per kelas+mapel+guru; angka berkoma; tanpa nilai tampil "—"; tanpa KKTP ditandai; nama di-escape', () => {
  const h = M.htmlTabelNilaiPerTp([tp({}), tp({ tp_id: 't2', kode_tp: 'TP-2', jumlah_siswa: 0, rata_rata: null }), tp({ tp_id: 't3', kode_tp: 'TP-3', ada_kktp: false }),
    tp({ tp_id: 't4', class_id: 'c2', class_name: 'X-B <script>alert(1)</script>' })], esc);
  assert.equal((h.match(/Bu Guru/g) || []).length, 2, 'dua kelompok (X-A dan X-B)');
  assert.ok(h.includes('70,5') && h.includes('60–80') && h.includes('1 dari 2'));
  assert.ok(h.includes('tanpa KKTP'));
  assert.ok(!h.includes('data-np-detail="t2"'), 'TP tanpa nilai tidak boleh punya tombol rincian');
  assert.ok(!h.includes('<script>'), 'XSS');
  assert.match(M.htmlTabelNilaiPerTp([], esc), /Belum ada Tujuan Pembelajaran/);
});
await uji('rincian siswa: nilai, ketercapaian (Tercapai/Belum/—), kosong, escape', () => {
  const h = M.htmlDetailSiswa([{ nama: 'A <b>', nis: '1', nilai: 80, tercapai: true }, { nama: 'B', nis: null, nilai: 60.5, tercapai: false }, { nama: 'C', nis: '3', nilai: 70, tercapai: null }], esc);
  assert.ok(h.includes('Tercapai') && h.includes('Belum') && h.includes('60,5') && !h.includes('<b>'));
  assert.match(M.htmlDetailSiswa([], esc), /Belum ada nilai siswa/);
});

// DOM minimal untuk pasangNilaiPimpinan
const buatPanel = () => {
  const el = {};
  const hasil = { innerHTML: '', _l: {}, addEventListener(t, f) { this._l[t] = f; }, querySelector: (s) => baris[s] ?? null };
  const baris = {};
  const muat = { disabled: false, _l: {}, addEventListener(t, f) { this._l[t] = f; } };
  const kartu = { id: '', className: '', style: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    querySelector(s) { return ({ '#np-hasil': hasil, '#np-muat': muat, '#np-tahun': { value: '2026/2027' }, '#np-semester': { value: '1' } })[s]; } };
  globalThis.document = { createElement: () => kartu };
  const panel = { _k: null, querySelector: (s) => (s === '#nilai-pimpinan-card' ? panel._k : null), appendChild(k) { panel._k = k; } };
  return { panel, hasil, muat, baris, kartu };
};

await uji('pasang: sekali saja (panggilan kedua tidak menggandakan); panel kosong diabaikan', () => {
  const x = buatPanel(); let n = 0; const asli = x.panel.appendChild; x.panel.appendChild = (k) => { n++; asli(k); };
  M.pasangNilaiPimpinan(x.panel, { esc, tahun: '2026/2027', semester: 1 }); M.pasangNilaiPimpinan(x.panel, { esc, tahun: '2026/2027', semester: 1 });
  assert.equal(n, 1); M.pasangNilaiPimpinan(null, { esc });
  assert.ok(x.kartu.innerHTML.includes('id="np-muat"'));
});
await uji('Tampilkan: memanggil server dengan tahun dan semester; hasil tampil; galat ditampilkan dan tombol aktif kembali', async () => {
  const x = buatPanel(); M.pasangNilaiPimpinan(x.panel, { esc, tahun: '2026/2027', semester: 1 });
  globalThis.__api.rows = [tp({})];
  await x.muat._l.click({ target: x.muat });
  assert.deepEqual(globalThis.__api.panggilan.find((p) => p[0] === 'tp')[1], ['2026/2027', 1]);
  assert.ok(x.hasil.innerHTML.includes('Matematika') && x.muat.disabled === false);
  globalThis.__api.gagal = true; await x.muat._l.click({ target: x.muat });
  assert.match(x.hasil.innerHTML, /Gagal memuat nilai per TP.*ditolak/); assert.equal(x.muat.disabled, false);
});
await uji('Rincian siswa: memuat satu TP, tombol berganti Tutup, klik lagi menutup', async () => {
  const x = buatPanel(); M.pasangNilaiPimpinan(x.panel, { esc, tahun: '2026/2027', semester: 1 });
  const sel = { innerHTML: '' }; const tr = { style: { display: 'none' }, firstElementChild: sel };
  x.baris['tr[data-np-baris="t1"]'] = tr;
  const btn = { dataset: { npDetail: 't1' }, textContent: 'Rincian siswa' };
  globalThis.__api.siswa = [{ nama: 'Budi', nis: '1', nilai: 80, tercapai: true }];
  const e = { target: { closest: (s) => (s === '[data-np-detail]' ? btn : null) } };
  await x.hasil._l.click(e);
  assert.equal(tr.style.display, ''); assert.equal(btn.textContent, 'Tutup'); assert.ok(sel.innerHTML.includes('Budi'));
  assert.deepEqual(globalThis.__api.panggilan.find((p) => p[0] === 'siswa')[1], ['t1']);
  await x.hasil._l.click(e); assert.equal(tr.style.display, 'none'); assert.equal(btn.textContent, 'Rincian siswa');
});

fs.rmSync(dirTmp, { recursive: true, force: true });
console.log(`\nNILAI_PIMPINAN_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
