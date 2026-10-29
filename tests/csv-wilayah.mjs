// Uji isi baris Excel unduhan dasbor wilayah. Mengeksekusi KODE ASLI bangunBaris (diambil dari teks kecamatan/js/app.js, bukan salinan)
// dengan modul murni asli (daftar.js, format.js) dan data sintetis berisi kasus sulit.
//   node tests/csv-wilayah.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { urutkanSekolah } from '../kecamatan/js/daftar.js';
import { nilaiStatusCsv } from '../kecamatan/js/format.js';

const src = readFileSync(new URL('../kecamatan/js/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const potong = (dari, sampai) => {
  const i = src.indexOf(dari), j = src.indexOf(sampai, i);
  if (i < 0 || j < 0) throw new Error('penanda tidak ditemukan: ' + dari);
  return src.slice(i, j);
};
const bagianXl = potong('const piketXl =', 'async function unduhExcel()');
const namaWilayahSrc = src.match(/^const namaWilayah = .*$/m)[0];
const statusSrc = potong('const STATUS = {', '};\n') + '};';

const ctx = vm.createContext({ urutkanSekolah, nilaiStatusCsv, Date, String, Array, Object, Number });
vm.runInContext(`const statusCsv = nilaiStatusCsv; ${namaWilayahSrc}\n${statusSrc}\n${bagianXl}\nglobalThis.bangunBaris = bangunBaris;`, ctx);
const bangunBaris = ctx.bangunBaris;

// Array dari VM context berbeda realm — pakai JSON untuk perbandingan struktur
const eq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
let n = 0;
const test = (nama, fn) => { fn(); console.log(`PASS ${++n}: ${nama}`); };
const bagian = (rows, judul) => { const i = rows.findIndex((r) => r[0] === judul); return i < 0 ? null : i; };

const dasar = {
  wilayah: 'Kecamatan Ujung Batu, Kabupaten Rokan Hulu', dari: '2026-09-17', sampai: '2026-10-16', jendela_hari: 30, ambang_cakupan_pct: 80, ambang_piket: 5,
  total: { siswa_aktif: 970, orang_tua_aktif: 794, cakupan_pct: 89, kehadiran_pct: 95, sakit_pct: 2, izin_pct: 1, alpa_pct: 1, absen_kecil: [], terlambat: 580, izin_keluar: 163 },
  per_jenjang: [{ jenjang: 'SMA', jumlah_sekolah: 2, siswa_aktif: 520, orang_tua_aktif: 430, cakupan_pct: 88, kehadiran_pct: 95, sakit_pct: 2, izin_pct: 1, alpa_pct: 1, absen_kecil: [], terlambat: 281, izin_keluar: 82 }],
  sekolah: [
    { nama: 'SMP Uji 1', jenjang: 'SMP', siswa_aktif: 180, orang_tua_aktif: 144, cakupan_pct: 91, kehadiran_pct: 94, sakit_pct: 3, izin_pct: 2, alpa_pct: 1, absen_kecil: [], status: 'MEMADAI', terlambat: 118, izin_keluar: 24 },
    { nama: 'SMA Uji 1', jenjang: 'SMA', siswa_aktif: 208, orang_tua_aktif: 172, cakupan_pct: 88, kehadiran_pct: 95, sakit_pct: 2, izin_pct: 2, alpa_pct: 1, absen_kecil: [], status: 'MEMADAI', terlambat: 98, izin_keluar: 25 },
  ],
};
const R = bangunBaris(dasar);

test('metadata: judul, wilayah hanya nama kecamatan, periode data', () => {
  eq(R[0], ['SIP - Dashboard Wilayah']);
  eq(R[1], ['Wilayah', 'Kecamatan Ujung Batu']);
  eq(R[2], ['Periode data', '2026-09-17 s.d. 2026-10-16 (30 hari)']);
  assert.equal(R[3][0], 'Diunduh');
  assert.ok(R[4][1].includes('Tidak memuat nama atau identitas siswa') && R[4][1].includes('80%'));
});
test('baris TOTAL: angka asli (bukan string), urutan kolom sesuai judul', () => {
  const i = bagian(R, 'TOTAL');
  eq(R[i + 1], ['Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Hadir (%)', 'Sakit (%)', 'Izin (%)', 'Alpa (%)', 'Terlambat', 'Izin keluar']);
  eq(R[i + 2], [970, 794, 89, 95, 2, 1, 1, 580, 163]);
});
test('subtotal jenjang: urutan kolom dan nilai benar', () => {
  const i = bagian(R, 'SUBTOTAL JENJANG');
  assert.equal(R[i + 1].length, 11);
  eq(R[i + 2], ['SMA', 2, 520, 430, 88, 95, 2, 1, 1, 281, 82]);
});
test('daftar sekolah diurutkan A-Z dan setiap baris punya 12 kolom sama dengan judulnya', () => {
  const i = bagian(R, 'SEKOLAH');
  assert.equal(R[i + 1].length, 12);
  eq(R[i + 2], ['SMA Uji 1', 'SMA', 208, 172, 88, 95, 2, 2, 1, 98, 25, 'Memadai']);
  eq(R[i + 3], ['SMP Uji 1', 'SMP', 180, 144, 91, 94, 3, 2, 1, 118, 24, 'Memadai']);
});
test('hitungan kecil: status null ditulis "< 5", persen null menjadi string kosong', () => {
  const o = structuredClone(dasar);
  o.total.sakit_pct = null; o.total.terlambat = null;
  o.sekolah[0].alpa_pct = null; o.sekolah[0].izin_keluar = null;
  const r = bangunBaris(o);
  const t = r[bagian(r, 'TOTAL') + 2];
  assert.equal(t[4], '');       // sakit_pct null → kosong
  assert.equal(t[7], '< 5');   // terlambat null → < 5
  assert.equal(t[3], 95);      // hadir_pct tetap angka
  assert.equal(t[8], 163);     // izin_keluar tetap angka
  const s = r[bagian(r, 'SEKOLAH') + 3];  // SMP Uji 1 (urutan A-Z, kedua)
  assert.equal(s[8], '');      // alpa_pct null → kosong
  assert.equal(s[10], '< 5'); // izin_keluar null → < 5
});
test('nilai tidak tersedia (tanpa jadwal) menjadi sel kosong, bukan 0 atau null', () => {
  const o = structuredClone(dasar);
  o.sekolah[0] = { nama: 'SMK Kosong', jenjang: 'SMK', siswa_aktif: 0, orang_tua_aktif: 0, cakupan_pct: null, kehadiran_pct: null, sakit_pct: null, izin_pct: null, alpa_pct: null, absen_kecil: [], status: 'TIDAK_ADA_JADWAL', terlambat: 0, izin_keluar: 0 };
  const r = bangunBaris(o);
  const s = r.find((x) => x[0] === 'SMK Kosong');
  eq(s, ['SMK Kosong', 'SMK', 0, 0, '', '', '', '', '', 0, 0, 'Tidak ada jadwal']);
  const str = JSON.stringify(r);
  assert.ok(!str.includes('"null"') && !str.includes('"undefined"') && !str.includes('"NaN"'));
});
test('status data diterjemahkan ke label: Data belum memadai / Belum ada data', () => {
  const o = structuredClone(dasar);
  o.sekolah[0].status = 'DATA_BELUM_MEMADAI'; o.sekolah[1].status = 'BELUM_ADA_DATA';
  const r = bangunBaris(o);
  const i = bagian(r, 'SEKOLAH');
  eq([r[i + 2][11], r[i + 3][11]], ['Belum ada data', 'Data belum memadai']);
});
test('total disembunyikan (< 3 sekolah) dan tanpa jenjang: pesan penjelas, bukan baris angka kosong', () => {
  const o = structuredClone(dasar); o.total = null; o.per_jenjang = [];
  const r = bangunBaris(o);
  eq(r[bagian(r, 'TOTAL') + 1], ['Tidak ditampilkan: kurang dari 3 sekolah membagikan data']);
  eq(r[bagian(r, 'SUBTOTAL JENJANG') + 1], ['Tidak ditampilkan: tidak ada jenjang dengan minimal 2 sekolah yang membagikan data']);
});
test('tidak ada kolom identitas siswa: judul kolom hanya agregat', () => {
  const judul = R.filter((r) => /Siswa aktif|Sekolah/.test(r[0] ?? '')).map((r) => r.join(' ')).join(' ');
  assert.ok(!/nis|nama siswa|full_name|student_id/i.test(judul.replace(/Siswa aktif/g, '')));
});
console.log(`\nXL_WILAYAH: ${n} lulus`);
