/**
 * @file guru/js/rumus-rapor-state.js
 * SATU sumber keadaan RUMUS nilai rapor (metode + bobot per penilaian sumatif) untuk satu kelas + mapel + tahun + semester.
 * Guru memilih rumus di bagian Rekap; bagian Nilai Rapor membaca keadaan yang sama dan menyimpannya (grade_final.rumus). Keduanya tidak
 * pernah memegang salinan sendiri, sehingga tidak mungkin menampilkan rumus yang berbeda. Logika murni (tanpa DOM, tanpa jaringan); diuji di
 * tests/rumus-rapor-state.mjs.
 */
import { METODE_RAPOR } from './nilai-rapor.js';

const S = { kunci: null, metode: 'RATA', bobot: {}, tersimpan: null, pendengar: new Set() };

/** Kunci konteks: rumus berlaku per kelas + mapel + tahun ajaran + semester. */
export const kunciKonteks = (c) => [c.classId, c.subjectId, c.year, c.semester].join('|');

const angkaBobot = (v) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const salinBobotUntuk = (ids, bobot) => Object.fromEntries(ids.map((id) => [id, Number(bobot?.[id]) || 0]));
const kabari = (alasan) => { for (const f of [...S.pendengar]) { try { f(alasan); } catch { /* satu pendengar rusak tidak boleh mengganggu yang lain */ } } };

/**
 * Siapkan keadaan untuk sebuah konteks. Dipanggil oleh Rekap DAN Nilai Rapor setiap kali mereka memuat data.
 *  - Konteks BERBEDA dari sebelumnya: keadaan dimulai dari rumus yang tersimpan (atau bawaan RATA).
 *  - Konteks SAMA: perubahan guru yang belum disimpan DIPERTAHANKAN; hanya bobot milik penilaian yang sudah dihapus dibuang.
 * @param {{kunci:string, rumusSimpan?:{metode?:string,bobot?:object}|null, metodeAwal?:string, sumatifIds:string[]}} p
 */
export function siapkanRumus({ kunci, rumusSimpan = null, metodeAwal = null, sumatifIds }) {
    const ids = sumatifIds ?? [];
    if (S.kunci !== kunci) {
        const metode = rumusSimpan?.metode && METODE_RAPOR[rumusSimpan.metode] ? rumusSimpan.metode
            : (metodeAwal && METODE_RAPOR[metodeAwal] ? metodeAwal : 'RATA');
        const bobot = {};
        for (const id of ids) { const v = angkaBobot(rumusSimpan?.bobot?.[id]); if (v !== null) bobot[id] = v; }
        S.kunci = kunci; S.metode = metode; S.bobot = bobot;
        S.tersimpan = rumusSimpan ? { metode, bobot: salinBobotUntuk(ids, bobot) } : null;
        return;
    }
    const idSah = new Set(ids);
    for (const id of Object.keys(S.bobot)) if (!idSah.has(id)) delete S.bobot[id];
}

/** Kunci konteks yang sedang dipegang (null bila belum ada). Dipakai untuk menghindari memuat ulang rumus tersimpan yang sama. */
export function getKunci() { return S.kunci; }

/** Keadaan sekarang. `bobot` adalah objek hidup (dibaca saja oleh pemakai). */
export function getRumus() { return { metode: S.metode, bobot: S.bobot, tersimpan: S.tersimpan }; }

export function setMetode(m) {
    if (!METODE_RAPOR[m] || m === S.metode) return false;
    S.metode = m; kabari('metode'); return true;
}

export function setBobot(id, nilai) {
    const v = angkaBobot(nilai) ?? 0;
    if (S.bobot[id] === v) return false;
    S.bobot[id] = v; kabari('bobot'); return true;
}

/** Apakah rumus di layar berbeda dari yang tersimpan di server? (Tanpa rumus tersimpan: berbeda bila sudah ada pilihan selain bawaan.) */
export function adaPerubahan(sumatifIds) {
    const t = S.tersimpan;
    if (!t) return false;   // belum pernah disimpan: tidak ada pembanding; nilai rapor sendiri yang ditandai "belum disimpan"
    if (t.metode !== S.metode) return true;
    return S.metode === 'BOBOT' && (sumatifIds ?? []).some((id) => (t.bobot?.[id] ?? 0) !== (Number(S.bobot[id]) || 0));
}

/** Dipanggil setelah Simpan Nilai Rapor berhasil: rumus di layar kini = rumus tersimpan. */
export function catatTersimpan(sumatifIds) {
    S.tersimpan = { metode: S.metode, bobot: salinBobotUntuk(sumatifIds ?? [], S.bobot) };
    kabari('tersimpan');
}

/** Daftar pendengar perubahan keadaan (Rekap dan Nilai Rapor). Mengembalikan fungsi untuk berhenti mendengar. */
export function langgan(fn) { S.pendengar.add(fn); return () => S.pendengar.delete(fn); }

/** Hanya untuk uji. */
export function setelUlang() { S.kunci = null; S.metode = 'RATA'; S.bobot = {}; S.tersimpan = null; S.pendengar.clear(); }
