/**
 * @file guru/js/nilai-rapor.js
 * Logika murni nilai rapor per mata pelajaran (tanpa DOM, tanpa jaringan; diuji di tests/nilai-rapor-hitung.mjs).
 *
 * Mengikuti dokumen resmi (dibaca 17 Okt 2026):
 *  - Panduan Pembelajaran dan Asesmen, Edisi Revisi 2025 (BSKAP): nilai rapor hanya dari asesmen SUMATIF; tiga opsi pengolahan:
 *    rata-rata, pembobotan, persentase TP tercapai; pembulatan normal; ketercapaian ditentukan per TP.
 *  - Panduan e-Rapor SMK 2025 (Direktorat SMK): guru mengisi satu Nilai Akhir 0-100 per siswa per mapel, serta menandai TP yang dicapai
 *    optimal (T) dan yang perlu peningkatan (R); deskripsi capaian tertinggi/terendah dibuat dari tanda itu dan dapat diedit.
 * Angka yang dihitung di sini hanya SARAN: guru menetapkan nilai akhir sendiri.
 */

export const METODE_RAPOR = {
    RATA:   'Rata-rata semua penilaian sumatif',
    BOBOT:  'Pembobotan per penilaian sumatif',
    PERSEN: 'Persentase TP yang tercapai',
    TERAKHIR: 'Nilai TP terakhir',
};

const angka = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const bulat = (n) => (n === null ? null : Math.min(100, Math.max(0, Math.round(n))));   // pembulatan normal, di dalam 0-100

/** Total bobot yang diisi guru untuk daftar penilaian; sah bila tepat 100 (B-08: guru mengisi bobot sendiri, total harus 100%). */
export function totalBobot(asesmen, bobot = {}) {
    const total = (asesmen ?? []).reduce((j, a) => j + (angka(bobot?.[a.id]) ?? 0), 0);
    return { total: Math.round(total * 1000) / 1000, sah: Math.abs(total - 100) < 0.001 };
}

/** Rata-rata nilai per TP (hanya penilaian sumatif yang terkait TP dan sudah bernilai; penilaian yang menaut beberapa TP dihitung di tiap TP itu). Hasil: { [tpId]: rata-rata }. */
export function nilaiPerTp(asesmen, nilai) {
    const jumlah = {};
    for (const a of asesmen ?? []) {
        const n = angka(nilai?.[a.id]);
        if (n === null) continue;
        for (const tp of new Set(a.tpIds ?? [])) (jumlah[tp] ??= []).push(n);   // satu penilaian dapat menaut banyak TP: nilainya berlaku untuk tiap TP
    }
    return Object.fromEntries(Object.entries(jumlah).map(([tp, arr]) => [tp, arr.reduce((x, y) => x + y, 0) / arr.length]));
}

/** TP terakhir = TP dengan urutan terbesar di antara TP yang punya penilaian sumatif tertaut. Null bila tidak ada. */
export function tpTerakhir(asesmen, urutanTp = []) {
    const dipakai = new Set((asesmen ?? []).flatMap((a) => a.tpIds ?? []));
    const urut = (urutanTp ?? []).filter((id) => dipakai.has(id));
    return urut.length ? urut[urut.length - 1] : null;
}

/**
 * Saran nilai rapor satu siswa.
 * @param {object} p
 * @param {'RATA'|'BOBOT'|'PERSEN'} p.metode
 * @param {{id:string, tpIds?:string[]}[]} p.asesmen   penilaian SUMATIF mata pelajaran itu (semua, tanpa filter TP)
 * @param {Object<string, number|null>} p.nilai          nilai siswa itu per id penilaian
 * @param {Object<string, number>} [p.bobot]             bobot per id penilaian (untuk BOBOT; yang kosong/0 diabaikan)
 * @param {Object<string, boolean|null>} [p.tercapaiPerTp] ketercapaian per TP (untuk PERSEN; yang tak diketahui diabaikan)
 * @param {string[]} [p.urutanTp]                       id TP menurut urutan TP (untuk TERAKHIR)
 * @returns {number|null} bilangan bulat 0-100, atau null bila tidak ada data untuk dihitung
 */
export function hitungNilaiRapor({ metode, asesmen, nilai, bobot = {}, tercapaiPerTp = {}, urutanTp = [] }) {
    const daftar = asesmen ?? [];
    if (metode === 'RATA') {
        const arr = daftar.map((a) => angka(nilai?.[a.id])).filter((n) => n !== null);
        return arr.length ? bulat(arr.reduce((x, y) => x + y, 0) / arr.length) : null;
    }
    if (metode === 'BOBOT') {
        if (!totalBobot(daftar, bobot).sah) return null;   // bobot belum 100%: tidak ada saran (tidak dinormalkan diam-diam)
        const dipakai = [];
        let tot = 0;
        for (const a of daftar) {
            const n = angka(nilai?.[a.id]); const bb = angka(bobot?.[a.id]);
            if (n === null || bb === null || bb <= 0) continue;
            dipakai.push([n, bb]); tot += bb;
        }
        if (tot <= 0) return null;
        // Mengikuti contoh Panduan Pembelajaran dan Asesmen 2025 (hal. 57): kontribusi tiap penilaian dibulatkan (mis. 83 x 20% = 16,6 -> 17),
        // lalu dijumlahkan. Bila ada penilaian yang belum bernilai bagi seorang siswa, bobot sisanya dinormalkan.
        return bulat(dipakai.reduce((jml, [n, bb]) => jml + Math.round((n * bb) / tot), 0));
    }
    if (metode === 'PERSEN') {
        const perTp = nilaiPerTp(daftar, nilai);
        const dinilai = Object.keys(perTp).filter((tp) => typeof tercapaiPerTp?.[tp] === 'boolean');
        if (!dinilai.length) return null;
        return bulat((dinilai.filter((tp) => tercapaiPerTp[tp]).length / dinilai.length) * 100);
    }
    if (metode === 'TERAKHIR') {
        const terakhir = tpTerakhir(daftar, urutanTp);
        if (!terakhir) return null;
        const n = angka(nilaiPerTp(daftar, nilai)[terakhir]);   // siswa tanpa nilai di TP terakhir: tidak dihitung (guru mengisi manual), bukan diganti TP lain
        return n === null ? null : bulat(n);
    }
    throw new Error('metode tidak dikenal: ' + metode);
}

/**
 * Saran tanda TP untuk e-Rapor (usulan; guru memverifikasi dan boleh mengubah, jumlahnya tidak dipaksa).
 *  - T (dicapai optimal): satu TP dengan nilai tertinggi di antara TP yang TERCAPAI (di atas batas KKTP). TP tanpa KKTP ikut dinilai dari nilainya.
 *    Bila nilai sama tinggi, dipilih TP dengan urutan paling akhir. Bila semua TP belum tercapai, tidak ada T.
 *  - R (perlu peningkatan): satu TP BELUM tercapai dengan nilai terendah (seri: urutan paling awal). Bila semua TP tercapai, tidak ada R.
 *    Bila tidak satu pun TP punya KKTP, R = TP bernilai terendah asal lebih rendah dari T (dasar: nilai saja).
 * @param {Object<string, number>} perTp   rata-rata nilai siswa per TP
 * @param {{batasTp?: Object<string, number|null>, urutanTp?: string[]}} [opsi]  batas ketercapaian (KKTP) per TP dan id TP menurut urutan TP
 * @returns {{optimal: string[], perlu: string[], dasarNilai: boolean}} dasarNilai = ada usulan yang hanya berdasar nilai (KKTP belum ada)
 */
export function sarankanTR(perTp, { batasTp = {}, urutanTp = [] } = {}) {
    const entri = Object.entries(perTp ?? {}).map(([id, nilai]) => ({ id, nilai }));
    const kosong = { optimal: [], perlu: [], dasarNilai: false };
    if (!entri.length) return kosong;
    const pos = (id) => { const i = urutanTp.indexOf(id); return i < 0 ? urutanTp.length : i; };
    const status = (e) => { const b = angka(batasTp?.[e.id]); return b === null ? null : e.nilai >= b; };   // true = tercapai, false = belum, null = tanpa KKTP
    const adaKktp = entri.some((e) => status(e) !== null);

    const calonT = entri.filter((e) => status(e) !== false);
    const t = calonT.length ? calonT.reduce((a, e) => (e.nilai > a.nilai || (e.nilai === a.nilai && pos(e.id) > pos(a.id)) ? e : a)) : null;

    const belum = entri.filter((e) => status(e) === false);
    let r = belum.length ? belum.reduce((a, e) => (e.nilai < a.nilai || (e.nilai === a.nilai && pos(e.id) < pos(a.id)) ? e : a)) : null;
    let rDariNilai = false;
    if (!r && !adaKktp) {
        const sisa = entri.filter((e) => e.id !== t?.id && (!t || e.nilai < t.nilai));
        if (sisa.length) { r = sisa.reduce((a, e) => (e.nilai < a.nilai || (e.nilai === a.nilai && pos(e.id) < pos(a.id)) ? e : a)); rDariNilai = true; }
    }
    return { optimal: t ? [t.id] : [], perlu: r ? [r.id] : [], dasarNilai: (!!t && status(t) === null) || rDariNilai };
}

const teksTp = (t) => String(t?.deskripsi_tp || t?.kode_tp || '').trim().replace(/[.\s]+$/, '');

/** Deskripsi capaian tertinggi dan terendah dari tanda T/R (dapat diedit guru). Kalimat positif, sesuai panduan. */
export function susunDeskripsi({ optimal = [], perlu = [], tpById = {} }) {
    const gabung = (ids) => ids.map((id) => teksTp(tpById[id])).filter(Boolean).join('; ');
    const t = gabung(optimal), r = gabung(perlu);
    return {
        tertinggi: t ? `Menunjukkan penguasaan yang baik dalam ${t}.` : '',
        terendah:  r ? `Perlu peningkatan dalam ${r}.` : '',
    };
}

/**
 * Lembar "e-Rapor" untuk ekspor: satu baris per siswa (bukan per TP). Kolom TP berisi T, R, atau kosong.
 * CATATAN: susunan kolom mengikuti DESKRIPSI di Panduan e-Rapor SMK 2025 (nilai 0-100; T/R pada kolom TP); belum dicocokkan dengan berkas
 * "Format Nilai Kelas" resmi hasil unduhan aplikasi e-Rapor.
 */
export function susunLembarERapor({ roster, tps, rapor }) {
    const header = ['NO', 'NIS', 'NAMA PESERTA DIDIK', 'NILAI AKHIR', ...tps.map((t) => t.kode_tp || t.id), 'DESKRIPSI CAPAIAN TERTINGGI', 'DESKRIPSI CAPAIAN TERENDAH'];
    const urut = [...roster].sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'));
    const rows = urut.map((s, i) => {
        const r = rapor?.[s.id];
        const tanda = tps.map((t) => (r?.tp_optimal?.includes(t.id) ? 'T' : r?.tp_perlu?.includes(t.id) ? 'R' : ''));
        return [i + 1, s.nis || '', s.nama || '', r?.nilai_rapor ?? '', ...tanda, r?.deskripsi_tertinggi ?? '', r?.deskripsi_terendah ?? ''];
    });
    return { header, rows };
}
