/**
 * @file guru/js/rekap-excel.js
 * Susunan berkas Excel "Unduh Excel" di bagian REKAP (logika murni, tanpa DOM/jaringan/SheetJS; diuji di tests/rekap-excel.mjs).
 * Isi berkas = salinan tampilan Rekap pada saat diunduh: HANYA penilaian yang lolos filter layar (saringPenilaian), satu baris per siswa roster per penilaian
 * (per aspek untuk instrumen beraspek), siswa yang belum dinilai tetap tampil dengan sel hasil kosong. Nilai TIDAK dapat diubah di sini (hanya di Pelaksanaan).
 * Lembar "e-Rapor" tidak lagi ada di berkas ini: nilai rapor dilihat dan diunduh dari bagian Nilai Rapor (keputusan Romo 23 Okt 2026).
 */
import { labelPenilaian, tpIdsUrut, namaTeknik } from './penilaian-label.js';
import { extractLabelSiswa } from './konten-penilaian.js';

export const HEADER_REKAP = ['Tanggal', 'Jenis', 'Penilaian', 'Teknik', 'Instrumen', 'TP', 'Keterangan', 'Aspek', 'Indikator', 'Nama Siswa', 'NIS', 'Nilai / Hasil', 'Status/Predikat', 'Tindak Lanjut', 'Refleksi Guru'];

export const JENIS_EXCEL = {
    DIAGNOSTIK_NK: 'Diagnostik Non-Kognitif',
    DIAGNOSTIK_K: 'Diagnostik Kognitif',
    FORMATIF: 'Formatif',
    SUMATIF: 'Sumatif',
};

const TINGKAT_OBSERVASI = [['terlihat_jelas', 'Terlihat Jelas'], ['terlihat', 'Terlihat'], ['belum_terlihat', 'Belum Terlihat']];

/** Hasil satu aspek (instrumen beraspek) menjadi { student_id: label }. Observasi: kategori terlihat; rubrik/formatif: predikat. */
function petaAspek(aspek) {
    const peta = {};
    const observasi = TINGKAT_OBSERVASI.some(([k]) => Array.isArray(aspek?.[k]));
    if (observasi) {
        for (const [kunci, label] of TINGKAT_OBSERVASI) for (const sid of aspek[kunci] || []) peta[sid] = label;
    } else {
        for (const p of aspek?.predikat || []) for (const sid of p.siswa || []) peta[sid] = p.label || p.val;
    }
    return peta;
}

/**
 * Baris lembar "Rekap Penilaian".
 * @param {object} p
 * @param {object[]} p.asmts   penilaian yang AKAN diekspor (sudah disaring dengan saringPenilaian)
 * @param {{id:string, nama?:string, full_name?:string, nis?:string}[]} p.roster
 * @param {Object<string, Object<string, {nilai?:number, status?:string, tindak_lanjut?:string}>>} [p.hasil]  assessment_id -> student_id -> baris assessment_results
 * @param {Object<string, {kode_tp?:string, deskripsi_tp?:string}>} [p.tpById]  menurut urutan TP (urutan kunci = urutan TP)
 * @returns {Array<Array>} baris tanpa header (lebar selalu HEADER_REKAP.length)
 */
export function susunLembarRekap({ asmts, roster, hasil = {}, tpById = {} }) {
    const baris = [];
    for (const a of asmts ?? []) {
        const konten = a.konten;
        const tpStr = tpIdsUrut(a, tpById).map((id) => tpById[id]).filter(Boolean).map((tp) => tp.kode_tp + ' – ' + tp.deskripsi_tp).join('; ');
        const dasar = [a.tanggal || '', JENIS_EXCEL[a.jenis] || a.jenis || '', labelPenilaian(a, tpById), namaTeknik(a.teknik || ''), a.instrumen || '', tpStr, a.tujuan || ''];
        const refleksi = a.refleksi_guru || konten?.refleksi || '';   // kolom database refleksi_guru (konten.refleksi hanya data lama)
        const siswa = (s) => [s.nama || s.full_name || '', s.nis || ''];
        const hasilA = hasil[a.id];

        if (hasilA && Object.keys(hasilA).length) {
            // Penilaian bernilai angka (assessment_results): sumatif dan diagnostik kognitif. Siswa tanpa hasil tetap satu baris kosong.
            for (const s of roster ?? []) {
                const r = hasilA[s.id];
                baris.push([...dasar, '', '', ...siswa(s), r?.nilai ?? '', r?.status ?? '', r?.tindak_lanjut ?? '', refleksi]);
            }
        } else if (Array.isArray(konten?.aspeks) && konten.aspeks.length) {
            // Instrumen beraspek (lembar observasi, rubrik): satu baris per siswa per aspek; yang belum dinilai pada aspek itu kosong.
            konten.aspeks.forEach((aspek, i) => {
                const peta = petaAspek(aspek);
                for (const s of roster ?? []) baris.push([...dasar, aspek.nama || ('Aspek ' + (i + 1)), aspek.indikator || '', ...siswa(s), '', peta[s.id] ?? '', '', refleksi]);
            });
        } else {
            // Bentuk lain (catatan anekdot, checklist, tes bergradasi, tes lisan): label per siswa dibaca oleh pembaca yang SAMA dengan layar Rekap.
            const peta = extractLabelSiswa(konten, a.teknik, a.instrumen);
            for (const s of roster ?? []) baris.push([...dasar, '', '', ...siswa(s), '', peta[s.id] ?? '', '', refleksi]);
        }
    }
    return baris;
}

/** Lembar "Catatan": cakupan berkas, waktu unduh, dan pengingat bahwa nilai hanya diubah di Pelaksanaan. */
export function susunCatatanRekap({ jenis, teknik = '', instrumen = '', tpKode = '', jumlahPenilaian = 0, jumlahSiswa = 0, waktu = '' }) {
    return [
        ['Catatan'],
        ['Jenis penilaian', JENIS_EXCEL[jenis] || jenis || '-'],
        ['Teknik', teknik ? namaTeknik(teknik) : 'Semua'],
        ['Instrumen', instrumen || 'Semua'],
        ['TP', tpKode || 'Semua'],
        ['Jumlah penilaian', jumlahPenilaian],
        ['Jumlah siswa', jumlahSiswa],
        ['Diunduh', waktu],
        ['Berkas ini salinan tampilan Rekap pada saat diunduh dan memuat HANYA penilaian yang sedang tampil (sesuai filter). Nilai hanya dapat diubah di bagian Pelaksanaan.'],
        ['Nilai rapor tidak ada di berkas ini; lihat dan unduh dari bagian Nilai Rapor.'],
    ];
}

/** Nama berkas yang menyebut cakupan (jenis dan filter) supaya jelas isinya; karakter di luar huruf/angka diganti garis bawah. */
export function namaBerkasRekap({ mapel = '', kelas = '', jenis = '', teknik = '', tpKode = '', instrumen = '' }) {
    const bagian = [mapel, kelas, 'Rekap', JENIS_EXCEL[jenis] || jenis];
    if (teknik) bagian.push(namaTeknik(teknik));
    if (instrumen) bagian.push(instrumen);
    if (tpKode) bagian.push(tpKode);
    return bagian.filter(Boolean).join('_').replace(/[^a-zA-Z0-9_\-.]/g, '_').replace(/_+/g, '_') + '.xlsx';
}
