// Uji asap tampilan "Nilai Rapor" (guru/js/nilai-rapor-ui.js) TANPA peramban: api.js diganti tiruan berisi data buatan, DOM diganti objek minimal.
// Memeriksa: render (nama di-escape, saran hitung), "Isi dari saran", Simpan (payload ke server: nilai, metode, T/R, deskripsi), nilai dikosongkan menghapus
// baris tersimpan, nilai tak valid ditolak, dan simpan ganda dicegah. Yang TIDAK teruji: tata letak dan perilaku nyata di peramban.
// Pakai: node tests/nilai-rapor-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-ui-'));

// api.js tiruan: data buatan + catatan pemanggilan
globalThis.__api = { panggilan: [], data: null };
fs.writeFileSync(path.join(dirTmp, 'api.js'), `
const A = globalThis.__api;
export const getAssessments = async () => A.data.asesmen;
export const getStudentsForClass = async () => A.data.roster;
export const getTps = async () => A.data.tps;
export const getKktps = async (tpId) => A.data.kktp[tpId] ?? [];
export const getResultsForAssessments = async () => A.data.hasil;
export const getGradeFinal = async () => A.data.tersimpan;
export const upsertGradeFinalBatch = async (...a) => { A.panggilan.push(['upsert', a]); if (A.gagal) throw new Error('server menolak'); };
export const deleteGradeFinalForStudents = async (...a) => { A.panggilan.push(['hapus', a]); };
`);
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'nilai-rapor.js'), path.join(dirTmp, 'nilai-rapor.js'));
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'penilaian-label.js'), path.join(dirTmp, 'penilaian-label.js'));
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'nilai-rapor-ui.js'), path.join(dirTmp, 'nilai-rapor-ui.js'));
const M = await import(pathToFileURL(path.join(dirTmp, 'nilai-rapor-ui.js')).href);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toasts = [];
const ctx = { schoolId: 'S', teacherId: 'G', classId: 'C', subjectId: 'M', year: '2026/2027', semester: '1', esc, toast: (m, ok = true) => toasts.push([m, ok]) };
globalThis.window = { confirm: () => true };
const badan = () => ({ innerHTML: '', onclick: null, onchange: null, querySelector: () => null, querySelectorAll: () => [] });
const klik = (b, aksi) => b.onclick({ target: { closest: (sel) => (sel === '[data-nr]' ? { dataset: { nr: aksi }, closest: () => null, disabled: false, textContent: '' } : null) } });
const ubah = (b, sid, kelas, nilai) => b.onchange({ target: { id: '', value: nilai, dataset: {}, classList: { contains: (c) => c === kelas }, closest: () => ({ dataset: { sid } }) } });

const dasar = () => ({
  roster: [{ id: 's1', nama: 'Budi <img src=x onerror=alert(1)>', nis: '1001' }, { id: 's2', nama: 'Citra', nis: '1002' }],
  tps: [{ id: 'tp1', kode_tp: 'TP-1', deskripsi_tp: 'menyelesaikan persamaan linear' }, { id: 'tp2', kode_tp: 'TP-2', deskripsi_tp: 'menghitung luas bangun datar' }],
  kktp: { tp1: [{ rentang: { SB: [90, 100], BSH: [70, 89], MB: [56, 69], BB: [0, 55] } }], tp2: [{ rentang: { SB: [90, 100], BSH: [70, 89], MB: [56, 69], BB: [0, 55] } }] },
  asesmen: [{ id: 'a1', jenis: 'SUMATIF', learning_objective_id: 'tp1', instrumen: 'UH 1' }, { id: 'a2', jenis: 'SUMATIF', learning_objective_id: 'tp2', instrumen: 'UH 2' }, { id: 'a3', jenis: 'FORMATIF', learning_objective_id: 'tp1', instrumen: 'Kuis' }],
  hasil: [{ assessment_id: 'a1', student_id: 's1', nilai: 80 }, { assessment_id: 'a2', student_id: 's1', nilai: 60 }, { assessment_id: 'a1', student_id: 's2', nilai: 90 }, { assessment_id: 'a2', student_id: 's2', nilai: 90 },
            { assessment_id: 'a3', student_id: 's1', nilai: 5 }],   // nilai formatif tidak boleh ikut
  tersimpan: [],
});

let lulus = 0, gagal = 0;
const uji = async (nama, fn) => {
  globalThis.__api.panggilan = []; globalThis.__api.gagal = false; toasts.length = 0; globalThis.__api.data = dasar();
  try { await fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.stack ?? e.message).split('\n').slice(0, 2).join(' | ')); }
};

await uji('render: nama di-escape (tanpa XSS), saran dihitung dari sumatif saja (formatif diabaikan), tombol tersedia', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.ok(!b.innerHTML.includes('<img src=x'), 'nama siswa tidak di-escape');
  assert.ok(b.innerHTML.includes('&lt;img'), 'nama siswa seharusnya tampil sebagai teks');
  assert.match(b.innerHTML, /nr-saran" style="text-align:center">70</);   // Budi: rata-rata (80 + 60) / 2 = 70; formatif 5 diabaikan
  assert.match(b.innerHTML, /nr-saran" style="text-align:center">90</);   // Citra
  for (const aksi of ['isi-saran', 'simpan', 'unduh']) assert.ok(b.innerHTML.includes(`data-nr="${aksi}"`), 'tombol ' + aksi);
});
await uji('tanpa siswa atau tanpa penilaian sumatif: pesan yang jelas, tidak galat', async () => {
  globalThis.__api.data.roster = []; let b = badan(); await M.renderNilaiRapor(b, ctx); assert.match(b.innerHTML, /Belum ada siswa terdaftar/);
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen = []; b = badan(); await M.renderNilaiRapor(b, ctx); assert.match(b.innerHTML, /Belum ada penilaian sumatif/); assert.ok(b.innerHTML.includes('data-nr="simpan"'), 'tabel tetap tampil agar nilai dapat diisi manual');
});
await uji('isi dari saran lalu Simpan: payload berisi nilai, metode RATA, T/R dan deskripsi', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  await klik(b, 'isi-saran'); await klik(b, 'simpan');
  const up = globalThis.__api.panggilan.find((p) => p[0] === 'upsert');
  assert.ok(up, 'upsert tidak dipanggil');
  const [sch, cls, subj, guru, thn, sem, rows] = up[1];
  assert.deepEqual([sch, cls, subj, guru, thn, String(sem)], ['S', 'C', 'M', 'G', '2026/2027', '1']);
  const budi = rows.find((r) => r.studentId === 's1');
  assert.equal(budi.nilai_rapor, 70); assert.equal(budi.metode, 'RATA');
  assert.deepEqual(budi.tp_optimal, ['tp1']); assert.deepEqual(budi.tp_perlu, ['tp2']);   // TP-1 (80) paling optimal, TP-2 (60) perlu peningkatan
  assert.match(budi.deskripsi_tertinggi, /^Menunjukkan penguasaan yang baik dalam menyelesaikan persamaan linear\.$/);
  assert.match(budi.deskripsi_terendah, /^Perlu peningkatan dalam menghitung luas bangun datar\.$/);
  const citra = rows.find((r) => r.studentId === 's2');
  assert.equal(citra.nilai_rapor, 90); assert.deepEqual(citra.tp_perlu, []);   // semua TP sama: hanya T
  assert.ok(toasts.some(([m, ok]) => ok && /tersimpan/.test(m)));
});
await uji('nilai yang diubah guru jadi MANUAL; nilai di luar 0-100 atau bukan angka ditolak dan tidak dikirim ke server', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  ubah(b, 's1', 'nr-nilai', '77'); await klik(b, 'simpan');
  let up = globalThis.__api.panggilan.find((p) => p[0] === 'upsert');
  assert.equal(up[1][6].find((r) => r.studentId === 's1').metode, 'MANUAL');
  globalThis.__api.panggilan = []; toasts.length = 0;
  ubah(b, 's1', 'nr-nilai', '101'); await klik(b, 'simpan');
  assert.equal(globalThis.__api.panggilan.length, 0, 'nilai 101 terkirim'); assert.ok(toasts.some(([, ok]) => !ok));
  ubah(b, 's1', 'nr-nilai', 'abc'); await klik(b, 'simpan'); assert.equal(globalThis.__api.panggilan.length, 0, 'nilai abc terkirim');
});
await uji('nilai rapor tersimpan yang dikosongkan guru dihapus di server; siswa yang belum pernah tersimpan dan kosong dilewati', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70.00', metode: 'RATA', tp_optimal: ['tp1'], tp_perlu: [], deskripsi_tertinggi: 'X', deskripsi_terendah: null }];
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /value="70"/, 'nilai tersimpan tidak dimuat');
  ubah(b, 's1', 'nr-nilai', ''); await klik(b, 'simpan');
  const hapus = globalThis.__api.panggilan.find((p) => p[0] === 'hapus');
  assert.ok(hapus && hapus[1][6].includes('s1'), 'baris s1 tidak dihapus');
  assert.ok(!globalThis.__api.panggilan.some((p) => p[0] === 'upsert' && p[1][6].some((r) => r.studentId === 's1')));
  assert.ok(!hapus[1][6].includes('s2'), 's2 tidak punya baris tersimpan sehingga tidak perlu dihapus');
});
await uji('server menolak: guru diberi tahu galat dan tombol Simpan aktif kembali (bukan terkunci)', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  await klik(b, 'isi-saran'); globalThis.__api.gagal = true; await klik(b, 'simpan');
  assert.ok(toasts.some(([m, ok]) => !ok && /Gagal simpan/.test(m)));
  globalThis.__api.gagal = false; globalThis.__api.panggilan = []; await klik(b, 'simpan');   // dapat disimpan ulang
  assert.ok(globalThis.__api.panggilan.some((p) => p[0] === 'upsert'));
});

await uji('izin tampil: bawaan mati; centang siswa saja / ortu saja / keduanya terkirim pada setiap baris; dimuat kembali dari data tersimpan', async () => {
  const centang = (b, id, v) => b.onchange({ target: { id, checked: v, value: '', dataset: {}, classList: { contains: () => false }, closest: () => null } });
  let b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.ok(b.innerHTML.includes('id="nr-vis-siswa"') && b.innerHTML.includes('id="nr-vis-ortu"'), 'centang izin tidak tampil');
  assert.ok(!/id="nr-vis-siswa" checked/.test(b.innerHTML) && !/id="nr-vis-ortu" checked/.test(b.innerHTML), 'bawaan harus tidak terlihat');
  await klik(b, 'isi-saran'); await klik(b, 'simpan');
  let rows = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6];
  assert.ok(rows.every((r) => r.is_visible_siswa === false && r.is_visible_ortu === false), 'bawaan terkirim tidak false');
  for (const [s, o] of [[true, false], [false, true], [true, true]]) {
    globalThis.__api.panggilan = [];
    centang(b, 'nr-vis-siswa', s); centang(b, 'nr-vis-ortu', o); await klik(b, 'simpan');
    rows = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6];
    assert.ok(rows.length >= 2 && rows.every((r) => r.is_visible_siswa === s && r.is_visible_ortu === o), `kombinasi ${s}/${o} salah`);
  }
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'RATA', tp_optimal: [], tp_perlu: [], is_visible_siswa: true, is_visible_ortu: false },
                                     { student_id: 's2', nilai_rapor: '90', metode: 'RATA', tp_optimal: [], tp_perlu: [], is_visible_siswa: true, is_visible_ortu: false }];
  b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /id="nr-vis-siswa" checked/); assert.ok(!/id="nr-vis-ortu" checked/.test(b.innerHTML));
});

fs.rmSync(dirTmp, { recursive: true, force: true });
console.log(`\nNILAI_RAPOR_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
