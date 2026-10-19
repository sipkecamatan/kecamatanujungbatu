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
import { labelPenilaian, tpIdsPenilaian } from './penilaian-label.js';
import { METODE_RAPOR, totalBobot, hitungNilaiRapor, nilaiPerTp, tpTerakhir, sarankanTR, susunDeskripsi, susunLembarERapor } from './nilai-rapor.js';

let _seq = 0;            // nomor muat: hasil muat lama yang selesai terlambat dibuang
let _menyimpan = false;  // cegah simpan ganda

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
    // Tanpa penilaian sumatif tidak ada hitungan otomatis, tetapi guru tetap dapat mengisi nilai rapor manual: pesan tampil di atas tabel.
    const infoKosong = sumatif.length ? '' : '<p class="pen-placeholder" style="margin:0 0 10px">Belum ada penilaian sumatif untuk mata pelajaran ini, sehingga tidak ada hitungan otomatis. Anda tetap dapat mengisi nilai rapor secara manual.</p>';

    // ── Data turunan ──
    const asesmen = sumatif.map((a) => ({ id: a.id, tpIds: tpIdsPenilaian(a) }));
    const nilaiSiswa = {};
    for (const h of hasil) (nilaiSiswa[h.student_id] ??= {})[h.assessment_id] = h.nilai === null || h.nilai === undefined ? null : Number(h.nilai);
    const batasTp = Object.fromEntries(tps.map((t, i) => [t.id, batasTercapai(data.kktps[i])]));
    const tpById = Object.fromEntries(tps.map((t) => [t.id, t]));
    const adaBatas = (id) => batasTp[id] !== null && batasTp[id] !== undefined;
    const simpanSiswa = Object.fromEntries(tersimpan.map((r) => [r.student_id, r]));

    // Rumus yang ditetapkan guru (metode + bobot persen) tersimpan bersama nilai rapor, jadi tidak perlu diisi ulang setiap kali halaman dibuka.
    // Bobot milik penilaian yang sudah dihapus dibuang.
    const rumusSimpan = tersimpan.find((r) => r.rumus && typeof r.rumus === 'object')?.rumus ?? null;
    const idSumatif = new Set(sumatif.map((a) => a.id));
    const bobotSimpan = Object.fromEntries(Object.entries(rumusSimpan?.bobot ?? {})
        .filter(([id, v]) => idSumatif.has(id) && v !== null && v !== '' && Number.isFinite(Number(v))).map(([id, v]) => [id, Number(v)]));
    const st = {
        metode: rumusSimpan?.metode && METODE_RAPOR[rumusSimpan.metode] ? rumusSimpan.metode
            : (tersimpan[0]?.metode && METODE_RAPOR[tersimpan[0].metode] ? tersimpan[0].metode : 'RATA'),
        // Izin tampil di portal: aktif bila SEMUA nilai rapor tersimpan sudah diizinkan (berlaku untuk seluruh kelas ini pada mapel dan semester ini)
        visSiswa: tersimpan.length > 0 && tersimpan.every((r) => r.is_visible_siswa === true),
        visOrtu:  tersimpan.length > 0 && tersimpan.every((r) => r.is_visible_ortu === true),
        bobot: bobotSimpan,
        rows: {},
    };

    const hitungSiswa = (sid) => {
        const nilai = nilaiSiswa[sid] ?? {};
        const perTp = nilaiPerTp(asesmen, nilai);
        const tercapaiPerTp = {};
        for (const tp of Object.keys(perTp)) if (batasTp[tp] !== null && batasTp[tp] !== undefined) tercapaiPerTp[tp] = perTp[tp] >= batasTp[tp];
        let hitung = null;
        try { hitung = hitungNilaiRapor({ metode: st.metode, asesmen, nilai, bobot: st.bobot, tercapaiPerTp, urutanTp: tps.map((t) => t.id) }); } catch { hitung = null; }
        return { hitung, perTp, tr: sarankanTR(perTp, { batasTp, urutanTp: tps.map((t) => t.id) }) };
    };
    // Keadaan awal tiap siswa. Rumus guru menghitung nilai rapor OTOMATIS: baris yang tidak ditimpa guru (bukan MANUAL) mengikuti hasil rumus;
    // baris MANUAL (angka ditetapkan sendiri oleh guru) dibiarkan. Siswa yang belum punya nilai tersimpan juga diisi tanda T/R dan deskripsinya.
    // Rumus yang sedang tersimpan di server (pembanding). Mengubah metode atau bobot memengaruhi SEMUA siswa, jadi perubahannya harus tampak jelas sebelum disimpan.
    const salinBobot = () => Object.fromEntries(sumatif.map((a) => [a.id, Number(st.bobot[a.id]) || 0]));
    let rumusTersimpan = rumusSimpan ? { metode: st.metode, bobot: salinBobot() } : null;
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
    const catatanTerakhir = () => {
        if (st.metode !== 'TERAKHIR' || rumusBelumLengkap()) return '';
        const id = tpTerakhir(asesmen, tps.map((t) => t.id));
        return '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:12px">ℹ Nilai rapor memakai <strong>' + esc(tpById[id]?.kode_tp || 'TP terakhir') + '</strong> (TP terakhir yang punya penilaian sumatif). Siswa yang belum bernilai di TP itu dikosongkan; isi manual bila perlu.</div>';
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
        const sebagian = catatanSebagian() + catatanTerakhir();
        if (!rumusTersimpan) return peringatanLengkap + sebagian;
        const sama = rumusTersimpan.metode === st.metode && (st.metode !== 'BOBOT' || sumatif.every((a) => (rumusTersimpan.bobot[a.id] ?? 0) === (Number(st.bobot[a.id]) || 0)));
        if (sama) return peringatanLengkap + sebagian;
        const dari = METODE_RAPOR[rumusTersimpan.metode] ?? rumusTersimpan.metode;
        const ke = METODE_RAPOR[st.metode] ?? st.metode;
        const teks = rumusTersimpan.metode !== st.metode ? 'Rumus diubah dari <strong>' + esc(dari) + '</strong> menjadi <strong>' + esc(ke) + '</strong>' : 'Bobot rumus diubah';
        return '<div class="nr-rumus-info" style="margin:6px 0;padding:6px 10px;border:1px solid var(--color-warning, #d97706);border-radius:6px;font-size:12px">⚠ ' + teks +
            ' (belum disimpan). Nilai otomatis <strong>semua siswa</strong> ikut berubah; nilai manual tidak.</div>' + peringatanLengkap + sebagian;
    };
    for (const s of roster) {
        const r = simpanSiswa[s.id];
        const row = {
            nilai: r ? String(Number(r.nilai_rapor)) : '', manual: r?.metode === 'MANUAL',
            optimal: new Set(r?.tp_optimal ?? []), perlu: new Set(r?.tp_perlu ?? []),
            desT: r?.deskripsi_tertinggi ?? '', desR: r?.deskripsi_terendah ?? '',
            sunting: !!(r?.deskripsi_tertinggi || r?.deskripsi_terendah), ada: !!r, terbuka: false, dasarNilai: false,
        };
        const { hitung, tr } = hitungSiswa(s.id);
        if (!row.manual && hitung !== null) row.nilai = String(hitung);
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
    const statusBobotHtml = () => {
        const { total, sah } = totalBobot(sumatif, st.bobot);
        return sah ? '<span style="color:var(--color-success)">Total ' + total + '% ✓</span>'
            : '<span style="color:var(--color-danger)">Total ' + total + '% — ' + (total < 100 ? 'kurang ' : 'lebih ') + Math.round(Math.abs(100 - total) * 1000) / 1000 + '%; nilai otomatis baru muncul bila total tepat 100%</span>';
    };
    const bobotHtml = () => {
        if (st.metode !== 'BOBOT') return '';
        return '<div style="margin:8px 0;font-size:12px"><strong>Bobot tiap penilaian sumatif</strong> (isi sendiri; total harus 100%): <span id="nr-bobot-status">' + statusBobotHtml() + '</span>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
            sumatif.map((a) => '<label style="display:flex;align-items:center;gap:4px;font-weight:normal">' + esc(labelPenilaian(a, tpById)) +
                '<input type="number" class="nr-bobot" data-aid="' + esc(a.id) + '" min="0" max="100" value="' + esc(String(st.bobot[a.id] ?? 0)) + '" style="width:64px"></label>').join('') +
            '</div></div>';
    };
    // Penanda sederhana: angka di layar berbeda dari yang tersimpan di server (mis. penilaian berubah, atau bobot diubah) -> belum disimpan.
    const penandaBelumSimpan = (sid) => {
        const row = st.rows[sid]; const r = simpanSiswa[sid];
        const beda = row.nilai !== '' && (!r || Math.round(Number(row.nilai) * 100) !== Math.round(Number(r.nilai_rapor) * 100));
        return '<span class="nr-belum" style="display:block;font-size:11px;color:var(--color-warning, #d97706)">' + (beda ? '• belum disimpan' : '') + '</span>' +
            (row.manual ? '<button type="button" class="pen-btn pen-btn-sm" data-nr="otomatis" title="Kembali mengikuti hitungan rumus" style="font-size:11px">manual · ↺ otomatis</button>' : '');
    };
    const barisHtml = (s) => {
        const row = st.rows[s.id];
        const detail = row.terbuka ? detailHtml(s) : '';
        return '<tr data-sid="' + esc(s.id) + '"><td>' + esc(s.nama) + (s.nis ? ' <span style="color:var(--color-text-muted);font-size:11px">' + esc(s.nis) + '</span>' : '') + '</td>' +
            '<td><input type="number" class="nr-nilai" min="0" max="100" step="0.01" value="' + esc(row.nilai) + '" style="width:76px">' + '<span class="nr-penanda">' + penandaBelumSimpan(s.id) + '</span>' + '</td>' +
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
            'Nilai rapor <strong>dihitung otomatis</strong> dari penilaian sumatif memakai rumus (metode dan persentase bobot) yang Anda tentukan sendiri; rumus ikut tersimpan bersama nilai rapor. Anda dapat mengubah angka satu siswa (ditandai manual dan tidak ikut berubah lagi). Perubahan baru dibaca wali kelas dan pimpinan setelah Anda menekan <strong>Simpan Nilai Rapor</strong>. Tanda <strong>T</strong> (TP dicapai optimal) dan <strong>R</strong> (TP perlu peningkatan) dipakai untuk deskripsi capaian di e-Rapor. ' +
            'Nilai rapor terlihat oleh Anda, wali kelas, Kepala Sekolah, dan Waka Kurikulum. Siswa dan orang tua baru melihatnya di portal bila Anda mengizinkan di bawah ini.</div>' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:13px">' +
            '<label style="display:flex;align-items:center;gap:6px;font-weight:normal"><input type="checkbox" id="nr-vis-siswa"' + (st.visSiswa ? ' checked' : '') + '> Izinkan <strong>siswa</strong> melihat nilai rapor</label>' +
            '<label style="display:flex;align-items:center;gap:6px;font-weight:normal"><input type="checkbox" id="nr-vis-ortu"' + (st.visOrtu ? ' checked' : '') + '> Izinkan <strong>orang tua</strong> melihat nilai rapor</label>' +
            '<span style="color:var(--color-text-muted);font-size:12px">Berlaku untuk semua siswa kelas ini; tersimpan saat Anda menekan Simpan Nilai Rapor.</span></div>' +
            '<div class="rc-filter-bar" style="justify-content:space-between"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<select id="nr-metode">' + Object.entries(METODE_RAPOR).map(([k, v]) => '<option value="' + k + '"' + (st.metode === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>' +
            '</div>' +
            '<div style="display:flex;gap:8px"><button type="button" class="pen-btn" data-nr="unduh">⬇ Unduh Excel e-Rapor</button>' +
            '<button type="button" class="pen-btn pen-btn-primary" data-nr="simpan">Simpan Nilai Rapor</button></div></div>' +
            '<div id="nr-bobot">' + bobotHtml() + '</div><div id="nr-rumus">' + infoRumus() + '</div>' +
            '<div style="overflow-x:auto"><table class="rc-table"><thead><tr><th>Nama Siswa</th><th>Nilai Rapor</th><th>Tanda TP</th><th></th></tr></thead><tbody>' +
            roster.map(barisHtml).join('') + '</tbody></table></div>' +
            '<div id="nr-pesan" style="font-size:12px;margin-top:8px"></div>';
        for (const id of bukaIds) st.rows[id].terbuka = true;
    };
    gambar();

    // Setelah bobot/metode berubah: baris otomatis mengikuti rumus baru; baris manual dibiarkan.
    const segarkanHitungan = () => {
        body.querySelectorAll('tr[data-sid]').forEach((tr) => {
            const sid = tr.dataset.sid; const row = st.rows[sid];
            if (!row.manual) { const { hitung } = hitungSiswa(sid); if (hitung !== null) { row.nilai = String(hitung); const inp = tr.querySelector('.nr-nilai'); if (inp) inp.value = row.nilai; } }
            const pn = tr.querySelector('.nr-penanda'); if (pn) pn.innerHTML = penandaBelumSimpan(sid);
        });
        // Isian bobot TIDAK digambar ulang saat guru mengetik/Tab (fokus akan hilang); hanya teks total yang diperbarui. Digambar ulang hanya bila metode berganti.
        const b = body.querySelector('#nr-bobot');
        if (b) {
            const st2 = body.querySelector('#nr-bobot-status');
            if (st.metode === 'BOBOT' && st2) st2.innerHTML = statusBobotHtml(); else b.innerHTML = bobotHtml();
        }
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

    // ── Peristiwa (delegasi pada body; dipasang sekali per muat) ──
    body.onchange = (e) => {
        const t = e.target;
        if (t.id === 'nr-metode') { st.metode = t.value; segarkanHitungan(); return; }
        if (t.id === 'nr-vis-siswa') { st.visSiswa = !!t.checked; return; }
        if (t.id === 'nr-vis-ortu')  { st.visOrtu  = !!t.checked; return; }
        if (t.classList.contains('nr-bobot')) { st.bobot[t.dataset.aid] = parseFloat(t.value) || 0; segarkanHitungan(); return; }
        const tr = t.closest('tr'); const sid = tr?.dataset.sid ?? tr?.dataset.sidDetail; if (!sid || !st.rows[sid]) return;
        const row = st.rows[sid];
        if (t.classList.contains('nr-nilai')) {
            // Mengubah angka = menetapkan sendiri (manual), kecuali angkanya sama dengan hasil rumus. Dikosongkan = tidak ada nilai rapor (dihapus saat disimpan).
            row.nilai = t.value; const { hitung } = hitungSiswa(sid);
            row.manual = !(t.value !== '' && hitung !== null && Number(t.value) === hitung);
            const pn = tr.querySelector('.nr-penanda'); if (pn) pn.innerHTML = penandaBelumSimpan(sid);
            return;
        }
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
        if (aksi === 'otomatis' && sid) {
            const row = st.rows[sid]; const { hitung } = hitungSiswa(sid);
            if (hitung === null) { pesan(rumusBelumLengkap() ? 'Rumus belum lengkap: ' + rumusBelumLengkap() + '.' : 'Belum ada nilai penilaian untuk dihitung.', false); return; }
            row.manual = false; row.nilai = String(hitung); gambarUlangBaris(sid); return;
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
                metode: row.manual ? 'MANUAL' : st.metode,
                rumus: { metode: st.metode, bobot: Object.fromEntries(sumatif.map((a) => [a.id, Number(st.bobot[a.id]) || 0])) },
                tp_optimal: [...row.optimal], tp_perlu: [...row.perlu],
                deskripsi_tertinggi: des.tertinggi, deskripsi_terendah: des.terendah,
                is_visible_siswa: st.visSiswa === true, is_visible_ortu: st.visOrtu === true,
            });
        }
        _menyimpan = true; btn.disabled = true; btn.textContent = 'Menyimpan…';
        try {
            await upsertGradeFinalBatch(ctx.schoolId, ctx.classId, ctx.subjectId, ctx.teacherId, ctx.year, ctx.semester, baru);
            await deleteGradeFinalForStudents(ctx.schoolId, ctx.classId, ctx.subjectId, ctx.teacherId, ctx.year, ctx.semester, hapus);
            for (const b of baru) { simpanSiswa[b.studentId] = { ...(simpanSiswa[b.studentId] ?? {}), nilai_rapor: b.nilai_rapor }; const row = st.rows[b.studentId]; row.ada = true; row.desT = b.deskripsi_tertinggi || ''; row.desR = b.deskripsi_terendah || ''; }
            for (const id of hapus) st.rows[id].ada = false;
            for (const id of hapus) delete simpanSiswa[id];
            if (baru.length) rumusTersimpan = { metode: st.metode, bobot: salinBobot() };
            segarkanHitungan();
            toast('Nilai rapor tersimpan (' + baru.length + ' siswa' + (hapus.length ? ', ' + hapus.length + ' dihapus' : '') + ')');
            pesan('Tersimpan: ' + baru.length + ' siswa.');
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
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
            ['Catatan'],
            ['Susunan kolom mengikuti deskripsi di Panduan e-Rapor SMK 2025: nilai 0–100 dan huruf T (TP dicapai optimal) atau R (TP perlu peningkatan) pada kolom TP.'],
            ['BELUM dicocokkan dengan berkas "Format Nilai Kelas" resmi hasil unduhan aplikasi e-Rapor. Salin nilai ke berkas format resmi bila susunannya berbeda.'],
        ]), 'Catatan');
        const aman = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]+/g, '-');
        X.writeFile(wb, 'nilai-rapor_' + aman(ctx.year) + '_S' + aman(ctx.semester) + '.xlsx');
    }
}
