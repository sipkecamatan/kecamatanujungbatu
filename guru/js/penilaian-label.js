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
 * Opsi TP pada formulir penilaian. TP yang SUDAH tertaut pada penilaian yang sedang disunting selalu ada dalam opsi (dan terpilih), walau daftar TP
 * belum/tidak memuatnya. Tanpa ini, menyimpan formulir mengubah tautan menjadi "tanpa TP" diam-diam padahal guru tidak menyentuh isian itu.
 */
export function opsiTpPenilaian(daftarTp, tpTertaut) {
    const opsi = [{ id: '', label: '— TP (Opsional) —' }, ...(daftarTp ?? []).map((t) => ({ id: t.id, label: t.kode_tp || t.id }))];
    if (tpTertaut && !opsi.some((o) => o.id === tpTertaut)) opsi.push({ id: tpTertaut, label: 'TP terkait (daftar belum termuat)' });
    return opsi.map((o) => ({ ...o, terpilih: o.id === (tpTertaut ?? '') }));
}

