const NAMA = 'nama-asc';

function teksNama(sekolah) {
  return String(sekolah.nama ?? '');
}

function teksCari(value) {
  return String(value ?? '').trim().toLocaleLowerCase('id-ID');
}

export function saringSekolah(daftar, { jenjang = 'SEMUA', kata = '' } = {}) {
  const needle = teksCari(kata);
  return daftar.filter((sekolah) => {
    const cocokJenjang = jenjang === 'SEMUA' || (sekolah.jenjang || 'TIDAK_DIKETAHUI') === jenjang;
    const cocokNama = teksCari(teksNama(sekolah)).includes(needle);
    return cocokJenjang && cocokNama;
  });
}

function bandingkanNama(a, b, arah = 1) {
  const aKosong = a.nama == null;
  const bKosong = b.nama == null;
  if (aKosong || bKosong) {
    if (aKosong && bKosong) return 0;
    return aKosong ? 1 : -1;
  }
  return teksNama(a).localeCompare(teksNama(b), 'id', { sensitivity: 'base' }) * arah;
}

function nilaiUrut(sekolah, kunci) {
  if (kunci === 'siswa-aktif') return sekolah.siswa_aktif;
  if (kunci === 'kehadiran-tinggi' || kunci === 'kehadiran-rendah') return sekolah.kehadiran_pct;
  if (kunci === 'terlambat') return sekolah.terlambat;
  return null;
}

function bandingkanNilai(a, b, arah) {
  const aKosong = a == null;
  const bKosong = b == null;
  if (aKosong || bKosong) {
    if (aKosong && bKosong) return 0;
    return aKosong ? 1 : -1;
  }
  if (a === b) return 0;
  return (a < b ? -1 : 1) * arah;
}

export function urutkanSekolah(daftar, kunci = NAMA) {
  return daftar.map((sekolah, index) => ({ sekolah, index })).sort((a, b) => {
    let hasil;
    if (kunci === NAMA || kunci === 'nama-desc') {
      hasil = bandingkanNama(a.sekolah, b.sekolah, kunci === 'nama-desc' ? -1 : 1);
    } else {
      hasil = bandingkanNilai(
        nilaiUrut(a.sekolah, kunci),
        nilaiUrut(b.sekolah, kunci),
        kunci === 'kehadiran-rendah' ? 1 : -1,
      );
    }
    return hasil || a.index - b.index;
  }).map(({ sekolah }) => sekolah);
}

export function potong(daftar, n) {
  return daftar.slice(0, Math.max(0, n));
}
