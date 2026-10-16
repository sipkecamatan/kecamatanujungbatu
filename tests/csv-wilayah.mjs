// Uji isi CSV unduhan dasbor wilayah. Mengeksekusi KODE ASLI bangunCsv (diambil dari teks kecamatan/js/app.js, bukan salinan)
// dengan modul murni asli (daftar.js, format.js) dan data sintetis berisi kasus sulit.
//   node tests/csv-wilayah.mjs
//   KONTROL_NEGATIF=1 node tests/csv-wilayah.mjs   -> penjaga rumus dicabut dari kode; uji HARUS gagal
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
let bagianCsv = potong('// ── Unduh CSV', 'function unduhCsv()');
const namaWilayahSrc = src.match(/^const namaWilayah = .*$/m)[0];
const statusSrc = potong('const STATUS = {', '};\n') + '};';
if (process.env.KONTROL_NEGATIF) {
  const sebelum = bagianCsv;
  bagianCsv = bagianCsv.replace("if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s;", '');
  if (bagianCsv === sebelum) throw new Error('kontrol negatif: penjaga rumus tidak ditemukan untuk dicabut');
}
const ctx = vm.createContext({ urutkanSekolah, nilaiStatusCsv, Date, String, Array, Object, Number });
vm.runInContext(`const statusCsv = nilaiStatusCsv; ${namaWilayahSrc}\n${statusSrc}\n${bagianCsv}\nglobalThis.bangunCsv = bangunCsv;`, ctx);
const bangunCsv = ctx.bangunCsv;

// Pembaca CSV minimal (RFC 4180): kutip ganda, koma di dalam kutip, baris baru di dalam kutip.
function parse(teks) {
  const baris = []; let sel = '', row = [], q = false;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (q) { if (c === '"') { if (teks[i + 1] === '"') { sel += '"'; i++; } else q = false; } else sel += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(sel); sel = ''; }
    else if (c === '\r' && teks[i + 1] === '\n') { row.push(sel); baris.push(row); row = []; sel = ''; i++; }
    else sel += c;
  }
  if (sel !== '' || row.length) { row.push(sel); baris.push(row); }
  return baris;
}
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
const csv = bangunCsv(dasar);
const R = parse(csv.replace(/^﻿/, ''));

test('diawali BOM UTF-8 dan semua baris berakhiran CRLF (terbaca benar di Excel)', () => {
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.replace(/\r\n/g, '').includes('\n'), false, 'ada LF telanjang di luar sel berkutip');
});
test('bagian metadata: judul, wilayah hanya nama kecamatan, periode lengkap dengan jumlah hari', () => {
  assert.deepEqual(R[0], ['SIP - Dashboard Wilayah']);
  assert.deepEqual(R[1], ['Wilayah', 'Kecamatan Ujung Batu']);
  assert.deepEqual(R[2], ['Periode', '2026-09-17 s.d. 2026-10-16 (30 hari)']);
  assert.equal(R[3][0], 'Diunduh');
  assert.ok(R[4][1].includes('Tidak memuat nama atau identitas siswa') && R[4][1].includes('80%'));
});
test('baris TOTAL: angka tanpa tanda %, urutan kolom sesuai judul', () => {
  const i = bagian(R, 'TOTAL');
  assert.deepEqual(R[i + 1], ['Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Hadir (%)', 'Sakit (%)', 'Izin (%)', 'Alpa (%)', 'Terlambat', 'Izin keluar']);
  assert.deepEqual(R[i + 2], ['970', '794', '89', '95', '2', '1', '1', '580', '163']);
});
test('subtotal jenjang: urutan kolom dan nilai benar', () => {
  const i = bagian(R, 'SUBTOTAL JENJANG');
  assert.equal(R[i + 1].length, 11);
  assert.deepEqual(R[i + 2], ['SMA', '2', '520', '430', '88', '95', '2', '1', '1', '281', '82']);
});
test('daftar sekolah diurutkan A-Z dan setiap baris punya 12 kolom sama dengan judulnya', () => {
  const i = bagian(R, 'SEKOLAH');
  assert.equal(R[i + 1].length, 12);
  assert.deepEqual(R[i + 2], ['SMA Uji 1', 'SMA', '208', '172', '88', '95', '2', '2', '1', '98', '25', 'Memadai']);
  assert.deepEqual(R[i + 3], ['SMP Uji 1', 'SMP', '180', '144', '91', '94', '3', '2', '1', '118', '24', 'Memadai']);
});
test('hitungan kecil: status 1-4 ditulis "< 5", piket tersembunyi ditulis "< 5", persen lain tetap angka', () => {
  const o = structuredClone(dasar);
  o.total.sakit_pct = null; o.total.absen_kecil = ['sakit']; o.total.terlambat = null;
  o.sekolah[0].alpa_pct = null; o.sekolah[0].absen_kecil = ['alpa']; o.sekolah[0].izin_keluar = null;
  const r = parse(bangunCsv(o).replace(/^﻿/, ''));
  const t = r[bagian(r, 'TOTAL') + 2];
  assert.equal(t[4], '< 5'); assert.equal(t[7], '< 5'); assert.equal(t[3], '95'); assert.equal(t[8], '163');
  const s = r[bagian(r, 'SEKOLAH') + 3];   // SMP Uji 1 (urutan A-Z, kedua)
  assert.equal(s[8], '< 5'); assert.equal(s[10], '< 5'); assert.equal(s[7], '2');
});
test('nilai tidak tersedia (cakupan di bawah ambang / tanpa jadwal) menjadi sel KOSONG, bukan "0" atau "null"', () => {
  const o = structuredClone(dasar);
  o.sekolah[0] = { nama: 'SMK Kosong', jenjang: 'SMK', siswa_aktif: 0, orang_tua_aktif: 0, cakupan_pct: null, kehadiran_pct: null, sakit_pct: null, izin_pct: null, alpa_pct: null, absen_kecil: [], status: 'TIDAK_ADA_JADWAL', terlambat: 0, izin_keluar: 0 };
  const r = parse(bangunCsv(o).replace(/^﻿/, ''));
  const s = r.find((x) => x[0] === 'SMK Kosong');
  assert.deepEqual(s, ['SMK Kosong', 'SMK', '0', '0', '', '', '', '', '', '0', '0', 'Tidak ada jadwal']);
  assert.ok(!bangunCsv(o).includes('null') && !bangunCsv(o).includes('undefined') && !bangunCsv(o).includes('NaN'));
});
test('status data diterjemahkan ke label: Data belum memadai / Belum ada data', () => {
  const o = structuredClone(dasar);
  o.sekolah[0].status = 'DATA_BELUM_MEMADAI'; o.sekolah[1].status = 'BELUM_ADA_DATA';
  const r = parse(bangunCsv(o).replace(/^﻿/, ''));
  const i = bagian(r, 'SEKOLAH');
  assert.deepEqual([r[i + 2][11], r[i + 3][11]], ['Belum ada data', 'Data belum memadai']);
});
test('total disembunyikan (< 3 sekolah) dan tanpa jenjang: pesan penjelas, bukan baris angka kosong', () => {
  const o = structuredClone(dasar); o.total = null; o.per_jenjang = [];
  const r = parse(bangunCsv(o).replace(/^﻿/, ''));
  assert.deepEqual(r[bagian(r, 'TOTAL') + 1], ['Tidak ditampilkan: kurang dari 3 sekolah membagikan data']);
  assert.deepEqual(r[bagian(r, 'SUBTOTAL JENJANG') + 1], ['Tidak ditampilkan: tidak ada jenjang dengan minimal 2 sekolah yang membagikan data']);
});
test('pelolosan sel: koma, tanda kutip, dan baris baru pada nama sekolah kembali utuh setelah dibaca', () => {
  const o = structuredClone(dasar);
  o.sekolah[0].nama = 'SMA "Unggul", Cabang;\nSatu';
  const r = parse(bangunCsv(o).replace(/^﻿/, ''));
  assert.ok(r.some((x) => x[0] === 'SMA "Unggul", Cabang;\nSatu' && x.length === 12));
});
test('keamanan: sel diawali = + - @ tidak dibaca sebagai rumus (diberi apostrof di depan)', () => {
  const o = structuredClone(dasar);
  const nama = ['=HYPERLINK("http://x","klik")', '+cmd|calc', '-2+3', '@SUM(A1)'];
  o.sekolah = nama.map((x, k) => ({ ...dasar.sekolah[0], nama: x, school_id: 'x' + k }));
  const r = parse(bangunCsv(o).replace(/^﻿/, ''));
  const i = bagian(r, 'SEKOLAH');
  const isi = r.slice(i + 2).map((x) => x[0]);
  for (const x of isi) assert.ok(/^'[=+\-@]/.test(x), 'sel berbahaya tidak dinetralkan: ' + x);
});
test('tidak ada kolom identitas siswa: judul kolom hanya agregat', () => {
  const semuaJudul = csv.split('\r\n').filter((l) => /Siswa aktif|Sekolah,Jenjang/.test(l)).join(' ');
  assert.ok(!/nis|nama siswa|full_name|student_id/i.test(semuaJudul.replace(/Siswa aktif/g, '')));
  assert.ok(!/student_id|full_name|nis\b/i.test(csv));
});
console.log(`\nCSV_WILAYAH: ${n} lulus`);
