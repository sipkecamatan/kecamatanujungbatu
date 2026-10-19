/**
 * @file guru/js/penilaian-label.js
 * Satu pintu untuk IDENTITAS dan STATUS penilaian (logika murni; diuji di tests/penilaian-label.mjs).
 * Semua layar (Pelaksanaan, Rekap, bobot Nilai Rapor, ekspor) memakai fungsi di sini, bukan merakit label sendiri.
 */

const tglPendek = (t) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t ?? '')); return m ? `${m[3]}/${m[2]}` : ''; };
const rapi = (s) => String(s ?? '').replace(/_/g, ' ').trim();

/** Label yang dibaca guru: judul bila ada; selain itu kode TP + tanggal + teknik/instrumen (bedakan dua penilaian yang mirip). */
export function labelPenilaian(a, tpById = {}) {
    const judul = String(a?.judul ?? '').trim();
    if (judul) return judul;
    const tp = a?.learning_objective_id ? tpById[a.learning_objective_id] : null;
    const bagian = [tp?.kode_tp || (a?.learning_objective_id ? 'TP' : 'Tanpa TP'), tglPendek(a?.tanggal), [rapi(a?.teknik), rapi(a?.instrumen)].filter(Boolean).join(' ')];
    return bagian.filter(Boolean).join(' · ');
}

/** Urutan tunggal: kronologis (tanggal, lalu waktu dibuat). Tanpa tanggal ditaruh paling akhir. */
export function urutkanPenilaian(daftar) {
    const kunci = (a) => [a?.tanggal || '9999-12-31', a?.created_at || ''];
    return [...(daftar ?? [])].sort((x, y) => {
        const [tx, cx] = kunci(x), [ty, cy] = kunci(y);
        return tx < ty ? -1 : tx > ty ? 1 : cx < cy ? -1 : cx > cy ? 1 : 0;
    });
}

/**
 * Status nilai rapor satu siswa terhadap hasil hitung terbaru.
 *  BARU    : belum ada nilai tersimpan
 *  MANUAL  : guru sengaja menetapkan angka di luar saran saat menyimpan (bukan tertinggal)
 *  SINKRON : saran terbaru sama dengan saran saat disimpan
 *  BASI    : penilaian berubah sesudah disimpan; saran terbaru berbeda dari saat disimpan
 *  TAK_DIKETAHUI : data lama tanpa catatan saran
 */
export function statusNilaiRapor({ nilaiTersimpan, saranSaatSimpan, saranSekarang }) {
    const ada = nilaiTersimpan !== null && nilaiTersimpan !== undefined && nilaiTersimpan !== '';
    if (!ada) return 'BARU';
    const lama = saranSaatSimpan === null || saranSaatSimpan === undefined ? null : Number(saranSaatSimpan);
    if (lama === null) return 'TAK_DIKETAHUI';
    const kini = saranSekarang === null || saranSekarang === undefined ? null : Number(saranSekarang);
    if (kini === null) return 'TAK_DIKETAHUI';
    if (Math.round(kini) !== Math.round(lama)) return 'BASI';
    return Math.round(Number(nilaiTersimpan)) === Math.round(lama) ? 'SINKRON' : 'MANUAL';
}
