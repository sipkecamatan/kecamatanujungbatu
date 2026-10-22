/**
 * @file guru/js/nilai-rapor-ui.js
 * Bagian "Nilai Rapor" pada tab Jurnal Mengajar > Penilaian. Guru mata pelajaran menetapkan SATU nilai akhir (0-100) per siswa per semester dan
 * menandai TP yang dicapai optimal (T) dan perlu peningkatan (R), mengikuti Panduan e-Rapor SMK 2025. Aplikasi hanya MENYARANKAN angka
 * (tiga opsi resmi: rata-rata, pembobotan, persentase TP tercapai); guru yang memutuskan. Logika hitung ada di nilai-rapor.js (diuji terpisah).
 * Tampilan ini belum memiliki uji otomatis; hanya logika dan lapisan datanya yang diuji.
 */
import {
    getAssessments, getStudentsForClass, getResultsForAssessments, getTps, getKktps,
    getGradeFinal, upsertGradeFinalBatch, deleteGradeFinalForStudents,
} from './api.js';
import { tpIdsPenilaian } from './penilaian-label.js';
import { METODE_RAPOR, totalBobot, hitungNilaiRapor, nilaiPerTp, tpTerakhir, sarankanTR, susunDeskripsi, susunLembarERapor, statusSimpanRapor, susunCatatanRapor } from './nilai-rapor.js';
import { kunciKonteks, siapkanRumus, getRumus, adaPerubahan, catatTersimpan, langgan } from './rumus-rapor-state.js';

let _seq = 0;            // nomor muat: hasil muat lama yang selesai terlambat dibuang
let _menyimpan = false;  // cegah simpan ganda
let _batalLangganan = null;   // pendengar perubahan rumus milik muat Nilai Rapor sebelumnya (diganti tiap muat)

const NILAI_OK = (v) => v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100;

/** KKTP: TP dianggap tercapai bila nilai TP >= batas bawah predikat BSH (atau SB). Tanpa KKTP = tidak diketahui. */
function batasTercapai(kktps) {
    const rentang = kktps?.[0]?.rentang;
    if (!rentang) return null;
    const bsh = rentang.BSH?.[0], sb = rentang.SB?.[0];
    const batas = [bsh, sb].filter((n) => typeof n === 'number');
    return batas.length ? Math.min(...batas) : null;
}

export async function renderNilaiRapor(body, ctx) {
    const { esc, toast } = ctx;
    const seq = ++_seq;
    body.innerHTML = '<p class="pen-placeholder">Memuat nilai rapor…</p>';
    let data;
    try {
        const [semua, roster, tps, tersimpan] = await Promise.all([
            getAssessments(ctx.schoolId, ctx.classId, ctx.subjectId, ctx.year, Number(ctx.semester)),
            getStudentsForClass(ctx.classId, ctx.year, ctx.semester),
            getTps(ctx.classId, ctx.subjectId, ctx.year, Number(ctx.semester)),
            getGradeFinal(ctx.schoolId, ctx.classId, ctx.subjectId, ctx.year, ctx.semester),
        ]);
        if (seq !== _seq) return;
        const sumatif = semua.filter((a) => a.jenis === 'SUMATIF');
        const [hasil, kktps] = await Promise.all([
            getResultsForAssessments(sumatif.map((a) => a.id), ctx.schoolId),
            Promise.all(tps.map((t) => getKktps(t.id).catch(() => []))),
        ]);
        if (seq !== _seq) return;
        data = { sumatif, roster, tps, tersimpan, hasil, kktps };
    } catch (err) {
        if (seq !== _seq) return;
        body.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat nilai rapor: ' + esc(err.message) + '</p>';
        return;
    }

    const { sumatif, roster, tps, tersimpan, hasil } = data;
    if (!roster.length) { body.innerHTML = '<p class="pen-placeholder">Belum ada siswa terdaftar di kelas ini pada tahun ajaran dan semester ini.</p>'; return; }
    // Tanpa penilaian sumatif tidak ada hitungan: pesan tampil di atas tabel.
    const infoKosong = sumatif.length ? '' : '<p class="pen-placeholder" style="margin:0 0 10px">Belum ada penilaian sumatif untuk mata pelajaran ini, sehingga nilai rapor belum dapat dihitung. Isi nilai pada penilaian sumatif di bagian Pelaksanaan.</p>';

    // ── Data turunan ──
    const asesmen = sumatif.map((a) => ({ id: a.id, tpIds: tpIdsPenilaian(a) }));
    const nilaiSiswa = {};
    for (const h of hasil) (nilaiSiswa[h.student_id] ??= {})[h.assessment_id] = h.nilai === null || h.nilai === undefined ? null : Number(h.nilai);
    const batasTp = Object.fromEntries(tps.map((t, i) => [t.id, batasTercapai(data.kktps[i])]));
    const tpById = Object.fromEntries(tps.map((t) => [t.id, t]));
    const adaBatas = (id) => batasTp[id] !== null && batasTp[id] !== undefined;
    const simpanSiswa = Object.fromEntries(tersimpan.map((r) => [r.student_id, r]));

    // Rumus (metode + bobot) dipilih guru di bagian REKAP dan tersimpan bersama nilai rapor (grade_final.rumus). Keadaannya dipegang SATU modul bersama
    // (rumus-rapor-state.js) supaya Rekap dan Nilai Rapor selalu melihat rumus yang sama; di sini hanya dibaca (st.metode dan st.bobot di bawah).
    const rumusSimpan = tersimpan.find((r) => r.rumus && typeof r.rumus === 'object')?.rumus ?? null;
    const idSumatif = sumatif.map((a) => a.id);
    siapkanRumus({ kunci: kunciKonteks(ctx), rumusSimpan, metodeAwal: tersimpan[0]?.metode ?? null, sumatifIds: idSumatif });
    const st = {
        // Izin tampil di portal: aktif bila SEMUA nilai rapor tersimpan sudah diizinkan (berlaku untuk seluruh kelas ini pada mapel dan semester ini)
        visSiswa: tersimpan.length > 0 && tersimpan.every((r) => r.is_visible_siswa === true),
        visOrtu:  tersimpan.length > 0 && tersimpan.every((r) => r.is_visible_ortu === true),
        rows: {},
    };
    Object.defineProperty(st, 'metode', { get: () => getRumus().metode, enumerable: true });
    Object.defineProperty(st, 'bobot', { get: () => getRumus().bobot, enumerable: true });

    const hitungSiswa = (sid) => {
        const nilai = nilaiSiswa[sid] ?? {};
        const perTp = nilaiPerTp(asesmen, nilai);
        const tercapaiPerTp = {};
        for (const tp of Object.keys(perTp)) if (batasTp[tp] !== null && batasTp[tp] !== undefined) tercapaiPerTp[tp] = perTp[tp] >= batasTp[tp];
        let hitung = null;
        try { hitung = hitungNilaiRapor({ metode: st.metode, asesmen, nilai, bobot: st.bobot, tercapaiPerTp, urutanTp: tps.map((t) => t.id) }); } catch { hitung = null; }
        return { hitung, perTp, tr: sarankanTR(perTp, { batasTp, urutanTp: tps.map((t) => t.id) }) };
    };
    // Rumus belum lengkap (mis. Pembobotan dengan total bobot bukan 100%) TIDAK boleh dibaca sebagai "guru mengosongkan nilai": nilai yang ada dibiarkan, dan guru diberi tahu.
    const rumusBelumLengkap = () => {
        if (!sumatif.length) return '';
        if (st.metode === 'BOBOT') {
            const { total, sah } = totalBobot(sumatif, st.bobot);
            return sah ? '' : 'Total bobot ' + total + '% (harus tepat 100%)';
        }
        if (st.metode === 'TERAKHIR' && !tpTerakhir(asesmen, tps.map((t) => t.id))) return 'Belum ada penilaian sumatif yang ditautkan ke TP (pilih TP pada formulir penilaian)';
        if (st.metode === 'PERSEN') {
            const tertaut = sumatif.filter((a) => tpIdsPenilaian(a).length);
            if (!tertaut.length) return 'Belum ada penilaian sumatif yang ditautkan ke TP (pilih TP pada formulir penilaian)';
            if (!tertaut.some((a) => tpIdsPenilaian(a).some(adaBatas))) return 'TP yang ditautkan belum punya KKTP (batas ketercapaian)';
        }
        return '';
    };
    // Sebagian data tidak ikut dihitung oleh Persentase TP: bukan galat, tetapi guru perlu tahu.
    const catatanTpBelumDinilai = () => {
        if (!sumatif.length) return '';
        const belum = tps.filter((t) => !sumatif.some((a) => tpIdsPenilaian(a).includes(t.id)));
        if (!belum.length) return '';
        return '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-warning, #d97706);border-radius:6px;font-size:12px">ℹ ' + belum.length + ' dari ' + tps.length + ' TP belum punya penilaian sumatif (' +
            esc(belum.map((t) => t.kode_tp || '?').join(', ')) + '), sehingga tidak ikut dihitung pada Persentase TP, Nilai TP terakhir, dan usulan T/R.</div>';
    };
    const catatanTerakhir = () => {
        if (st.metode !== 'TERAKHIR' || rumusBelumLengkap()) return '';
        const id = tpTerakhir(asesmen, tps.map((t) => t.id));
        return '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:12px">ℹ Nilai rapor memakai <strong>' + esc(tpById[id]?.kode_tp || 'TP terakhir') + '</strong> (TP terakhir yang punya penilaian sumatif). Siswa yang belum bernilai di TP itu dikosongkan; isi nilainya di bagian Pelaksanaan.</div>';
    };
    const catatanSebagian = () => {
        if (st.metode !== 'PERSEN' || rumusBelumLengkap()) return '';
        const tanpaTp = sumatif.filter((a) => !tpIdsPenilaian(a).length).length;
        const tpTanpaKktp = new Set(sumatif.flatMap(tpIdsPenilaian).filter((id) => !adaBatas(id))).size;
        const bagian = [];
        if (tanpaTp) bagian.push(tanpaTp + ' penilaian sumatif belum ditautkan ke TP');
        if (tpTanpaKktp) bagian.push(tpTanpaKktp + ' TP belum punya KKTP');
        return bagian.length ? '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-warning, #d97706);border-radius:6px;font-size:12px">ℹ ' + esc(bagian.join('; ')) + ', sehingga tidak ikut dihitung pada Persentase TP.</div>' : '';
    };
    const infoRumus = () => {
        const kurang = rumusBelumLengkap();
        const peringatanLengkap = kurang ? '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-danger);border-radius:6px;font-size:12px;color:var(--color-danger)">Rumus belum lengkap: ' + esc(kurang) + '. Nilai belum dihitung ulang dan nilai yang ada tidak diubah. Lengkapi dulu, lalu nilai terhitung otomatis.</div>' : '';
        const sebagian = catatanSebagian() + catatanTerakhir() + catatanTpBelumDinilai();
        // Rumus yang sedang tersimpan di server (pembanding). Mengubah metode atau bobot memengaruhi SEMUA siswa, jadi perubahannya harus tampak jelas sebelum disimpan.
        const rumusTersimpan = getRumus().tersimpan;
        if (!rumusTersimpan || !adaPerubahan(idSumatif)) return peringatanLengkap + sebagian;
        const dari = METODE_RAPOR[rumusTersimpan.metode] ?? rumusTersimpan.metode;
        const ke = METODE_RAPOR[st.metode] ?? st.metode;
        const teks = rumusTersimpan.metode !== st.metode ? 'Rumus diubah dari <strong>' + esc(dari) + '</strong> menjadi <strong>' + esc(ke) + '</strong>' : 'Bobot rumus diubah';
        return '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-warning, #d97706);border-radius:6px;font-size:12px">⚠ ' + teks +
            ' di bagian Rekap (belum disimpan). Nilai rapor <strong>semua siswa</strong> di bawah ikut berubah; tekan Simpan Nilai Rapor untuk menetapkannya.</div>' + peringatanLengkap + sebagian;
    };
    for (const s of roster) {
        const r = simpanSiswa[s.id];
        const row = {
            nilai: r ? String(Number(r.nilai_rapor)) : '',
            optimal: new Set((r?.tp_optimal ?? []).filter((id) => tpById[id])), perlu: new Set((r?.tp_perlu ?? []).filter((id) => tpById[id])),   // TP yang sudah dihapus tidak ditampilkan/diteruskan
            desT: r?.deskripsi_tertinggi ?? '', desR: r?.deskripsi_terendah ?? '',
            sunting: !!(r?.deskripsi_tertinggi || r?.deskripsi_terendah), ada: !!r, terbuka: false, dasarNilai: false,
        };
        const { hitung, tr } = hitungSiswa(s.id);
        // Nilai rapor SELALU hasil rumus (tidak ada angka manual). Rumus lengkap tetapi siswa tak punya datanya: kosong. Rumus belum lengkap: nilai tersimpan dibiarkan.
        if (hitung !== null) row.nilai = String(hitung);
        else if (!rumusBelumLengkap()) row.nilai = '';
        if (!r && (tr.optimal.length || tr.perlu.length)) {
            row.optimal = new Set(tr.optimal); row.perlu = new Set(tr.perlu); row.dasarNilai = tr.dasarNilai;
            const d = susunDeskripsi({ optimal: tr.optimal, perlu: tr.perlu, tpById }); row.desT = d.tertinggi; row.desR = d.terendah;
        }
        st.rows[s.id] = row;
    }
    const ringkasTR = (row) => {
        const kode = (id) => esc(tpById[id]?.kode_tp || '?');
        const t = [...row.optimal].map(kode).join(', '), r = [...row.perlu].map(kode).join(', ');
        const dasar = row.dasarNilai && (t || r) ? ' <span title="Usulan hanya berdasar nilai; KKTP belum ada" style="opacity:.7">(dasar nilai, KKTP belum ada)</span>' : '';
        return ((t ? 'T: ' + t : '') + (t && r ? ' · ' : '') + (r ? 'R: ' + r : '') || '—') + dasar;
    };

    // ── HTML ──
    // Ringkasan rumus HANYA-BACA (rumus dipilih di bagian Rekap).
    const ringkasRumusHtml = () => {
        const g = getRumus();
        let teks = 'Rumus: <strong>' + esc(METODE_RAPOR[g.metode] ?? g.metode) + '</strong>';
        if (g.metode === 'BOBOT') {
            const { total, sah } = totalBobot(sumatif, g.bobot);
            teks += ' · total bobot <strong style="color:' + (sah ? 'var(--color-success)' : 'var(--color-danger)') + '">' + total + '%</strong>';
        }
        return teks + ' <span style="color:var(--color-text-muted);font-size:12px">(dipilih di bagian Rekap)</span>';
    };
    // Penanda sederhana: angka di layar berbeda dari yang tersimpan di server (mis. penilaian berubah, atau bobot diubah) -> belum disimpan.
    const penandaBelumSimpan = (sid) => {
        const row = st.rows[sid]; const r = simpanSiswa[sid];
        const beda = row.nilai !== '' && (!r || Math.round(Number(row.nilai) * 100) !== Math.round(Number(r.nilai_rapor) * 100));
        return '<span class="nr-belum" style="display:block;font-size:11px;color:var(--color-warning, #d97706)">' + (beda ? '• belum disimpan' : '') + '</span>';
    };
    // Siswa yang baru punya sebagian nilai penilaian sumatif diberi penanda, supaya hasilnya tidak tampak sama lengkapnya dengan siswa lain.
    const kelengkapanHtml = (sid) => {
        if (!sumatif.length) return '';
        const ada = sumatif.filter((a) => { const n = nilaiSiswa[sid]?.[a.id]; return n !== null && n !== undefined && Number.isFinite(Number(n)); }).length;
        if (ada >= sumatif.length) return '';
        return '<br><span class="nr-lengkap" style="font-size:11px;color:var(--color-warning, #d97706)">' + (ada ? 'baru ' + ada + ' dari ' + sumatif.length + ' penilaian sumatif bernilai' : 'belum ada nilai penilaian sumatif') + '</span>';
    };
    const barisHtml = (s) => {
        const row = st.rows[s.id];
        const detail = row.terbuka ? detailHtml(s) : '';
        return '<tr data-sid="' + esc(s.id) + '"><td>' + esc(s.nama) + (s.nis ? ' <span style="color:var(--color-text-muted);font-size:11px">' + esc(s.nis) + '</span>' : '') + kelengkapanHtml(s.id) + '</td>' +
            '<td><input type="number" class="nr-nilai" min="0" max="100" step="0.01" value="' + esc(row.nilai) + '" readonly title="Nilai rapor dihitung dari rumus. Untuk mengubahnya, ubah nilai pada penilaian di bagian Pelaksanaan." style="width:76px">' + '<span class="nr-penanda">' + penandaBelumSimpan(s.id) + '</span>' + '</td>' +
            '<td class="nr-tr" style="font-size:12px">' + ringkasTR(row) + '</td>' +
            '<td><button type="button" class="pen-btn pen-btn-sm" data-nr="detail">' + (row.terbuka ? 'Tutup' : 'TP dan deskripsi') + '</button></td></tr>' +
            (row.terbuka ? '<tr class="nr-detail" data-sid-detail="' + esc(s.id) + '"><td colspan="5">' + detail + '</td></tr>' : '');
    };
    const detailHtml = (s) => {
        const row = st.rows[s.id];
        if (!tps.length) return '<p class="pen-placeholder" style="margin:0">Belum ada Tujuan Pembelajaran. Buat TP di bagian Perencanaan untuk menandai T dan R.</p>';
        const nTp = hitungSiswa(s.id).perTp;
        return '<div style="display:grid;gap:4px;margin-bottom:8px">' + tps.map((t) => {
            const v = row.optimal.has(t.id) ? 'T' : row.perlu.has(t.id) ? 'R' : '';
            const nm = esc(s.id + '-' + t.id);
            const radio = (val, lbl) => '<label style="font-weight:normal;margin-right:10px"><input type="radio" class="nr-tp" name="tp-' + nm + '" data-tp="' + esc(t.id) + '" value="' + val + '"' + (v === val ? ' checked' : '') + '> ' + lbl + '</label>';
            return '<div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="min-width:120px;font-size:12px"><strong>' + esc(t.kode_tp || '?') + '</strong>' +
                (nTp[t.id] != null ? ' <span style="color:var(--color-text-muted)">(' + Math.round(nTp[t.id]) + ')</span>' : '') + '</span>' +
                radio('T', 'T (optimal)') + radio('R', 'R (perlu peningkatan)') + radio('', 'tidak ditandai') + '</div>';
        }).join('') + '</div>' +
            '<label style="font-size:12px;display:block">Deskripsi capaian tertinggi<textarea class="nr-des-t input" rows="2" style="width:100%">' + esc(row.desT) + '</textarea></label>' +
            '<label style="font-size:12px;display:block;margin-top:6px">Deskripsi capaian terendah<textarea class="nr-des-r input" rows="2" style="width:100%">' + esc(row.desR) + '</textarea></label>' +
            '<button type="button" class="pen-btn pen-btn-sm" data-nr="susun-des" style="margin-top:6px">Susun deskripsi dari tanda T dan R</button>';
    };
    const gambar = () => {
        const bukaIds = new Set(Object.entries(st.rows).filter(([, r]) => r.terbuka).map(([id]) => id));
        body.innerHTML = infoKosong +
            '<div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px">' +
            'Nilai rapor adalah <strong>nilai akhir yang Anda tetapkan</strong> (0–100) untuk satu semester, dihitung dari penilaian <strong>sumatif</strong> (formatif tidak digabung). ' +
            'Nilai rapor <strong>dihitung otomatis</strong> dari penilaian sumatif memakai rumus yang Anda pilih di bagian <strong>Rekap</strong>; rumus ikut tersimpan bersama nilai rapor. Angka nilai rapor tidak diubah di sini: untuk mengubahnya, ubah nilai pada penilaian di bagian <strong>Pelaksanaan</strong>. Perubahan baru dibaca wali kelas dan pimpinan setelah Anda menekan <strong>Simpan Nilai Rapor</strong>. Tanda <strong>T</strong> (TP dicapai optimal) dan <strong>R</strong> (TP perlu peningkatan) dipakai untuk deskripsi capaian di e-Rapor. ' +
            'Nilai rapor terlihat oleh Anda, wali kelas, Kepala Sekolah, dan Waka Kurikulum. Siswa dan orang tua baru melihatnya di portal bila Anda mengizinkan di bawah ini.</div>' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:13px">' +
            '<label style="display:flex;align-items:center;gap:6px;font-weight:normal"><input type="checkbox" id="nr-vis-siswa"' + (st.visSiswa ? ' checked' : '') + '> Izinkan <strong>siswa</strong> melihat nilai rapor</label>' +
            '<label style="display:flex;align-items:center;gap:6px;font-weight:normal"><input type="checkbox" id="nr-vis-ortu"' + (st.visOrtu ? ' checked' : '') + '> Izinkan <strong>orang tua</strong> melihat nilai rapor</label>' +
            '<span style="color:var(--color-text-muted);font-size:12px">Berlaku untuk semua siswa kelas ini; tersimpan saat Anda menekan Simpan Nilai Rapor.</span></div>' +
            '<div class="rc-filter-bar" style="justify-content:space-between"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<span id="nr-ringkas" style="font-size:13px">' + ringkasRumusHtml() + '</span>' +
            '</div>' +
            '<div style="display:flex;gap:8px"><button type="button" class="pen-btn" data-nr="unduh">⬇ Unduh Excel e-Rapor</button>' +
            '<button type="button" class="pen-btn pen-btn-primary" data-nr="simpan">Simpan Nilai Rapor</button></div></div>' +
            '<div id="nr-rumus">' + infoRumus() + '</div>' +
            '<div style="overflow-x:auto"><table class="rc-table"><thead><tr><th>Nama Siswa</th><th>Nilai Rapor</th><th>Tanda TP</th><th></th></tr></thead><tbody>' +
            roster.map(barisHtml).join('') + '</tbody></table></div>' +
            '<div id="nr-pesan" style="font-size:12px;margin-top:8px"></div>';
        for (const id of bukaIds) st.rows[id].terbuka = true;
    };
    gambar();

    // Setelah rumus (dipilih di Rekap) berubah: semua baris mengikuti rumus baru.
    const segarkanHitungan = () => {
        body.querySelectorAll('tr[data-sid]').forEach((tr) => {
            const sid = tr.dataset.sid; const row = st.rows[sid];
            const { hitung } = hitungSiswa(sid);
            const inp = tr.querySelector('.nr-nilai');
            if (hitung !== null) { row.nilai = String(hitung); if (inp) inp.value = row.nilai; }
            // Rumus LENGKAP tetapi siswa ini tidak punya data untuknya (mis. belum bernilai di TP terakhir): nilai sisa metode sebelumnya tidak boleh bertahan tanpa dasar.
            // Rumus yang BELUM lengkap dibiarkan (nilai yang ada tidak diubah; lihat peringatan rumus).
            else if (!rumusBelumLengkap() && row.nilai !== '') { row.nilai = ''; if (inp) inp.value = ''; }
            const pn = tr.querySelector('.nr-penanda'); if (pn) pn.innerHTML = penandaBelumSimpan(sid);
        });
        const rk = body.querySelector('#nr-ringkas'); if (rk) rk.innerHTML = ringkasRumusHtml();
        const ri = body.querySelector('#nr-rumus'); if (ri) ri.innerHTML = infoRumus();
    };
    const gambarUlangBaris = (sid) => {
        const tr = body.querySelector('tr[data-sid="' + CSS.escape(sid) + '"]'); if (!tr) return;
        const s = roster.find((x) => x.id === sid);
        const nextDetail = tr.nextElementSibling?.matches('.nr-detail') ? tr.nextElementSibling : null;
        const tmp = document.createElement('tbody'); tmp.innerHTML = barisHtml(s);
        nextDetail?.remove(); tr.replaceWith(...tmp.children);
    };
    const pesan = (t, ok = true) => { const p = body.querySelector('#nr-pesan'); if (p) { p.style.color = ok ? 'var(--color-success)' : 'var(--color-danger)'; p.textContent = t; } };
    // Rumus diubah di Rekap (atau disimpan dari sini): hitung ulang dan segarkan. Satu pendengar per muat; yang lama dilepas.
    _batalLangganan?.();
    _batalLangganan = langgan(() => { st.konfirmasiHapus = null; segarkanHitungan(); });

    // ── Peristiwa (delegasi pada body; dipasang sekali per muat) ──
    body.onchange = (e) => {
        const t = e.target;
        st.konfirmasiHapus = null;   // perubahan apa pun membatalkan konfirmasi penghapusan yang menunggu
        if (t.id === 'nr-vis-siswa') { st.visSiswa = !!t.checked; return; }
        if (t.id === 'nr-vis-ortu')  { st.visOrtu  = !!t.checked; return; }
        const tr = t.closest('tr'); const sid = tr?.dataset.sid ?? tr?.dataset.sidDetail; if (!sid || !st.rows[sid]) return;
        const row = st.rows[sid];
        if (t.classList.contains('nr-tp')) {
            const tp = t.dataset.tp; row.dasarNilai = false; row.optimal.delete(tp); row.perlu.delete(tp);
            if (t.value === 'T') row.optimal.add(tp); else if (t.value === 'R') row.perlu.add(tp);
            const sel = body.querySelector('tr[data-sid="' + CSS.escape(sid) + '"] .nr-tr'); if (sel) sel.innerHTML = ringkasTR(row);
            return;
        }
        if (t.classList.contains('nr-des-t')) { row.desT = t.value; row.sunting = true; return; }
        if (t.classList.contains('nr-des-r')) { row.desR = t.value; row.sunting = true; }
    };
    body.onclick = async (e) => {
        const btn = e.target.closest('[data-nr]'); if (!btn) return;
        const aksi = btn.dataset.nr;
        const sid = btn.closest('tr')?.dataset.sid ?? btn.closest('tr')?.dataset.sidDetail;
        if (aksi === 'detail' && sid) { st.rows[sid].terbuka = !st.rows[sid].terbuka; gambarUlangBaris(sid); return; }
        if (aksi === 'susun-des' && sid) {
            const row = st.rows[sid]; const d = susunDeskripsi({ optimal: [...row.optimal], perlu: [...row.perlu], tpById });
            row.desT = d.tertinggi; row.desR = d.terendah; row.sunting = false; gambarUlangBaris(sid); return;
        }
        if (aksi === 'unduh') { unduh(); return; }
        if (aksi === 'simpan') await simpan(btn);
    };

    async function simpan(btn) {
        if (_menyimpan) return;
        const baru = [], hapus = [];
        for (const s of roster) {
            const row = st.rows[s.id];
            if (row.nilai === '') { if (row.ada) hapus.push(s.id); continue; }
            if (!NILAI_OK(row.nilai)) { pesan('Nilai ' + s.nama + ' harus berupa angka 0–100.', false); toast('Ada nilai yang tidak valid', false); return; }
            const des = (row.desT || row.desR) ? { tertinggi: row.desT, terendah: row.desR } : susunDeskripsi({ optimal: [...row.optimal], perlu: [...row.perlu], tpById });
            baru.push({
                studentId: s.id, nilai_rapor: Number(row.nilai),
                metode: st.metode,
                rumus: { metode: st.metode, bobot: Object.fromEntries(sumatif.map((a) => [a.id, Number(st.bobot[a.id]) || 0])) },
                tp_optimal: [...row.optimal], tp_perlu: [...row.perlu],
                deskripsi_tertinggi: des.tertinggi, deskripsi_terendah: des.terendah,
                is_visible_siswa: st.visSiswa === true, is_visible_ortu: st.visOrtu === true,
            });
        }
        // Nilai yang dikosongkan = nilai rapor tersimpan DIHAPUS. Itu tidak boleh terjadi tanpa guru tahu: minta Simpan sekali lagi setelah menyebut siapa saja.
        const kunciHapus = hapus.join(',');
        if (hapus.length && st.konfirmasiHapus !== kunciHapus) {
            st.konfirmasiHapus = kunciHapus;
            const nama = hapus.map((id) => roster.find((x) => x.id === id)?.nama ?? '?').join(', ');
            pesan('⚠ Nilai rapor tersimpan ' + hapus.length + ' siswa akan DIHAPUS karena kolom nilainya kosong: ' + nama + '. Tekan Simpan Nilai Rapor sekali lagi untuk melanjutkan, atau isi nilainya dulu.', false);
            return;
        }
        _menyimpan = true; btn.disabled = true; btn.textContent = 'Menyimpan…';
        try {
            const tersimpanServer = await upsertGradeFinalBatch(ctx.schoolId, ctx.classId, ctx.subjectId, ctx.teacherId, ctx.year, ctx.semester, baru);
            // Angka rapor DITETAPKAN DATABASE (dari rumus dan nilai Pelaksanaan). Normalnya sama dengan yang dihitung layar; bila berbeda, layar mengikuti server dan guru diberi tahu.
            const beda = [];
            for (const sv of Array.isArray(tersimpanServer) ? tersimpanServer : []) {
                const kirim = baru.find((b) => b.studentId === sv.student_id);
                if (kirim && Number(sv.nilai_rapor) !== Number(kirim.nilai_rapor)) { kirim.nilai_rapor = Number(sv.nilai_rapor); beda.push(sv.student_id); }
            }
            await deleteGradeFinalForStudents(ctx.schoolId, ctx.classId, ctx.subjectId, ctx.teacherId, ctx.year, ctx.semester, hapus);
            for (const id of beda) st.rows[id].nilai = String(baru.find((b) => b.studentId === id).nilai_rapor);
            for (const b of baru) { simpanSiswa[b.studentId] = { ...(simpanSiswa[b.studentId] ?? {}), nilai_rapor: b.nilai_rapor }; const row = st.rows[b.studentId]; row.ada = true; row.desT = b.deskripsi_tertinggi || ''; row.desR = b.deskripsi_terendah || ''; }
            for (const id of hapus) st.rows[id].ada = false;
            for (const id of hapus) delete simpanSiswa[id];
            if (baru.length) catatTersimpan(idSumatif);   // juga memberi tahu Rekap: penanda "belum disimpan" hilang
            segarkanHitungan();
            toast('Nilai rapor tersimpan (' + baru.length + ' siswa' + (hapus.length ? ', ' + hapus.length + ' dihapus' : '') + ')');
            st.konfirmasiHapus = null;
            const infoBeda = beda.length ? ' PERHATIAN: server menetapkan angka yang berbeda dari layar untuk ' + beda.map((id) => roster.find((x) => x.id === id)?.nama ?? '?').join(', ') + '; angka server yang dipakai. Muat ulang halaman bila perlu.' : '';
            pesan('Tersimpan: ' + baru.length + ' siswa' + (hapus.length ? '; nilai rapor ' + hapus.length + ' siswa dihapus karena nilainya kosong.' : '.') + infoBeda, !beda.length);
        } catch (err) {
            toast('Gagal simpan: ' + (err.message || 'Terjadi kesalahan'), false);
            pesan('Gagal menyimpan: ' + (err.message || 'Terjadi kesalahan'), false);
        } finally { _menyimpan = false; btn.disabled = false; btn.textContent = 'Simpan Nilai Rapor'; }
    }

    function unduh() {
        const X = globalThis.XLSX;
        if (!X?.utils) { toast('Pustaka Excel belum termuat. Muat ulang halaman.', false); return; }
        const rapor = {};
        for (const s of roster) {
            const row = st.rows[s.id]; if (row.nilai === '' || !NILAI_OK(row.nilai)) continue;
            rapor[s.id] = { nilai_rapor: Number(row.nilai), tp_optimal: [...row.optimal], tp_perlu: [...row.perlu], deskripsi_tertinggi: row.desT, deskripsi_terendah: row.desR };
        }
        const { header, rows } = susunLembarERapor({ roster, tps, rapor });
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([header, ...rows]), 'e-Rapor');
        // Angka di berkas = angka di LAYAR saat ini. Bila ada yang belum disimpan, berkas berbeda dari yang tersimpan di server: dicatat di berkas dan diperingatkan.
        const belumSimpan = roster.filter((s) => {
            const row = st.rows[s.id]; const sv = simpanSiswa[s.id];
            return row.nilai !== '' ? (!sv || Math.round(Number(row.nilai) * 100) !== Math.round(Number(sv.nilai_rapor) * 100)) : !!row.ada;
        }).length;
        const status = statusSimpanRapor({ belumSimpan, rumusBelumSimpan: adaPerubahan(idSumatif) });
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(susunCatatanRapor({ metode: st.metode, status, waktu: new Date().toLocaleString('id-ID') })), 'Catatan');
        const aman = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]+/g, '-');
        X.writeFile(wb, 'nilai-rapor_' + aman(ctx.year) + '_S' + aman(ctx.semester) + '.xlsx');
        if (status.aman) pesan('Excel diunduh. ' + status.teks);
        else { pesan('Excel diunduh. ' + status.teks, false); toast('Excel diunduh, tetapi ada nilai yang belum disimpan', false); }
    }
}
