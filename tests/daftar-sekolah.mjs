import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../kecamatan/js/daftar.js', import.meta.url), 'utf8');
const { saringSekolah, urutkanSekolah, potong } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);

let lulus = 0;
function uji(nama, fn) {
  fn();
  console.log(`PASS DAFTAR ${++lulus}: ${nama}`);
}

const sekolah = (nama, jenjang = 'SMA', extra = {}) => ({ nama, jenjang, ...extra });

uji('pencarian mengabaikan huruf besar/kecil dan spasi ujung', () => {
  const hasil = saringSekolah([sekolah('  SMA Harapan  '), sekolah('SMA Negeri')], { kata: '  sma harapan  ' });
  assert.deepEqual(hasil.map((s) => s.nama), ['  SMA Harapan  ']);
});

uji('pencarian mencocokkan substring', () => {
  const hasil = saringSekolah([sekolah('SD Nusantara'), sekolah('SMA Nusantara')], { kata: 'nusant' });
  assert.equal(hasil.length, 2);
});

uji('kata kosong mengembalikan semua sekolah yang sesuai jenjang', () => {
  const daftar = [sekolah('Satu', 'SD'), sekolah('Dua', 'SMA')];
  assert.deepEqual(saringSekolah(daftar, { jenjang: 'SD', kata: '   ' }), [daftar[0]]);
  assert.deepEqual(saringSekolah(daftar, { kata: '' }), daftar);
});

const metrik = [
  sekolah('zULU', 'SMA', { siswa_aktif: 10, kehadiran_pct: 80, terlambat: 2 }),
  sekolah('Alpha', 'SMA', { siswa_aktif: 30, kehadiran_pct: null, terlambat: 7 }),
  sekolah('beta', 'SMA', { siswa_aktif: null, kehadiran_pct: 95, terlambat: null }),
  sekolah('Beta', 'SMA', { siswa_aktif: 30, kehadiran_pct: 95, terlambat: 7 }),
  sekolah('Gamma', 'SMA', { siswa_aktif: 5, kehadiran_pct: 80, terlambat: 1 }),
];
const nama = (kunci) => urutkanSekolah(metrik, kunci).map((s) => s.nama);

uji('pengurutan nama A-Z lokal Indonesia tidak membedakan huruf besar/kecil', () => {
  assert.deepEqual(nama('nama-asc'), ['Alpha', 'beta', 'Beta', 'Gamma', 'zULU']);
});

uji('nama null juga selalu berada di akhir', () => {
  const daftar = [sekolah(null), sekolah('Alpha')];
  assert.deepEqual(urutkanSekolah(daftar, 'nama-asc').map((s) => s.nama), ['Alpha', null]);
  assert.deepEqual(urutkanSekolah(daftar, 'nama-desc').map((s) => s.nama), ['Alpha', null]);
});

uji('pengurutan nama Z-A', () => {
  assert.deepEqual(nama('nama-desc'), ['zULU', 'Gamma', 'beta', 'Beta', 'Alpha']);
});

uji('pengurutan siswa aktif terbanyak menaruh null di akhir', () => {
  assert.deepEqual(nama('siswa-aktif'), ['Alpha', 'Beta', 'zULU', 'Gamma', 'beta']);
});

uji('pengurutan kehadiran tertinggi menaruh null di akhir', () => {
  assert.deepEqual(nama('kehadiran-tinggi'), ['beta', 'Beta', 'zULU', 'Gamma', 'Alpha']);
});

uji('pengurutan kehadiran terendah menaruh null di akhir', () => {
  assert.deepEqual(nama('kehadiran-rendah'), ['zULU', 'Gamma', 'beta', 'Beta', 'Alpha']);
});

uji('pengurutan terlambat terbanyak menaruh null di akhir', () => {
  assert.deepEqual(nama('terlambat'), ['Alpha', 'Beta', 'zULU', 'Gamma', 'beta']);
});

uji('pengurutan stabil mempertahankan urutan setara', () => {
  const daftar = [sekolah('Pertama', 'SMA', { siswa_aktif: 7 }), sekolah('Kedua', 'SMA', { siswa_aktif: 7 })];
  assert.deepEqual(urutkanSekolah(daftar, 'siswa-aktif').map((s) => s.nama), ['Pertama', 'Kedua']);
});

uji('potong hanya mengambil n pertama dan tidak mengubah input', () => {
  const daftar = [1, 2, 3];
  assert.deepEqual(potong(daftar, 2), [1, 2]);
  assert.deepEqual(potong(daftar, -1), []);
  assert.deepEqual(daftar, [1, 2, 3]);
});

uji('fungsi tidak mengubah array masukan', () => {
  const daftar = [sekolah('B'), sekolah('A')];
  const salinan = structuredClone(daftar);
  saringSekolah(daftar, { kata: 'a' });
  urutkanSekolah(daftar, 'nama-asc');
  assert.deepEqual(daftar, salinan);
});

uji('fungsi tidak membaca kolom wilayah', () => {
  const akses = new Set(['nama', 'jenjang', 'siswa_aktif', 'kehadiran_pct', 'terlambat']);
  const daftar = [new Proxy({ nama: 'A', jenjang: 'SMA', siswa_aktif: 1, kehadiran_pct: 90, terlambat: 0,
    region_id: 'dilarang', wilayah: 'dilarang', kelompok: 'dilarang' }, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !akses.has(property)) throw new Error(`Kolom tidak boleh dibaca: ${property}`);
      return Reflect.get(target, property, receiver);
    },
  })];
  assert.equal(saringSekolah(daftar, { kata: 'a' }).length, 1);
  assert.equal(urutkanSekolah(daftar, 'siswa-aktif').length, 1);
});

console.log(`LULUS DAFTAR: ${lulus} uji`);
