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
export const upsertGradeFinalBatch = async (...a) => { A.panggilan.push(['upsert', a]); if (A.gagal) throw new Error('server menolak'); return A.serverTetapkan ? a[6].map((r) => ({ student_id: r.studentId, nilai_rapor: A.serverTetapkan(r), metode: r.metode })) : undefined; };
export const deleteGradeFinalForStudents = async (...a) => { A.panggilan.push(['hapus', a]); };
`);
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'nilai-rapor.js'), path.join(dirTmp, 'nilai-rapor.js'));
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'penilaian-label.js'), path.join(dirTmp, 'penilaian-label.js'));
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'rumus-rapor-state.js'), path.join(dirTmp, 'rumus-rapor-state.js'));
fs.copyFileSync(path.join(ROOT, 'guru', 'js', 'nilai-rapor-ui.js'), path.join(dirTmp, 'nilai-rapor-ui.js'));
const M = await import(pathToFileURL(path.join(dirTmp, 'nilai-rapor-ui.js')).href);
const R = await import(pathToFileURL(path.join(dirTmp, 'rumus-rapor-state.js')).href);   // keadaan rumus bersama (Rekap + Nilai Rapor)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toasts = [];
const ctx = { schoolId: 'S', teacherId: 'G', classId: 'C', subjectId: 'M', year: '2026/2027', semester: '1', esc, toast: (m, ok = true) => toasts.push([m, ok]) };
globalThis.window = { confirm: () => true };
globalThis.CSS = { escape: (x) => x };
const badan = () => { const el = {}; return { innerHTML: '', onclick: null, onchange: null, el, querySelector: (q) => (q.startsWith('tr[') ? null : (el[q] ??= { innerHTML: '', style: {}, textContent: '' })), querySelectorAll: () => [] }; };
// Muat Nilai Rapor dari keadaan rumus yang bersih (seperti guru yang baru membuka kelas ini)
const muat = async (b) => { R.setelUlang(); await M.renderNilaiRapor(b, ctx); };
const klik = (b, aksi) => b.onclick({ target: { closest: (sel) => (sel === '[data-nr]' ? { dataset: { nr: aksi }, closest: () => null, disabled: false, textContent: '' } : null) } });
const ubah = (b, sid, kelas, nilai) => b.onchange({ target: { id: '', value: nilai, dataset: {}, classList: { contains: (c) => c === kelas }, closest: () => ({ dataset: { sid }, querySelector: () => null }) } });

const dasar = () => ({
  roster: [{ id: 's1', nama: 'Budi <img src=x onerror=alert(1)>', nis: '1001' }, { id: 's2', nama: 'Citra', nis: '1002' }],
  tps: [{ id: 'tp1', kode_tp: 'TP-1', deskripsi_tp: 'menyelesaikan persamaan linear' }, { id: 'tp2', kode_tp: 'TP-2', deskripsi_tp: 'menghitung luas bangun datar' }],
  kktp: { tp1: [{ rentang: { SB: [90, 100], BSH: [70, 89], MB: [56, 69], BB: [0, 55] } }], tp2: [{ rentang: { SB: [90, 100], BSH: [70, 89], MB: [56, 69], BB: [0, 55] } }] },
  asesmen: [{ id: 'a1', jenis: 'SUMATIF', tpIds: ['tp1'], instrumen: 'UH 1' }, { id: 'a2', jenis: 'SUMATIF', tpIds: ['tp2'], instrumen: 'UH 2' }, { id: 'a3', jenis: 'FORMATIF', tpIds: ['tp1'], instrumen: 'Kuis' }],
  hasil: [{ assessment_id: 'a1', student_id: 's1', nilai: 80 }, { assessment_id: 'a2', student_id: 's1', nilai: 60 }, { assessment_id: 'a1', student_id: 's2', nilai: 90 }, { assessment_id: 'a2', student_id: 's2', nilai: 90 },
            { assessment_id: 'a3', student_id: 's1', nilai: 5 }],   // nilai formatif tidak boleh ikut
  tersimpan: [],
});

let lulus = 0, gagal = 0;
const uji = async (nama, fn) => {
  R.setelUlang(); globalThis.__api.serverTetapkan = null; globalThis.__api.panggilan = []; globalThis.__api.gagal = false; toasts.length = 0; globalThis.__api.data = dasar();
  try { await fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.stack ?? e.message).split('\n').slice(0, 2).join(' | ')); }
};

await uji('render: nama di-escape (tanpa XSS), nilai otomatis dihitung dari sumatif saja (formatif diabaikan), tidak ada kolom Saran, tombol tersedia', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.ok(!b.innerHTML.includes('<img src=x'), 'nama siswa tidak di-escape');
  assert.ok(b.innerHTML.includes('&lt;img'), 'nama siswa seharusnya tampil sebagai teks');
  assert.ok(!/Saran|nr-saran/.test(b.innerHTML), 'kolom Saran seharusnya tidak ada');
  assert.match(b.innerHTML, /class="nr-nilai"[^>]*value="70"/);   // Budi: rata-rata (80 + 60) / 2 = 70; formatif 5 diabaikan
  assert.match(b.innerHTML, /class="nr-nilai"[^>]*value="90"/);   // Citra
  assert.ok(!b.innerHTML.includes('hitung-semua') && !b.innerHTML.includes('Hitung ulang semua'), 'tombol Hitung ulang semua sudah dihapus (nilai tampil otomatis)');
  for (const aksi of ['simpan', 'unduh']) assert.ok(b.innerHTML.includes(`data-nr="${aksi}"`), 'tombol ' + aksi);
});
await uji('tanpa siswa atau tanpa penilaian sumatif: pesan yang jelas, tidak galat', async () => {
  globalThis.__api.data.roster = []; let b = badan(); await M.renderNilaiRapor(b, ctx); assert.match(b.innerHTML, /Belum ada siswa terdaftar/);
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen = []; b = badan(); await M.renderNilaiRapor(b, ctx); assert.match(b.innerHTML, /Belum ada penilaian sumatif/); assert.ok(b.innerHTML.includes('data-nr="simpan"'), 'tabel tetap tampil');
});
await uji('Simpan tanpa mengisi apa pun: payload berisi nilai otomatis, metode RATA, T/R dan deskripsi', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  await klik(b, 'simpan');
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
await uji('nilai rapor TIDAK dapat diubah di layar: kolom hanya-baca, perubahan lewat peristiwa diabaikan, Simpan mengirim hasil rumus dan tidak pernah metode MANUAL', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /class="nr-nilai"[^>]*readonly/, 'kolom nilai rapor harus hanya-baca');
  assert.ok(!b.innerHTML.includes('data-nr="otomatis"') && !/manual/i.test(b.innerHTML), 'tidak boleh ada istilah atau tombol manual');
  ubah(b, 's1', 'nr-nilai', '77'); await klik(b, 'simpan');   // upaya mengubah angka: diabaikan
  const rows = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6];
  const budi = rows.find((r) => r.studentId === 's1');
  assert.equal(budi.nilai_rapor, 70, 'angka yang dikirim harus hasil rumus, bukan 77'); assert.equal(budi.metode, 'RATA');
  assert.ok(rows.every((r) => r.metode !== 'MANUAL'));
});
await uji('siswa yang rumusnya tak dapat dihitung (tanpa nilai sumatif) dan punya nilai tersimpan: kolom kosong; Simpan meminta konfirmasi, lalu menghapus; yang belum pernah tersimpan dilewati', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70.00', metode: 'RATA', tp_optimal: ['tp1'], tp_perlu: [], deskripsi_tertinggi: 'X', deskripsi_terendah: null }];
  globalThis.__api.data.hasil = globalThis.__api.data.hasil.filter((h) => h.student_id !== 's1');   // s1 tidak punya nilai sumatif lagi
  const b = badan(); await muat(b);
  assert.match(b.innerHTML, /data-sid="s1"[\s\S]*?class="nr-nilai"[^>]*value=""/, 'nilai s1 harus kosong (tidak ada dasar hitung)');
  await klik(b, 'simpan');
  assert.equal(globalThis.__api.panggilan.length, 0, 'penghapusan terjadi tanpa konfirmasi');   // klik pertama hanya memperingatkan
  assert.match(b.el['#nr-pesan'].textContent, /akan DIHAPUS.*Budi/);
  await klik(b, 'simpan');   // klik kedua = konfirmasi
  const hapus = globalThis.__api.panggilan.find((p) => p[0] === 'hapus');
  assert.ok(hapus && hapus[1][6].includes('s1'), 'baris s1 tidak dihapus');
  assert.match(b.el['#nr-pesan'].textContent, /nilai rapor 1 siswa dihapus/);
  assert.ok(!globalThis.__api.panggilan.some((p) => p[0] === 'upsert' && p[1][6].some((r) => r.studentId === 's1')));
  assert.ok(!hapus[1][6].includes('s2'), 's2 tidak punya baris tersimpan sehingga tidak perlu dihapus');
});
await uji('server menolak: guru diberi tahu galat dan tombol Simpan aktif kembali (bukan terkunci)', async () => {
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  globalThis.__api.gagal = true; await klik(b, 'simpan');
  assert.ok(toasts.some(([m, ok]) => !ok && /Gagal simpan/.test(m)));
  globalThis.__api.gagal = false; globalThis.__api.panggilan = []; await klik(b, 'simpan');   // dapat disimpan ulang
  assert.ok(globalThis.__api.panggilan.some((p) => p[0] === 'upsert'));
});

await uji('izin tampil: bawaan mati; centang siswa saja / ortu saja / keduanya terkirim pada setiap baris; dimuat kembali dari data tersimpan', async () => {
  const centang = (b, id, v) => b.onchange({ target: { id, checked: v, value: '', dataset: {}, classList: { contains: () => false }, closest: () => null } });
  let b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.ok(b.innerHTML.includes('id="nr-vis-siswa"') && b.innerHTML.includes('id="nr-vis-ortu"'), 'centang izin tidak tampil');
  assert.ok(!/id="nr-vis-siswa" checked/.test(b.innerHTML) && !/id="nr-vis-ortu" checked/.test(b.innerHTML), 'bawaan harus tidak terlihat');
  await klik(b, 'simpan');
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
  b = badan(); await muat(b);
  assert.match(b.innerHTML, /id="nr-vis-siswa" checked/); assert.ok(!/id="nr-vis-ortu" checked/.test(b.innerHTML));
});

await uji('semua baris mengikuti rumus, termasuk baris tersimpan lama bermetode MANUAL; ditandai belum disimpan bila berbeda; tidak ada tombol otomatis atau istilah manual', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '50', metode: 'RATA', tp_optimal: [], tp_perlu: [] }, { student_id: 's2', nilai_rapor: '77', metode: 'MANUAL', tp_optimal: [], tp_perlu: [] }];
  const b = badan(); await muat(b);
  assert.match(b.innerHTML, /data-sid="s1"[\s\S]*?value="70"[\s\S]*?belum disimpan/, 's1 harus mengikuti rumus (70) dan ditandai belum disimpan');
  const s2 = 'data-sid="s2"' + b.innerHTML.split('data-sid="s2"')[1].split('</tr>')[0];
  assert.match(s2, /value="90"/, 's2 (dulu MANUAL 77) harus mengikuti rumus (90)'); assert.match(s2, /belum disimpan/);
  assert.ok(!b.innerHTML.includes('data-nr="otomatis"') && !/manual/i.test(b.innerHTML));
});

await uji('rumus tersimpan tidak berubah diam-diam: dimuat BOBOT (walau ada baris MANUAL lama, baris tanpa rumus, atau bobot milik penilaian lain), disimpan tetap BOBOT', async () => {
  const bobot = { a1: 60, a2: 40, a_hilang: 10 };
  const kasus = [
    [{ student_id: 's1', nilai_rapor: '70', metode: 'MANUAL', rumus: { metode: 'BOBOT', bobot }, tp_optimal: [], tp_perlu: [] }, { student_id: 's2', nilai_rapor: '90', metode: 'BOBOT', rumus: { metode: 'BOBOT', bobot }, tp_optimal: [], tp_perlu: [] }],
    [{ student_id: 's1', nilai_rapor: '70', metode: 'BOBOT', rumus: null, tp_optimal: [], tp_perlu: [] }, { student_id: 's2', nilai_rapor: '90', metode: 'MANUAL', rumus: { metode: 'BOBOT', bobot }, tp_optimal: [], tp_perlu: [] }],
  ];
  for (const tersimpan of kasus) {
    globalThis.__api.panggilan = []; globalThis.__api.data.tersimpan = tersimpan;
    const b = badan(); await muat(b);
    assert.equal(R.getRumus().metode, 'BOBOT', 'metode BOBOT harus terpilih saat dimuat');
    assert.match(b.innerHTML, /Rumus: <strong>Pembobotan/, 'ringkasan rumus hanya-baca harus menyebut Pembobotan');
    await klik(b, 'simpan');
    const rows = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6];
    assert.ok(rows.every((r) => r.rumus.metode === 'BOBOT'), 'rumus tersimpan berubah dari BOBOT');
    assert.ok(!('a_hilang' in rows[0].rumus.bobot), 'bobot penilaian yang sudah tiada harus dibuang');
  }
});

await uji('rumus diubah di Rekap (lewat keadaan bersama): Nilai Rapor hitung ulang, tampak jelas dari mana ke mana sebelum disimpan, dan peringatan hilang setelah Simpan', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'BOBOT', rumus: { metode: 'BOBOT', bobot: { a1: 60, a2: 40 } }, tp_optimal: [], tp_perlu: [] }];
  const b = badan(); await muat(b);
  assert.ok(!b.innerHTML.includes('Rumus diubah'), 'tanpa perubahan tidak boleh ada peringatan');
  R.setMetode('RATA');   // guru memilih metode lain di panel Rekap
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus diubah dari <strong>Pembobotan[^<]*<\/strong> menjadi <strong>Rata-rata[^<]*<\/strong> di bagian Rekap[\s\S]*belum disimpan/);
  assert.match(b.el['#nr-ringkas'].innerHTML, /Rata-rata/, 'ringkasan rumus harus ikut berubah');
  await klik(b, 'simpan');
  assert.ok(!b.el['#nr-rumus'].innerHTML.includes('Rumus diubah'), 'setelah disimpan peringatan harus hilang');
  assert.equal(R.adaPerubahan(['a1', 'a2']), false, 'keadaan bersama harus mencatat rumus sebagai tersimpan (agar penanda di Rekap hilang)');
});

await uji('rumus belum lengkap (Pembobotan tanpa total 100%) tidak mengosongkan nilai dan tidak menghapus nilai tersimpan; ada peringatan', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'RATA', rumus: { metode: 'RATA', bobot: {} }, tp_optimal: [], tp_perlu: [] },
                                     { student_id: 's2', nilai_rapor: '90', metode: 'RATA', rumus: { metode: 'RATA', bobot: {} }, tp_optimal: [], tp_perlu: [] }];
  const inputs = { s1: { value: '70' }, s2: { value: '90' } };
  const tr = (sid) => ({ dataset: { sid }, querySelector: (q) => (q === '.nr-nilai' ? inputs[sid] : { innerHTML: '', outerHTML: '' }) });
  const b = badan(); b.querySelectorAll = (q) => (q === 'tr[data-sid]' ? [tr('s1'), tr('s2')] : []);
  await muat(b);
  R.setMetode('BOBOT');   // dari Rekap; bobot belum diisi
  assert.equal(inputs.s1.value, '70', 'nilai s1 dikosongkan oleh rumus yang belum lengkap'); assert.equal(inputs.s2.value, '90');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: Total bobot 0%/, 'peringatan rumus belum lengkap tidak tampil');
  await klik(b, 'simpan');
  assert.ok(!globalThis.__api.panggilan.some((p) => p[0] === 'hapus' && p[1][6].length), 'nilai tersimpan terhapus karena rumus belum lengkap');
  const up = globalThis.__api.panggilan.find((p) => p[0] === 'upsert'); assert.ok(up, 'tidak tersimpan');
  assert.deepEqual(up[1][6].map((r) => r.nilai_rapor).sort(), [70, 90]);
});

await uji('Persentase TP yang tidak bisa dihitung (penilaian tanpa TP, atau TP tanpa KKTP) menjelaskan alasannya dan tidak mengubah nilai; sebagian data diberi catatan', async () => {
  const ubahMetode = (v) => R.setMetode(v);
  globalThis.__api.data.asesmen = globalThis.__api.data.asesmen.map((a) => ({ ...a, tpIds: [] }));
  let b = badan(); await muat(b); ubahMetode('PERSEN');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: Belum ada penilaian sumatif yang ditautkan ke TP/);
  globalThis.__api.data = dasar(); globalThis.__api.data.kktp = { tp1: [], tp2: [] };
  b = badan(); await muat(b); ubahMetode('PERSEN');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: TP yang ditautkan belum punya KKTP/);
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen[1].tpIds = [];
  b = badan(); await muat(b); ubahMetode('PERSEN');
  assert.match(b.el['#nr-rumus'].innerHTML, /1 penilaian sumatif belum ditautkan ke TP/);
  assert.ok(!/Rumus belum lengkap/.test(b.el['#nr-rumus'].innerHTML), 'sebagian data bukan galat');
});

await uji('metode Nilai TP terakhir: memakai TP terakhir yang punya penilaian, menyebut TP itu di layar, dan menjelaskan bila belum ada TP tertaut', async () => {
  let b = badan(); await muat(b); R.setMetode('TERAKHIR');
  assert.match(b.el['#nr-rumus'].innerHTML, /TP-2<\/strong> \(TP terakhir yang punya penilaian sumatif\)/);
  assert.ok(!/Rumus belum lengkap/.test(b.el['#nr-rumus'].innerHTML));
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen = globalThis.__api.data.asesmen.map((a) => ({ ...a, tpIds: [] }));
  b = badan(); await muat(b); R.setMetode('TERAKHIR');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: Belum ada penilaian sumatif yang ditautkan ke TP/);
});

await uji('Nilai Rapor tidak lagi punya pilihan metode atau isian bobot (rumus dipilih di Rekap); hanya ringkasan hanya-baca', async () => {
  const sumber = fs.readFileSync(new URL('../guru/js/nilai-rapor-ui.js', import.meta.url), 'utf8');
  for (const x of ['id="nr-metode"', 'class="nr-bobot"', 'nr-bobot-status', 'bobotHtml', 'row.manual', "'MANUAL'"]) assert.ok(!sumber.includes(x), 'Nilai Rapor masih memuat ' + x);
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /id="nr-ringkas"[^>]*>Rumus: <strong>Rata-rata[\s\S]*?\(dipilih di bagian Rekap\)/);
  assert.ok(!/<select/.test(b.innerHTML), 'tidak boleh ada kotak pilihan di Nilai Rapor');
});

await uji('usulan T/R siswa baru: satu T dan satu R dari KKTP; tanpa KKTP diberi penanda dasar nilai', async () => {
  let b = badan(); await muat(b);   // Budi: tp1 80, tp2 60; batas KKTP 70 -> T: TP-1 (tercapai), R: TP-2 (belum tercapai)
  assert.match(b.innerHTML, /T: TP-1 · R: TP-2/);
  assert.ok(!/dasar nilai, KKTP belum ada/.test(b.innerHTML));
  globalThis.__api.data = dasar(); globalThis.__api.data.kktp = { tp1: [], tp2: [] };
  b = badan(); await muat(b);
  assert.match(b.innerHTML, /T: TP-1 · R: TP-2 <span[^>]*>\(dasar nilai, KKTP belum ada\)/);
});

await uji('rumus LENGKAP tetapi siswa tak punya datanya (mis. belum bernilai di TP terakhir): nilai sisa metode sebelumnya dikosongkan; rumus belum lengkap tidak mengosongkan', async () => {
  globalThis.__api.data.hasil = globalThis.__api.data.hasil.filter((h) => !(h.student_id === 's2' && h.assessment_id === 'a2'));   // s2 tanpa nilai di TP-2 (TP terakhir)
  const inputs = { s1: { value: '' }, s2: { value: '' } };
  const tr = (sid) => ({ dataset: { sid }, querySelector: (q) => (q === '.nr-nilai' ? inputs[sid] : { innerHTML: '', outerHTML: '' }) });
  const b = badan(); b.querySelectorAll = (q) => (q === 'tr[data-sid]' ? [tr('s1'), tr('s2')] : []);
  await muat(b);
  R.setMetode('PERSEN'); R.setMetode('RATA'); assert.equal(inputs.s2.value, '90', 'rata-rata s2 = nilai a1 saja');
  R.setMetode('TERAKHIR'); assert.equal(inputs.s1.value, '60'); assert.equal(inputs.s2.value, '', 'nilai RATA s2 tidak boleh bertahan di metode TP terakhir');
  R.setMetode('BOBOT'); assert.equal(inputs.s1.value, '60', 'rumus belum lengkap (bobot 0%): nilai yang ada tidak diubah dan tidak dikosongkan diam-diam');
});

await uji('siswa baru sebagian bernilai diberi penanda; TP tanpa penilaian sumatif disebut; id TP terhapus tidak tampil', async () => {
  globalThis.__api.data.tps.push({ id: 'tp3', kode_tp: 'TP-3', deskripsi_tp: 'belum dinilai' }); globalThis.__api.data.kktp.tp3 = [];
  globalThis.__api.data.hasil = globalThis.__api.data.hasil.filter((h) => !(h.student_id === 's2' && h.assessment_id === 'a2'));   // s2 baru 1 dari 2 penilaian sumatif
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'RATA', tp_optimal: ['tp1', 'tp-dihapus'], tp_perlu: ['tp-dihapus-2'], deskripsi_tertinggi: '', deskripsi_terendah: '' }];
  const b = badan(); await muat(b);
  assert.match(b.innerHTML, /baru 1 dari 2 penilaian sumatif bernilai/, 'penanda data tidak lengkap');
  assert.ok(!/belum ada nilai penilaian sumatif/.test(b.innerHTML.split('Budi')[1]?.split('</tr>')[0] ?? ''), 's1 lengkap tidak diberi penanda');
  assert.match(b.innerHTML, /1 dari 3 TP belum punya penilaian sumatif \(TP-3\)/);
  assert.ok(!/(T|R): [^<]*\?/.test(b.innerHTML), 'id TP yang sudah dihapus tampil sebagai ?');
  assert.match(b.innerHTML, /T: TP-1/);
});

await uji('perubahan rumus membatalkan konfirmasi hapus yang menunggu: Simpan kembali meminta konfirmasi dan tidak menghapus diam-diam', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'RATA', tp_optimal: [], tp_perlu: [] }];
  globalThis.__api.data.hasil = globalThis.__api.data.hasil.filter((h) => h.student_id !== 's1');   // s1 tanpa nilai: akan dihapus
  const b = badan(); await muat(b);
  await klik(b, 'simpan'); assert.match(b.el['#nr-pesan'].textContent, /akan DIHAPUS/);
  R.setMetode('PERSEN');   // guru mengubah rumus di Rekap: konfirmasi sebelumnya batal
  await klik(b, 'simpan');
  assert.equal(globalThis.__api.panggilan.length, 0, 'penghapusan terjadi tanpa konfirmasi ulang setelah rumus berubah');
  assert.match(b.el['#nr-pesan'].textContent, /akan DIHAPUS/);
});

await uji('angka rapor ditetapkan SERVER: bila sama dengan layar tidak ada peringatan; bila berbeda, layar mengikuti angka server dan guru diberi tahu', async () => {
  let b = badan(); await muat(b);
  globalThis.__api.serverTetapkan = (r) => r.nilai_rapor;   // server menetapkan angka yang sama
  await klik(b, 'simpan');
  assert.match(b.el['#nr-pesan'].textContent, /^Tersimpan: 2 siswa\.$/, 'tanpa selisih tidak boleh ada peringatan');
  b = badan(); await muat(b);
  globalThis.__api.serverTetapkan = (r) => (r.studentId === 's1' ? r.nilai_rapor + 3 : r.nilai_rapor);   // server menetapkan angka lain untuk s1
  await klik(b, 'simpan');
  assert.match(b.el['#nr-pesan'].textContent, /PERHATIAN: server menetapkan angka yang berbeda dari layar untuk Budi/);
  assert.equal(b.el['#nr-pesan'].style.color, 'var(--color-danger)', 'peringatan harus berwarna galat');
});
await uji('klien tidak mengirim angka manual: setiap baris membawa rumus, dan metode selalu salah satu dari empat rumus', async () => {
  const b = badan(); await muat(b);
  await klik(b, 'simpan');
  const rows = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6];
  assert.ok(rows.length >= 2 && rows.every((r) => r.rumus && ['RATA', 'BOBOT', 'PERSEN', 'TERAKHIR'].includes(r.rumus.metode) && r.metode === r.rumus.metode));
  const api = fs.readFileSync(new URL('../guru/js/api.js', import.meta.url), 'utf8');
  assert.match(api, /\.select\('student_id, nilai_rapor, metode'\);/, 'api harus membaca balik angka yang tersimpan');
});

fs.rmSync(dirTmp, { recursive: true, force: true });
console.log(`\nNILAI_RAPOR_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
