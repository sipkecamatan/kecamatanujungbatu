// Uji format tampilan status absensi (kecamatan/js/format.js). Menangkap cacat yang lolos dari uji server:
// server mengirim absen_kecil berisi NAMA status ("sakit"), sedangkan tampilan memeriksa kunci "sakit_pct".
//   node tests/format-status.mjs
import assert from 'node:assert/strict';
import { nilaiStatus, nilaiStatusCsv } from '../kecamatan/js/format.js';

let lulus = 0;
const uji = (nama, fn) => { fn(); console.log(`PASS FORMAT ${++lulus}: ${nama}`); };

// Bentuk persis keluaran server untuk satu sekolah: sakit dan alpa tersembunyi karena 1-4 catatan.
const kecil = { kehadiran_pct: 95, sakit_pct: null, izin_pct: 3, alpa_pct: null, absen_kecil: ['sakit', 'alpa'] };
const biasa = { kehadiran_pct: 95, sakit_pct: 2, izin_pct: 2, alpa_pct: 1, absen_kecil: [] };
const tanpaData = { kehadiran_pct: null, sakit_pct: null, izin_pct: null, alpa_pct: null, absen_kecil: [] };

uji('hitungan kecil ditulis "< 5" (bukan "—"): kunci _pct dipetakan ke nama status di absen_kecil', () => {
  assert.equal(nilaiStatus(kecil, 'sakit_pct'), '< 5');
  assert.equal(nilaiStatus(kecil, 'alpa_pct'), '< 5');
});
uji('status yang tidak tersembunyi tetap persen', () => {
  assert.equal(nilaiStatus(kecil, 'izin_pct'), '3%');
  assert.equal(nilaiStatus(kecil, 'kehadiran_pct'), '95%');
  assert.equal(nilaiStatus(biasa, 'sakit_pct'), '2%');
});
uji('nol tetap "0%" (nol bukan hitungan kecil)', () => {
  assert.equal(nilaiStatus({ alpa_pct: 0, absen_kecil: [] }, 'alpa_pct'), '0%');
});
uji('tidak tersedia (tanpa data atau cakupan rendah) ditulis "—"', () => {
  for (const k of ['kehadiran_pct', 'sakit_pct', 'izin_pct', 'alpa_pct']) assert.equal(nilaiStatus(tanpaData, k), '—');
});
uji('absen_kecil kosong, hilang, atau bukan larik tidak membuat galat', () => {
  assert.equal(nilaiStatus({ sakit_pct: 4 }, 'sakit_pct'), '4%');
  assert.equal(nilaiStatus({ sakit_pct: 4, absen_kecil: null }, 'sakit_pct'), '4%');
  assert.equal(nilaiStatus(null, 'sakit_pct'), '—');
  assert.equal(nilaiStatus(undefined, 'sakit_pct'), '—');
});
uji('CSV: angka tanpa tanda % (seragam dengan Cakupan input), "< 5" bila tersembunyi, kosong bila tidak tersedia', () => {
  assert.equal(nilaiStatusCsv(biasa, 'sakit_pct'), 2);
  assert.equal(typeof nilaiStatusCsv(biasa, 'sakit_pct'), 'number');
  assert.equal(nilaiStatusCsv(kecil, 'kehadiran_pct'), 95);
  assert.equal(nilaiStatusCsv(kecil, 'sakit_pct'), '< 5');
  assert.equal(nilaiStatusCsv(tanpaData, 'alpa_pct'), '');
  assert.equal(nilaiStatusCsv({ alpa_pct: 0, absen_kecil: [] }, 'alpa_pct'), 0);
});
uji('nilai tersembunyi tidak pernah membocorkan angka: baris dengan absen_kecil tidak menampilkan persen status itu', () => {
  const dgnAngkaTerselip = { sakit_pct: 1, absen_kecil: ['sakit'] };   // andai server keliru mengirim angka
  assert.equal(nilaiStatus(dgnAngkaTerselip, 'sakit_pct'), '< 5');
  assert.equal(nilaiStatusCsv(dgnAngkaTerselip, 'sakit_pct'), '< 5');
});

console.log(`LULUS FORMAT: ${lulus} uji`);
