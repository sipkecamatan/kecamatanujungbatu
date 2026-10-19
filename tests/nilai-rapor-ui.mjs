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
globalThis.CSS = { escape: (x) => x };
const badan = () => { const el = {}; return { innerHTML: '', onclick: null, onchange: null, el, querySelector: (q) => (q.startsWith('tr[') ? null : (el[q] ??= { innerHTML: '', style: {}, textContent: '' })), querySelectorAll: () => [] }; };
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
  globalThis.__api.panggilan = []; globalThis.__api.gagal = false; toasts.length = 0; globalThis.__api.data = dasar();
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
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen = []; b = badan(); await M.renderNilaiRapor(b, ctx); assert.match(b.innerHTML, /Belum ada penilaian sumatif/); assert.ok(b.innerHTML.includes('data-nr="simpan"'), 'tabel tetap tampil agar nilai dapat diisi manual');
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
  b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /id="nr-vis-siswa" checked/); assert.ok(!/id="nr-vis-ortu" checked/.test(b.innerHTML));
});

await uji('nilai otomatis: baris tersimpan yang tertinggal mengikuti rumus dan ditandai belum disimpan; baris manual dibiarkan dan bertombol otomatis', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '50', metode: 'RATA', tp_optimal: [], tp_perlu: [] }, { student_id: 's2', nilai_rapor: '77', metode: 'MANUAL', tp_optimal: [], tp_perlu: [] }];
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /data-sid="s1"[\s\S]*?value="70"[\s\S]*?belum disimpan/, 's1 harus mengikuti rumus (70) dan ditandai belum disimpan');
  assert.match(b.innerHTML, /data-sid="s2"[\s\S]*?value="77"/, 's2 manual harus tetap 77');
  assert.ok(b.innerHTML.includes('data-nr="otomatis"'), 'baris manual harus punya tombol otomatis');
  assert.ok(!/data-sid="s2"[\s\S]*?value="90"/.test(b.innerHTML.split('data-sid="s2"')[1]?.split('</tr>')[0] ? 'data-sid="s2"' + b.innerHTML.split('data-sid="s2"')[1].split('</tr>')[0] : ''), 's2 tidak boleh berubah jadi 90');
});

await uji('rumus tersimpan tidak berubah diam-diam: dimuat BOBOT (walau ada baris MANUAL, baris tanpa rumus, atau bobot milik penilaian lain), disimpan tetap BOBOT', async () => {
  const bobot = { a1: 60, a2: 40, a_hilang: 10 };
  const kasus = [
    [{ student_id: 's1', nilai_rapor: '70', metode: 'MANUAL', rumus: { metode: 'BOBOT', bobot }, tp_optimal: [], tp_perlu: [] }, { student_id: 's2', nilai_rapor: '90', metode: 'BOBOT', rumus: { metode: 'BOBOT', bobot }, tp_optimal: [], tp_perlu: [] }],
    [{ student_id: 's1', nilai_rapor: '70', metode: 'BOBOT', rumus: null, tp_optimal: [], tp_perlu: [] }, { student_id: 's2', nilai_rapor: '90', metode: 'MANUAL', rumus: { metode: 'BOBOT', bobot }, tp_optimal: [], tp_perlu: [] }],
  ];
  for (const tersimpan of kasus) {
    globalThis.__api.panggilan = []; globalThis.__api.data.tersimpan = tersimpan;
    const b = badan(); await M.renderNilaiRapor(b, ctx);
    assert.match(b.innerHTML, /<option value="BOBOT" selected>/, 'metode BOBOT harus terpilih saat dimuat');
    await klik(b, 'simpan');
    const rows = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6];
    assert.ok(rows.every((r) => r.rumus.metode === 'BOBOT'), 'rumus tersimpan berubah dari BOBOT');
    assert.ok(!('a_hilang' in rows[0].rumus.bobot), 'bobot penilaian yang sudah tiada harus dibuang');
  }
});

await uji('perubahan rumus tampak jelas sebelum disimpan (dari mana ke mana, semua siswa ikut berubah) dan hilang setelah disimpan', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'BOBOT', rumus: { metode: 'BOBOT', bobot: { a1: 60, a2: 40 } }, tp_optimal: [], tp_perlu: [] }];
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.ok(!b.innerHTML.includes('Rumus diubah'), 'tanpa perubahan tidak boleh ada peringatan');
  b.onchange({ target: { id: 'nr-metode', value: 'RATA', dataset: {}, classList: { contains: () => false }, closest: () => null } });
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus diubah dari <strong>Pembobotan[^<]*<\/strong> menjadi <strong>Rata-rata[^<]*<\/strong>[\s\S]*belum disimpan/);
  await klik(b, 'simpan');
  assert.ok(!b.el['#nr-rumus'].innerHTML.includes('Rumus diubah'), 'setelah disimpan peringatan harus hilang');
});

await uji('rumus belum lengkap (Pembobotan tanpa total 100%) tidak mengosongkan nilai dan tidak menghapus nilai tersimpan; ada peringatan', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '70', metode: 'RATA', rumus: { metode: 'RATA', bobot: {} }, tp_optimal: [], tp_perlu: [] },
                                     { student_id: 's2', nilai_rapor: '90', metode: 'RATA', rumus: { metode: 'RATA', bobot: {} }, tp_optimal: [], tp_perlu: [] }];
  const inputs = { s1: { value: '70' }, s2: { value: '90' } };
  const tr = (sid) => ({ dataset: { sid }, querySelector: (q) => (q === '.nr-nilai' ? inputs[sid] : { innerHTML: '', outerHTML: '' }) });
  const b = badan(); b.querySelectorAll = (q) => (q === 'tr[data-sid]' ? [tr('s1'), tr('s2')] : []);
  await M.renderNilaiRapor(b, ctx);
  b.onchange({ target: { id: 'nr-metode', value: 'BOBOT', dataset: {}, classList: { contains: () => false }, closest: () => null } });
  assert.equal(inputs.s1.value, '70', 'nilai s1 dikosongkan oleh rumus yang belum lengkap'); assert.equal(inputs.s2.value, '90');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: Total bobot 0%/, 'peringatan rumus belum lengkap tidak tampil');
  await klik(b, 'simpan');
  assert.ok(!globalThis.__api.panggilan.some((p) => p[0] === 'hapus' && p[1][6].length), 'nilai tersimpan terhapus karena rumus belum lengkap');
  const up = globalThis.__api.panggilan.find((p) => p[0] === 'upsert'); assert.ok(up, 'tidak tersimpan');
  assert.deepEqual(up[1][6].map((r) => r.nilai_rapor).sort(), [70, 90]);
});
await uji('tombol otomatis per baris: nilai manual kembali mengikuti rumus tanpa menyimpan sendiri', async () => {
  globalThis.__api.data.tersimpan = [{ student_id: 's1', nilai_rapor: '55', metode: 'MANUAL', rumus: { metode: 'RATA', bobot: {} }, tp_optimal: [], tp_perlu: [] }];
  const b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /class="nr-nilai"[^>]*value="55"/); assert.ok(b.innerHTML.includes('data-nr="otomatis"'));
  const tombol = { dataset: { nr: 'otomatis' }, closest: () => ({ dataset: { sid: 's1' } }) };
  await b.onclick({ target: { closest: (sel) => (sel === '[data-nr]' ? tombol : null) } });
  assert.ok(globalThis.__api.panggilan.every((p) => p[0] !== 'upsert'), 'otomatis tidak boleh menyimpan sendiri');
  await klik(b, 'simpan');
  const row = globalThis.__api.panggilan.find((p) => p[0] === 'upsert')[1][6].find((r) => r.studentId === 's1');
  assert.equal(row.nilai_rapor, 70); assert.equal(row.metode, 'RATA');
});

await uji('Persentase TP yang tidak bisa dihitung (penilaian tanpa TP, atau TP tanpa KKTP) menjelaskan alasannya dan tidak mengubah nilai; sebagian data diberi catatan', async () => {
  const ubahMetode = (b, v) => b.onchange({ target: { id: 'nr-metode', value: v, dataset: {}, classList: { contains: () => false }, closest: () => null } });
  globalThis.__api.data.asesmen = globalThis.__api.data.asesmen.map((a) => ({ ...a, tpIds: [] }));
  let b = badan(); await M.renderNilaiRapor(b, ctx); ubahMetode(b, 'PERSEN');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: Belum ada penilaian sumatif yang ditautkan ke TP/);
  globalThis.__api.data = dasar(); globalThis.__api.data.kktp = { tp1: [], tp2: [] };
  b = badan(); await M.renderNilaiRapor(b, ctx); ubahMetode(b, 'PERSEN');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: TP yang ditautkan belum punya KKTP/);
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen[1].tpIds = [];
  b = badan(); await M.renderNilaiRapor(b, ctx); ubahMetode(b, 'PERSEN');
  assert.match(b.el['#nr-rumus'].innerHTML, /1 penilaian sumatif belum ditautkan ke TP/);
  assert.ok(!/Rumus belum lengkap/.test(b.el['#nr-rumus'].innerHTML), 'sebagian data bukan galat');
});

await uji('metode Nilai TP terakhir: memakai TP terakhir yang punya penilaian, menyebut TP itu di layar, dan menjelaskan bila belum ada TP tertaut', async () => {
  const ubahMetode = (b, v) => b.onchange({ target: { id: 'nr-metode', value: v, dataset: {}, classList: { contains: () => false }, closest: () => null } });
  globalThis.__api.data = dasar();
  let b = badan(); await M.renderNilaiRapor(b, ctx); ubahMetode(b, 'TERAKHIR');
  assert.match(b.el['#nr-rumus'].innerHTML, /TP-2<\/strong> \(TP terakhir yang punya penilaian sumatif\)/);
  assert.ok(!/Rumus belum lengkap/.test(b.el['#nr-rumus'].innerHTML));
  globalThis.__api.data = dasar(); globalThis.__api.data.asesmen = globalThis.__api.data.asesmen.map((a) => ({ ...a, tpIds: [] }));
  b = badan(); await M.renderNilaiRapor(b, ctx); ubahMetode(b, 'TERAKHIR');
  assert.match(b.el['#nr-rumus'].innerHTML, /Rumus belum lengkap: Belum ada penilaian sumatif yang ditautkan ke TP/);
});

await uji('isian bobot tidak digambar ulang saat diubah (fokus Tab tidak hilang): hanya teks total yang diperbarui', async () => {
  const sumber = fs.readFileSync(new URL('../guru/js/nilai-rapor-ui.js', import.meta.url), 'utf8');
  assert.match(sumber, /id="nr-bobot-status"/);
  assert.match(sumber, /if \(st\.metode === 'BOBOT' && st2\) st2\.innerHTML = statusBobotHtml\(\); else b\.innerHTML = bobotHtml\(\);/);
});

await uji('usulan T/R siswa baru: satu T dan satu R dari KKTP; tanpa KKTP diberi penanda dasar nilai', async () => {
  globalThis.__api.data = dasar();   // Budi: tp1 80, tp2 60; batas KKTP 70 -> T: TP-1 (tercapai), R: TP-2 (belum tercapai)
  let b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /T: TP-1 · R: TP-2/);
  assert.ok(!/dasar nilai, KKTP belum ada/.test(b.innerHTML));
  globalThis.__api.data = dasar(); globalThis.__api.data.kktp = { tp1: [], tp2: [] };
  b = badan(); await M.renderNilaiRapor(b, ctx);
  assert.match(b.innerHTML, /T: TP-1 · R: TP-2 <span[^>]*>\(dasar nilai, KKTP belum ada\)/);
});

fs.rmSync(dirTmp, { recursive: true, force: true });
console.log(`\nNILAI_RAPOR_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
