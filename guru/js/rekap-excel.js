/**
 * @file guru/js/rekap-excel.js
 * Susunan berkas Excel "Unduh Excel" di bagian REKAP (logika murni, tanpa DOM/jaringan/SheetJS; diuji di tests/rekap-excel.mjs).
 * Model PIVOT: kolom = penilaian, baris = siswa (urut nama A-Z).
 * Tiga baris header: (0) judul penilaian, (1) keterangan penilaian, (2) No/Nama/NIS + sub-kolom per penilaian.
 * Sub-kolom: Sumatif → Nilai/Predikat/Tindak Lanjut; Diagnostik Kognitif → Nilai/Predikat;
 *            instrumen beraspek → satu kolom per aspek; lainnya → Hasil.
 * Nilai TIDAK dapat diubah di sini (hanya di Pelaksanaan).
 * Lembar "e-Rapor" tidak ada di berkas ini: nilai rapor dilihat dan diunduh dari bagian Nilai Rapor (keputusan Romo 23 Okt 2026).
 */
import { labelPenilaian, tpIdsUrut, namaTeknik } from './penilaian-label.js';
import { extractLabelSiswa } from './konten-penilaian.js';

export const JENIS_EXCEL = {
    DIAGNOSTIK_NK: 'Diagnostik Non-Kognitif',
    DIAGNOSTIK_K: 'Diagnostik Kognitif',
    FORMATIF: 'Formatif',
    SUMATIF: 'Sumatif',
};

const TINGKAT_OBSERVASI = [['terlihat_jelas', 'Terlihat Jelas'], ['terlihat', 'Terlihat'], ['belum_terlihat', 'Belum Terlihat']];

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

/** Sub-kolom setiap penilaian ditentukan dari definisi penilaian (bukan dari ada/tidaknya hasil). */
function subKolomAsmt(a) {
    if (a.jenis === 'SUMATIF') return ['Nilai', 'Predikat', 'Tindak Lanjut'];
    if (a.jenis === 'DIAGNOSTIK_K') return ['Nilai', 'Predikat'];
    if (Array.isArray(a.konten?.aspeks) && a.konten.aspeks.length)
        return a.konten.aspeks.map((asp, i) => asp.nama || ('Aspek ' + (i + 1)));
    return ['Hasil'];
}

function keteranganAsmt(a, tpById) {
    const bagian = [JENIS_EXCEL[a.jenis] || a.jenis];
    if (a.teknik) bagian.push(namaTeknik(a.teknik));
    const tpStr = tpIdsUrut(a, tpById).map((id) => tpById[id]?.kode_tp).filter(Boolean).join(', ');
    if (tpStr) bagian.push(tpStr);
    if (a.tujuan) bagian.push(a.tujuan);
    return bagian.join(' · ');
}

/**
 * Lembar "Rekap Penilaian" model pivot.
 * @param {object} p
 * @param {object[]} p.asmts   penilaian yang AKAN diekspor (sudah disaring dengan saringPenilaian)
 * @param {{id:string, nama?:string, full_name?:string, nis?:string}[]} p.roster
 * @param {Object<string, Object<string, {nilai?:number, status?:string, tindak_lanjut?:string}>>} [p.hasil]
 * @param {Object<string, {kode_tp?:string, deskripsi_tp?:string}>} [p.tpById]
 * @returns {{ rows: Array<Array>, merges: Array<{s:{r,c},e:{r,c}}> }}
 */
export function susunLembarRekap({ asmts, roster, hasil = {}, tpById = {} }) {
    const daftarAsmt = asmts ?? [];
    const rosterUrut = [...(roster ?? [])].sort((a, b) => (a.nama || a.full_name || '').localeCompare(b.nama || b.full_name || '', 'id'));
    const subKolomList = daftarAsmt.map((a) => subKolomAsmt(a));

    // Tiga baris header
    const row0 = ['', '', ''];   // judul penilaian
    const row1 = ['', '', ''];   // keterangan penilaian
    const row2 = ['No', 'Nama', 'NIS'];   // sub-kolom

    for (let i = 0; i < daftarAsmt.length; i++) {
        const subs = subKolomList[i];
        row0.push(labelPenilaian(daftarAsmt[i], tpById), ...Array(subs.length - 1).fill(''));
        row1.push(keteranganAsmt(daftarAsmt[i], tpById), ...Array(subs.length - 1).fill(''));
        row2.push(...subs);
    }

    // Merges
    const merges = [];
    // No, Nama, NIS: merge 3 baris
    for (let c = 0; c < 3; c++) merges.push({ s: { r: 0, c }, e: { r: 2, c } });
    let col = 3;
    for (const subs of subKolomList) {
        if (subs.length > 1) {
            merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + subs.length - 1 } });
            merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + subs.length - 1 } });
        }
        col += subs.length;
    }

    // Baris data siswa
    const rows = [row0, row1, row2];
    rosterUrut.forEach((s, idx) => {
        const baris = [idx + 1, s.nama || s.full_name || '', s.nis || ''];
        for (let i = 0; i < daftarAsmt.length; i++) {
            const a = daftarAsmt[i];
            const hasilA = hasil[a.id];
            if (a.jenis === 'SUMATIF') {
                const r = hasilA?.[s.id];
                baris.push(r?.nilai ?? '', r?.status ?? '', r?.tindak_lanjut ?? '');
            } else if (a.jenis === 'DIAGNOSTIK_K') {
                const r = hasilA?.[s.id];
                baris.push(r?.nilai ?? '', r?.status ?? '');
            } else if (Array.isArray(a.konten?.aspeks) && a.konten.aspeks.length) {
                for (const aspek of a.konten.aspeks) baris.push(petaAspek(aspek)[s.id] ?? '');
            } else {
                baris.push(extractLabelSiswa(a.konten, a.teknik, a.instrumen)[s.id] ?? '');
            }
        }
        rows.push(baris);
    });

    return { rows, merges };
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
