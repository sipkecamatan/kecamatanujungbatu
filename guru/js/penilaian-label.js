/**
 * @file guru/js/penilaian-label.js
 * Satu pintu untuk IDENTITAS dan STATUS penilaian (logika murni; diuji di tests/penilaian-label.mjs).
 * Semua layar (Pelaksanaan, Rekap, bobot Nilai Rapor, ekspor) memakai fungsi di sini, bukan merakit label sendiri.
 */

const tglPendek = (t) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t ?? '')); return m ? `${m[3]}/${m[2]}` : ''; };
const rapi = (s) => String(s ?? '').replace(/_/g, ' ').trim();

/** Nama teknik yang dibaca guru. Kode tersimpan (mis. TES) tidak berubah; hanya tampilan. */
export function namaTeknik(kode) { return kode === 'TES' ? 'TES TERTULIS' : rapi(kode); }

/** Satu pintu: daftar id TP yang ditautkan pada sebuah penilaian (bisa kosong, satu, atau banyak). */
export function tpIdsPenilaian(a) { return Array.isArray(a?.tpIds) ? a.tpIds : []; }

/** TP tertaut diurutkan mengikuti urutan daftar TP (bukan urutan baris di database), supaya tampilan konsisten. */
export function tpIdsUrut(a, tpById = {}) {
    const urut = Object.keys(tpById);
    const pos = (id) => { const i = urut.indexOf(id); return i < 0 ? urut.length : i; };
    return [...tpIdsPenilaian(a)].sort((x, y) => pos(x) - pos(y));
}

/** Ringkasan TP tertaut untuk ditampilkan di daftar (selalu terlihat, juga bila penilaian berjudul): "TP: ALUR-TP1, ALUR-TP3" atau "Tanpa TP". */
export function ringkasTp(a, tpById = {}) {
    const ids = tpIdsUrut(a, tpById);
    if (!ids.length) return 'Tanpa TP';
    return 'TP: ' + ids.map((id) => tpById[id]?.kode_tp || 'TP terkait').join(', ');
}

/** Label yang dibaca guru: judul bila ada; selain itu kode TP + tanggal + teknik/instrumen (bedakan dua penilaian yang mirip). */
export function labelPenilaian(a, tpById = {}) {
    const judul = String(a?.judul ?? '').trim();
    if (judul) return judul;
    const ids = tpIdsUrut(a, tpById);
    const kode = ids.map((id) => tpById[id]?.kode_tp).filter(Boolean).join(', ');
    const bagian = [kode || (ids.length ? 'TP' : 'Tanpa TP'), tglPendek(a?.tanggal), [namaTeknik(a?.teknik), rapi(a?.instrumen)].filter(Boolean).join(' ')];
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
 * Opsi TP pada formulir penilaian (boleh memilih satu atau beberapa). TP yang SUDAH tertaut pada penilaian yang sedang disunting selalu ada dalam opsi
 * (dan terpilih), walau daftar TP belum/tidak memuatnya. Tanpa ini, menyimpan formulir melepas tautan diam-diam padahal guru tidak menyentuh isian itu.
 */
export function opsiTpPenilaian(daftarTp, tpTertaut) {
    const terpilih = new Set(Array.isArray(tpTertaut) ? tpTertaut : (tpTertaut ? [tpTertaut] : []));
    const opsi = (daftarTp ?? []).map((t) => ({ id: t.id, label: t.kode_tp || t.id }));
    for (const id of terpilih) if (!opsi.some((o) => o.id === id)) opsi.push({ id, label: 'TP terkait (daftar belum termuat)' });
    return opsi.map((o) => ({ ...o, terpilih: terpilih.has(o.id) }));
}

/**
 * SATU pintu filter Rekap: tampilan layar dan ekspor Excel memakai fungsi yang sama, sehingga Excel selalu berisi persis penilaian yang sedang tampil.
 * @param {object[]} daftar  penilaian (hasil getAssessments)
 * @param {{jenis?:string, teknik?:string, instrumen?:string, tp?:string}} f  filter kosong = tidak menyaring bagian itu
 */
export function saringPenilaian(daftar, { jenis = '', teknik = '', instrumen = '', tp = '' } = {}) {
    return (daftar ?? []).filter((a) => (!jenis || a.jenis === jenis)
        && (!teknik || a.teknik === teknik)
        && (!instrumen || a.instrumen === instrumen)
        && (!tp || tpIdsPenilaian(a).includes(tp)));
}
