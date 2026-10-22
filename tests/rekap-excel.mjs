// Uji logika murni Excel di REKAP dan catatan Excel Nilai Rapor (guru/js/rekap-excel.js, konten-penilaian.js, penilaian-label.js saringPenilaian, nilai-rapor.js statusSimpanRapor/susunCatatanRapor).
// Keputusan Romo 23 Okt 2026: Excel Rekap = salinan tampilan (hanya yang lolos filter), semua bentuk penilaian ikut, judul penilaian dan refleksi ada, urutan TP mengikuti urutan TP,
// tanpa lembar e-Rapor; Excel Nilai Rapor = berkas kerja dengan status penyimpanan. Tanpa jaringan dan tanpa SheetJS.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, 'guru', 'js', p)).href);
const X = await imp('rekap-excel.js');
const L = await imp('penilaian-label.js');
const N = await imp('nilai-rapor.js');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.message).slice(0, 400)); } };

const roster = [{ id: 's1', nama: 'Adelia', nis: '0012' }, { id: 's2', nama: 'Budi', nis: '0013' }, { id: 's3', nama: 'Citra', nis: '0014' }];
const tpById = { t7: { kode_tp: 'TP7', deskripsi_tp: 'Fungsi aplikasi' }, t8: { kode_tp: 'TP8', deskripsi_tp: 'Data master' }, t9: { kode_tp: 'TP9', deskripsi_tp: 'Transaksi' } };   // urutan kunci = urutan TP
const dasar = { tanggal: '2026-10-19', tujuan: 'Ket', refleksi_guru: null, konten: null, tpIds: [] };
const A = (o) => ({ ...dasar, ...o });

const asmts = [
  A({ id: 'a1', jenis: 'SUMATIF', teknik: 'TES', instrumen: 'Pilihan Ganda', judul: 'UH 1', tpIds: ['t7'], refleksi_guru: 'Refleksi UH1' }),
  A({ id: 'a2', jenis: 'SUMATIF', teknik: 'PROYEK', instrumen: 'Rubrik', judul: 'Proyek', tpIds: ['t9', 't7', 't8'] }),   // urutan tautan acak
  A({ id: 'a3', jenis: 'FORMATIF', teknik: 'OBSERVASI', instrumen: 'Lembar Observasi', judul: 'Observasi', konten: { aspeks: [{ nama: 'Kesiapan', indikator: 'Menyalakan', terlihat_jelas: ['s1'], terlihat: ['s2'], belum_terlihat: [] }, { nama: 'Kerapian', terlihat_jelas: [], terlihat: [], belum_terlihat: ['s3'] }] } }),
  A({ id: 'a4', jenis: 'FORMATIF', teknik: 'PENUGASAN', instrumen: 'Rubrik', konten: { aspeks: [{ nama: 'Isi', predikat: [{ val: 'SB', label: 'Sangat Berkembang', siswa: ['s1'] }, { val: 'MB', siswa: ['s2'] }] }] } }),
  A({ id: 'a5', jenis: 'FORMATIF', teknik: 'OBSERVASI', instrumen: 'Catatan Anekdot', konten: { catatan: [{ siswa: 's2', teks: 'x' }, { siswa: ['s1', 's3'], teks: 'y' }] } }),
  A({ id: 'a6', jenis: 'FORMATIF', teknik: 'PORTOFOLIO', instrumen: 'Checklist', konten: { items: [{ nama: 'Jurnal', siswa: ['s1'] }, { nama: 'Buku besar', siswa: ['s1', 's2'] }] } }),
  A({ id: 'a7', jenis: 'DIAGNOSTIK_K', teknik: 'TES', instrumen: 'Uraian', konten: { deskriptor: [{ label: 'Paham', siswa: ['s3'] }, { label: 'Belum', siswa: ['s2'] }] } }),
  A({ id: 'a8', jenis: 'FORMATIF', teknik: 'TES_LISAN', instrumen: 'Dialog', konten: { predikat: [{ val: 'BSH', siswa: ['s2'] }, { val: 'SB', siswa: ['s2', 's1'] }] } }),
  A({ id: 'a9', jenis: 'FORMATIF', teknik: 'UNJUK_KERJA', instrumen: 'Rubrik', konten: null }),   // belum ada data
];
const hasil = { a1: { s1: { nilai: 92, status: null, tindak_lanjut: 'PENGAYAAN' }, s2: { nilai: 55.5, status: null } }, a2: { s1: { nilai: 93, status: 'SB' }, s3: { nilai: 27, status: 'BB' } } };
const baris = X.susunLembarRekap({ asmts, roster, hasil, tpById });
const per = (id) => baris.filter((r) => r[2] === L.labelPenilaian(asmts.find((a) => a.id === id), tpById));
const kolom = Object.fromEntries(X.HEADER_REKAP.map((h, i) => [h, i]));

uji('header berisi kolom Penilaian dan Refleksi Guru; setiap baris selalu selebar header (15 kolom) pada SEMUA bentuk penilaian', () => {
  assert.equal(X.HEADER_REKAP.length, 15); assert.ok(X.HEADER_REKAP.includes('Penilaian') && X.HEADER_REKAP.includes('Refleksi Guru'));
  assert.ok(baris.length > 0 && baris.every((r) => r.length === 15), 'ada baris yang tidak 15 kolom');
});
uji('penilaian bernilai angka: satu baris per siswa roster; angka tetap angka, NIS tetap teks (nol di depan), tindak lanjut ikut; siswa tanpa hasil kosong', () => {
  const r = baris.filter((x) => x[kolom.Penilaian] === 'UH 1');
  assert.equal(r.length, 3);
  assert.deepEqual([r[0][kolom['Nama Siswa']], r[0][kolom.NIS], r[0][kolom['Nilai / Hasil']], r[0][kolom['Tindak Lanjut']]], ['Adelia', '0012', 92, 'PENGAYAAN']);
  assert.equal(typeof r[1][kolom['Nilai / Hasil']], 'number'); assert.equal(r[1][kolom['Nilai / Hasil']], 55.5);
  assert.equal(r[2][kolom['Nilai / Hasil']], ''); assert.equal(r[2][kolom['Nama Siswa']], 'Citra');
  assert.equal(r[0][kolom.Teknik], 'TES TERTULIS');
});
uji('sumatif non-TES: predikat di kolom Status/Predikat bersama angka', () => {
  const r = baris.filter((x) => x[kolom.Penilaian] === 'Proyek');
  assert.deepEqual([r[0][kolom['Nilai / Hasil']], r[0][kolom['Status/Predikat']]], [93, 'SB']); assert.deepEqual([r[2][kolom['Nilai / Hasil']], r[2][kolom['Status/Predikat']]], [27, 'BB']);
});
uji('kolom Penilaian memuat judul bila ada; tanpa judul memakai label turunan yang sama dengan layar (TP + tanggal + teknik)', () => {
  assert.ok(baris.some((r) => r[kolom.Penilaian] === 'UH 1'));
  const tanpaJudul = baris.find((r) => r[kolom.Instrumen] === 'Catatan Anekdot')[kolom.Penilaian];
  assert.equal(tanpaJudul, L.labelPenilaian(asmts.find((a) => a.id === 'a5'), tpById)); assert.match(tanpaJudul, /Tanpa TP/);
});
uji('kolom TP memuat kode + deskripsi dan urutannya mengikuti URUTAN TP (bukan urutan tautan di database)', () => {
  const tp = baris.find((r) => r[kolom.Penilaian] === 'Proyek')[kolom.TP];
  assert.equal(tp, 'TP7 – Fungsi aplikasi; TP8 – Data master; TP9 – Transaksi');
});
uji('refleksi guru dari kolom refleksi_guru ikut di setiap baris penilaian itu (angka maupun lainnya); data lama konten.refleksi tetap terbaca', () => {
  assert.ok(baris.filter((r) => r[kolom.Penilaian] === 'UH 1').every((r) => r[kolom['Refleksi Guru']] === 'Refleksi UH1'));
  const hasilLama = X.susunLembarRekap({ asmts: [A({ id: 'x', jenis: 'FORMATIF', teknik: 'OBSERVASI', instrumen: 'Lembar Observasi', konten: { refleksi: 'lama', aspeks: [{ nama: 'A', terlihat: ['s1'] }] } })], roster, tpById });
  assert.equal(hasilLama[0][kolom['Refleksi Guru']], 'lama');
  const kosong = X.susunLembarRekap({ asmts: [asmts[1]], roster, hasil, tpById }); assert.equal(kosong[0][kolom['Refleksi Guru']], '');
});
uji('lembar observasi: satu baris per siswa PER ASPEK; kategori terbaca; siswa yang belum dinilai pada aspek itu tetap tampil kosong', () => {
  const r = baris.filter((x) => x[kolom.Penilaian] === 'Observasi');
  assert.equal(r.length, 6);   // 2 aspek x 3 siswa
  const kesiapan = r.filter((x) => x[kolom.Aspek] === 'Kesiapan');
  assert.deepEqual(kesiapan.map((x) => x[kolom['Status/Predikat']]), ['Terlihat Jelas', 'Terlihat', '']);
  assert.equal(kesiapan[0][kolom.Indikator], 'Menyalakan');
  assert.deepEqual(r.filter((x) => x[kolom.Aspek] === 'Kerapian').map((x) => x[kolom['Status/Predikat']]), ['', '', 'Belum Terlihat']);
});
uji('rubrik beraspek: label predikat bila ada, kode bila tidak', () => {
  const r = baris.filter((x) => x[kolom.Instrumen] === 'Rubrik' && x[kolom.Aspek] === 'Isi');
  assert.deepEqual(r.map((x) => x[kolom['Status/Predikat']]), ['Sangat Berkembang', 'MB', '']);
});
uji('bentuk yang dulu keluar KOSONG kini terbaca: catatan anekdot, checklist, tes bergradasi, tes lisan; pembaca SAMA dengan layar', () => {
  const lab = (id) => baris.filter((x) => x[kolom.Penilaian] === L.labelPenilaian(asmts.find((a) => a.id === id), tpById)).map((x) => x[kolom['Status/Predikat']]);
  assert.deepEqual(lab('a5'), ['Tercatat', 'Tercatat', 'Tercatat']);        // catatan anekdot (per siswa dan per kejadian)
  assert.deepEqual(lab('a6'), ['Tercapai', 'Tercapai', '']);                // checklist
  assert.deepEqual(lab('a7'), ['', 'Belum', 'Paham']);                       // deskriptor tes (urutan roster: s1 kosong, s2 Belum, s3 Paham)
  assert.deepEqual(lab('a8'), ['SB', 'SB', '']);                              // tes lisan: predikat tertinggi menang
  const s = src('guru/js/penilaian.js'), k = src('guru/js/konten-penilaian.js');
  assert.ok(s.includes("import { extractLabelSiswa } from './konten-penilaian.js'") && !/function extractLabelSiswa/.test(s), 'layar masih punya pembaca sendiri');
  assert.ok(src('guru/js/rekap-excel.js').includes("from './konten-penilaian.js'") && /export function extractLabelSiswa/.test(k));
});
uji('penilaian tanpa data: tetap satu baris kosong per siswa (tidak hilang dari Excel)', () => {
  const r = X.susunLembarRekap({ asmts: [asmts[8]], roster, tpById });
  assert.equal(r.length, 3); assert.ok(r.every((x) => x[kolom['Status/Predikat']] === '' && x[kolom['Nilai / Hasil']] === ''));
});
uji('jumlah baris = jumlah siswa untuk tiap penilaian tak-beraspek; tak ada duplikasi siswa dalam satu penilaian', () => {
  for (const id of ['a1', 'a2', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) {
    const nama = baris.filter((x) => x[kolom.Penilaian] === L.labelPenilaian(asmts.find((a) => a.id === id), tpById) && !x[kolom.Aspek]).map((x) => x[kolom['Nama Siswa']]);
    if (['a4'].includes(id)) continue;   // beraspek: satu aspek di data uji ini
    assert.deepEqual(nama, ['Adelia', 'Budi', 'Citra'], 'penilaian ' + id);
  }
});
uji('saringPenilaian: jenis, teknik, instrumen, TP; filter kosong tidak menyaring; sama dengan yang dipakai layar', () => {
  assert.equal(L.saringPenilaian(asmts, { jenis: 'SUMATIF' }).length, 2);
  assert.deepEqual(L.saringPenilaian(asmts, { jenis: 'SUMATIF', teknik: 'PROYEK' }).map((a) => a.id), ['a2']);
  assert.deepEqual(L.saringPenilaian(asmts, { jenis: 'SUMATIF', tp: 't8' }).map((a) => a.id), ['a2']);
  assert.deepEqual(L.saringPenilaian(asmts, { jenis: 'FORMATIF', teknik: 'OBSERVASI', instrumen: 'Catatan Anekdot' }).map((a) => a.id), ['a5']);
  assert.equal(L.saringPenilaian(asmts, {}).length, asmts.length); assert.deepEqual(L.saringPenilaian(null, { jenis: 'SUMATIF' }), []);
  const s = src('guru/js/penilaian.js');
  assert.ok(s.includes('saringPenilaian(_asmtCache, { jenis: _rcJenis') && s.includes('saringPenilaian(semua, { jenis: _rcJenis'), 'layar dan ekspor harus memakai fungsi filter yang sama');
});
uji('ekspor Rekap: hanya satu lembar data + Catatan; TIDAK ada lembar e-Rapor dan tidak memakai nilai rapor tersimpan', () => {
  const s = src('guru/js/penilaian.js');
  const ekspor = s.slice(s.indexOf('async function downloadPenilaianExcel'), s.indexOf('// ── Collapse helpers'));
  assert.ok(!/e-Rapor|susunLembarERapor|getGradeFinal/.test(ekspor), 'ekspor Rekap masih memuat lembar/nilai rapor');
  assert.ok(/'Rekap Penilaian'/.test(ekspor) && /'Catatan'/.test(ekspor));
  assert.ok(!/susunLembarERapor/.test(s), 'impor susunLembarERapor masih ada di penilaian.js');
});
uji('nama berkas Rekap menyebut cakupan; karakter terlarang diganti; susunCatatanRekap menyebut cakupan, jumlah, dan pengingat Pelaksanaan', () => {
  assert.equal(X.namaBerkasRekap({ mapel: 'Komputerisasi Akuntansi', kelas: 'XI AKL 2', jenis: 'SUMATIF', teknik: 'TES_LISAN', tpKode: 'TP7' }), 'Komputerisasi_Akuntansi_XI_AKL_2_Rekap_Sumatif_TES_LISAN_TP7.xlsx');
  assert.equal(X.namaBerkasRekap({ mapel: 'A/B:C', kelas: 'X', jenis: 'FORMATIF' }), 'A_B_C_X_Rekap_Formatif.xlsx');
  const c = X.susunCatatanRekap({ jenis: 'SUMATIF', teknik: 'TES_LISAN', tpKode: 'TP7', jumlahPenilaian: 2, jumlahSiswa: 32, waktu: 'W' });
  const teks = JSON.stringify(c);
  for (const x of ['Sumatif', 'TES LISAN', 'TP7', '"Jumlah penilaian",2', '"Jumlah siswa",32', 'hanya dapat diubah di bagian Pelaksanaan', 'Nilai rapor tidak ada di berkas ini']) assert.ok(teks.includes(x), x);
  assert.ok(JSON.stringify(X.susunCatatanRekap({ jenis: 'SUMATIF' })).includes('"Teknik","Semua"'));
});
uji('Excel Nilai Rapor: status penyimpanan jelas (aman / belum disimpan / rumus belum disimpan) dan dicatat di lembar Catatan bersama rumus, waktu, dan sifat berkas kerja', () => {
  assert.deepEqual(N.statusSimpanRapor({}), { aman: true, teks: 'Semua angka pada berkas ini sudah tersimpan.' });
  const a = N.statusSimpanRapor({ belumSimpan: 2 }); assert.equal(a.aman, false); assert.match(a.teks, /^PERHATIAN: 2 siswa belum disimpan\. Angka pada berkas ini sama dengan layar.*BUKAN yang tersimpan/);
  assert.match(N.statusSimpanRapor({ rumusBelumSimpan: true }).teks, /rumus diubah di Rekap dan belum disimpan/);
  assert.match(N.statusSimpanRapor({ belumSimpan: 1, rumusBelumSimpan: true }).teks, /1 siswa belum disimpan; rumus diubah/);
  const c = JSON.stringify(N.susunCatatanRapor({ metode: 'BOBOT', status: a, waktu: 'W' }));
  for (const x of ['Pembobotan per penilaian sumatif', '"Diunduh","W"', 'Status penyimpanan', 'PERHATIAN', 'BERKAS KERJA', 'BELUM dicocokkan']) assert.ok(c.includes(x), x);
  const ui = src('guru/js/nilai-rapor-ui.js');
  assert.ok(/statusSimpanRapor\(\{ belumSimpan, rumusBelumSimpan: adaPerubahan\(idSumatif\) \}\)/.test(ui) && /susunCatatanRapor/.test(ui) && /Excel diunduh, tetapi ada nilai yang belum disimpan/.test(ui));
});

console.log(`\nREKAP_EXCEL: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
