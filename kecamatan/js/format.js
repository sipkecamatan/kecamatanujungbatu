// Format tampilan status absensi (Hadir, Sakit, Izin, Alpa) untuk dasbor wilayah. Logika murni: tanpa DOM, tanpa jaringan.
//
// Server (fn_region_overview_range) mengirim persentase per status (`sakit_pct`, `izin_pct`, `alpa_pct`; hadir = `kehadiran_pct`)
// dan `absen_kecil`: daftar NAMA status (tanpa akhiran _pct, mis. ["sakit","alpa"]) yang nilainya disembunyikan karena jumlah
// catatannya 1-4. Nilai NULL tanpa penanda berarti "tidak tersedia" (cakupan input di bawah ambang atau tidak ada data).

const pct = (v) => (v == null ? '—' : `${v}%`);

/** Teks tampilan: "< 5" bila disembunyikan karena hitungan kecil; "—" bila tidak tersedia; selain itu "N%". */
export function nilaiStatus(row, key) {
  const nama = String(key).replace(/_pct$/, '');
  const kecil = Array.isArray(row?.absen_kecil) && row.absen_kecil.includes(nama);
  return kecil ? '< 5' : pct(row?.[key]);
}

/** Nilai CSV: angka (tanpa tanda %) agar seragam dengan kolom "Cakupan input (%)"; "< 5" bila disembunyikan; kosong bila tidak tersedia. */
export function nilaiStatusCsv(row, key) {
  const teks = nilaiStatus(row, key);
  if (teks === '—') return '';
  if (teks === '< 5') return teks;
  return row[key];
}
