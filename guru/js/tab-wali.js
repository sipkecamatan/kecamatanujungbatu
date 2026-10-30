/**
 * @file guru/js/tab-wali.js
 * Tab Wali Kelas — rekap absensi, keterlambatan, izin keluar, kasus siswa.
 *
 * Fungsi kasus engine (makeKasusCtx, showKasusList, dll) masih di dashboard.js
 * dan diteruskan via parameter `kasusEngine` sampai diekstrak terpisah.
 */
import {
    getWaliKelasInfo, getWaliAttendanceSummary, getWaliCoachingStudents,
    getWaliLateArrivals, getWaliExits, getClassAttendanceByDate,
} from './api.js';
import { pasangNilaiRaporKelas } from './nilai-rapor-kelas-ui.js';
import { esc, fe, buildAttStatCards, wireSimpleAccordion, localDateStr, buildPertemuanMeta } from './tab-shared.js';

/* global XLSX */

let _waliSummarySeq = 0;
let _waliRosterSeq  = 0;
let _waliKasusCtx   = null;

export async function initWaliTab({ currentUser, config, kasusEngine }) {
    const { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList, showKasusLoadError } = kasusEngine;

    wireSimpleAccordion('wali-att-card');
    const classId = currentUser.wali_kelas_class_id;
    if (!classId) {
        document.getElementById('wali-kasus-list-content').innerHTML =
            '<p class="hint">Anda belum ditugaskan sebagai wali kelas.</p>';
        return;
    }

    const info = await getWaliKelasInfo(classId);
    document.getElementById('wali-class-title').textContent =
        `Kelas Walian — ${info?.name ?? ''}`;
    pasangNilaiRaporKelas(document.getElementById('tab-wali_kelas'), {
        esc, mode: 'wali', classId, className: info?.name ?? '',
        tahun: config?.current_academic_year, semester: config?.current_semester,
    });

    const today    = localDateStr();
    const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
    document.getElementById('wali-date-start').value = monthAgo;
    document.getElementById('wali-date-end').value   = today;

    document.getElementById('wali-filter-btn').onclick = () => loadWaliSummary({ currentUser, config });

    document.getElementById('wali-recap-export').onclick = async () => {
        const btn = document.getElementById('wali-recap-export');
        btn.disabled = true;
        btn.textContent = 'Menyiapkan…';
        try {
            const dateStart    = document.getElementById('wali-date-start').value || null;
            const dateEnd      = document.getElementById('wali-date-end').value || null;
            const academicYear = config.current_academic_year;
            const className    = document.getElementById('wali-class-title')
                .textContent.replace('Kelas Walian — ', '').trim();

            const [students, detail] = await Promise.all([
                getWaliAttendanceSummary(classId, academicYear, dateStart, dateEnd, config.current_semester),
                getClassAttendanceByDate(classId, academicYear, dateStart, dateEnd, null),
            ]);

            const wb = XLSX.utils.book_new();
            const sheets = _buildWaliSheets({ students, detail, className, dateStart, dateEnd });
            for (const { name, aoa } of sheets)
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);

            XLSX.writeFile(wb, `rekap_wali_${className}_${dateStart ?? 'awal'}_${dateEnd ?? 'akhir'}.xlsx`);
        } catch (err) {
            alert('Gagal mengunduh: ' + fe(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Unduh Excel';
        }
    };

    await loadWaliSummary({ currentUser, config });
    await _initWaliKasusSection({ currentUser, config, makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList, showKasusLoadError });

    document.getElementById('wali-late-date-start').value = monthAgo;
    document.getElementById('wali-late-date-end').value   = today;
    document.getElementById('wali-exit-date-start').value = monthAgo;
    document.getElementById('wali-exit-date-end').value   = today;

    document.getElementById('wali-late-filter-btn').onclick = () => loadWaliLate({ currentUser });
    document.getElementById('wali-exit-filter-btn').onclick = () => loadWaliExit({ currentUser });

    await Promise.all([loadWaliLate({ currentUser }), loadWaliExit({ currentUser })]);
}

async function loadWaliLate({ currentUser }) {
    const classId   = currentUser.wali_kelas_class_id;
    const dateStart = document.getElementById('wali-late-date-start').value;
    const dateEnd   = document.getElementById('wali-late-date-end').value;
    const el        = document.getElementById('wali-late-content');
    if (!dateStart || !dateEnd) { el.innerHTML = '<p class="hint">Pilih rentang tanggal lalu klik Filter.</p>'; return; }
    el.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getWaliLateArrivals(classId, dateStart, dateEnd);
        if (!rows.length) { el.innerHTML = '<p class="hint">Tidak ada catatan keterlambatan pada rentang ini.</p>'; return; }
        el.innerHTML = `
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Jam Masuk</th><th>Keterangan</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => `<tr>
                    <td>${r.date}</td>
                    <td>${r.student_name}</td>
                    <td>${r.nis}</td>
                    <td>${r.arrival_time ?? '—'}</td>
                    <td>${r.reason || '—'}</td>
                </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        el.innerHTML = `<p class="hint error">Gagal memuat: ${fe(err)}</p>`;
    }
}

async function loadWaliExit({ currentUser }) {
    const classId   = currentUser.wali_kelas_class_id;
    const dateStart = document.getElementById('wali-exit-date-start').value;
    const dateEnd   = document.getElementById('wali-exit-date-end').value;
    const el        = document.getElementById('wali-exit-content');
    if (!dateStart || !dateEnd) { el.innerHTML = '<p class="hint">Pilih rentang tanggal lalu klik Filter.</p>'; return; }
    el.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getWaliExits(classId, dateStart, dateEnd);
        if (!rows.length) { el.innerHTML = '<p class="hint">Tidak ada catatan izin keluar pada rentang ini.</p>'; return; }
        el.innerHTML = `
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Jam Keluar</th><th>Jam Kembali</th><th>Keterangan</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => `<tr>
                    <td>${r.date}</td>
                    <td>${r.student_name}</td>
                    <td>${r.nis}</td>
                    <td>${r.exit_time ?? '—'}</td>
                    <td>${r.return_time}</td>
                    <td>${r.reason || '—'}</td>
                </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        el.innerHTML = `<p class="hint error">Gagal memuat: ${fe(err)}</p>`;
    }
}

async function _initWaliKasusSection({ currentUser, config, makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList, showKasusLoadError }) {
    const classId = currentUser.wali_kelas_class_id;
    const msgEl   = document.getElementById('wali-kasus-list-content');
    const seq = ++_waliRosterSeq;
    if (!_waliKasusCtx) {
        _waliKasusCtx = makeKasusCtx('wali-kasus', { studentIds: [] });
        document.getElementById('wali-kasus-back-btn')
            .addEventListener('click', () => showKasusList(_waliKasusCtx));
        wireKasusDownloadButtons(_waliKasusCtx);
        document.getElementById('wali-kasus-filter-btn')
            ?.addEventListener('click', () => _initWaliKasusSection({ currentUser, config, makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList, showKasusLoadError }));
    }
    const ctx = _waliKasusCtx;
    ++ctx.listSeq;
    ctx.extraQuery.studentIds = [];
    ctx.allCases = [];
    ctx.offset = 0;
    ctx.hasMore = false;
    showKasusList(ctx);
    msgEl.innerHTML = '<p class="hint">Memuat siswa dan kasus…</p>';
    try {
        const enrolled   = await getWaliCoachingStudents(classId, config.current_academic_year);
        if (seq !== _waliRosterSeq) return;
        const studentIds = enrolled.map(s => s.student_id);
        ctx.extraQuery.studentIds = studentIds;
        if (!studentIds.length) {
            msgEl.innerHTML = '<p class="hint">Tidak ada siswa terdaftar di kelas ini.</p>';
            return;
        }
        await loadKasusList(false, ctx);
    } catch (err) {
        if (seq !== _waliRosterSeq) return;
        showKasusLoadError(err, ctx, () => _initWaliKasusSection({ currentUser, config, makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList, showKasusLoadError }));
    }
}

/**
 * Bangun semua sheet Excel laporan wali kelas.
 * Mengembalikan array { name, aoa } siap di-append ke workbook XLSX.
 *
 * Sheet 1 — RINGKASAN KELAS  : dashboard angka + tren per tanggal + siswa perlu perhatian
 * Sheet 2 — ABSENSI SISWA    : matriks siswa × pertemuan (H/S/I/A), dibatasi rentang tanggal
 * Sheet 3 — REKAP PER SISWA  : aggregate H/S/I/A + detail ketidakhadiran per siswa
 * Sheet 4 — STATUS PERTEMUAN : daftar semua pertemuan tercatat urut tanggal
 *
 * Pertemuan yang BELUM diinput tidak muncul di data — tidak dihitung alpa.
 */
function _buildWaliSheets({ students, detail, className, dateStart, dateEnd }) {
    const PRIO        = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };
    const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };
    const ALPA_MIN    = 2;
    const HADIR_MIN   = 0.75;

    const periodeLabel = [dateStart, dateEnd].filter(Boolean).join(' s/d ') || 'Semua periode';

    // ── Pivot: student_id → block_group_id → status terburuk ─────────────────
    const pivot = {};
    for (const r of detail) {
        if (!r.block_group_id) continue;
        if (!pivot[r.student_id]) pivot[r.student_id] = {};
        const prev = pivot[r.student_id][r.block_group_id];
        if (prev === undefined || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
            pivot[r.student_id][r.block_group_id] = r.status;
    }

    // ── Meta pertemuan: urut kronologis, label tanggal ────────────────────────
    const { sortedIds, labelById } = buildPertemuanMeta(detail);

    // ── Tren per tanggal (untuk sheet Ringkasan) ──────────────────────────────
    // date → { pertemuan: Set<bgId>, H, S, I, A }
    const trendMap = new Map();
    for (const r of detail) {
        if (!r.block_group_id || !r.session_date) continue;
        if (!trendMap.has(r.session_date))
            trendMap.set(r.session_date, { ptm: new Set(), H: 0, S: 0, I: 0, A: 0 });
        const d = trendMap.get(r.session_date);
        d.ptm.add(r.block_group_id);
        // hitung status terburuk per (siswa, pertemuan) — pakai pivot yang sudah ada
    }
    // Isi H/S/I/A dari pivot (sudah deduplicated per pertemuan per siswa)
    for (const [sid, byBg] of Object.entries(pivot)) {
        for (const [bgId, st] of Object.entries(byBg)) {
            const date = detail.find(r => r.block_group_id === bgId)?.session_date;
            if (!date || !trendMap.has(date)) continue;
            const d = trendMap.get(date);
            if (st === 'HADIR') d.H++; else if (st === 'SAKIT') d.S++;
            else if (st === 'IZIN') d.I++; else if (st === 'ALPA') d.A++;
        }
    }

    // ── Rekap per siswa ───────────────────────────────────────────────────────
    const roster = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
    const rekapSiswa = roster.map(s => {
        const byBg = pivot[s.student_id] ?? {};
        let H = 0, S = 0, I = 0, A = 0;
        const details = [];
        for (const bgId of sortedIds) {
            const st = byBg[bgId];
            if (!st) continue;
            if (st === 'HADIR') H++; else if (st === 'SAKIT') S++;
            else if (st === 'IZIN') I++; else if (st === 'ALPA') A++;
            if (st !== 'HADIR') details.push(`${STATUS_HURUF[st]}(${labelById.get(bgId) ?? bgId})`);
        }
        const tot = H + S + I + A;
        const pct = tot > 0 ? H / tot : null;
        return { s, H, S, I, A, tot, pct, details };
    });

    // ── Sheet 1: RINGKASAN KELAS ──────────────────────────────────────────────
    const totalPtm   = sortedIds.length;
    const totalH     = rekapSiswa.reduce((acc, r) => acc + r.H, 0);
    const totalSIA   = rekapSiswa.reduce((acc, r) => acc + r.S + r.I + r.A, 0);
    const totalCatat = totalH + totalSIA;
    const pctHadir   = totalCatat > 0 ? (totalH / totalCatat * 100).toFixed(1) + '%' : '—';

    const s1 = [];
    s1.push([`LAPORAN KEHADIRAN — ${className}`]);
    s1.push([`Periode: ${periodeLabel}  |  Laporan untuk wali kelas`]);
    s1.push([]);
    s1.push(['JUMLAH SISWA', '', 'PERTEMUAN TERCATAT', '', 'CATATAN S/I/A']);
    s1.push([roster.length, '', totalPtm, '', totalSIA]);
    s1.push([]);
    s1.push(['TINGKAT HADIR KELAS', '', '', '', '']);
    s1.push([pctHadir]);
    s1.push([]);
    s1.push(['TREN KEHADIRAN PER TANGGAL']);
    s1.push(['Tanggal', 'Pertemuan', 'H', 'S', 'I', 'A', '% Hadir']);
    let trendH = 0, trendSIA = 0;
    for (const [date, d] of [...trendMap.entries()].sort()) {
        const tot = d.H + d.S + d.I + d.A;
        const pct = tot > 0 ? (d.H / tot * 100).toFixed(1) + '%' : '—';
        s1.push([date, d.ptm.size, d.H, d.S, d.I, d.A, pct]);
        trendH += d.H; trendSIA += d.S + d.I + d.A;
    }
    const trendTot = trendH + trendSIA;
    s1.push(['TOTAL', totalPtm, trendH, '', '', trendSIA,
        trendTot > 0 ? (trendH / trendTot * 100).toFixed(1) + '%' : '—']);
    s1.push([]);
    s1.push(['SISWA PERLU PERHATIAN  (% hadir < 75% atau alpa >= 2)']);
    s1.push(['Dihitung dari pertemuan yang sudah diinput. Pertemuan belum diinput TIDAK dihitung alpa.']);
    s1.push(['No', 'Nama Siswa', 'H', 'S', 'I', 'A', 'Total', '% Hadir', 'Catatan']);
    let noPerhatian = 0;
    for (const r of rekapSiswa) {
        if (r.A < ALPA_MIN && (r.pct === null || r.pct >= HADIR_MIN)) continue;
        noPerhatian++;
        const catatan = [];
        if (r.pct !== null && r.pct < HADIR_MIN)
            catatan.push(`% hadir ${Math.round(r.pct * 100)}% < 75%`);
        if (r.A >= ALPA_MIN) catatan.push(`alpa ${r.A}x`);
        s1.push([noPerhatian, r.s.full_name, r.H, r.S, r.I, r.A, r.tot,
            r.pct !== null ? Math.round(r.pct * 100) + '%' : '—',
            catatan.join(', ')]);
    }
    if (noPerhatian === 0)
        s1.push(['', 'Tidak ada siswa yang memerlukan perhatian khusus.']);

    // ── Sheet 2: ABSENSI SISWA ────────────────────────────────────────────────
    const s2 = [];
    s2.push([`ABSENSI SISWA — ${className}`]);
    s2.push([`Periode: ${periodeLabel}  |  Hanya pertemuan yang sudah diinput guru  |  H=Hadir S=Sakit I=Izin A=Alpa`]);
    s2.push([]);
    s2.push(['No', 'Nama Siswa', ...sortedIds.map(id => labelById.get(id)), 'H', 'S', 'I', 'A', '% Hadir']);
    for (let i = 0; i < roster.length; i++) {
        const r = rekapSiswa[i];
        const byBg = pivot[r.s.student_id] ?? {};
        s2.push([
            i + 1,
            r.s.full_name,
            ...sortedIds.map(id => STATUS_HURUF[byBg[id]] ?? ''),
            r.H, r.S, r.I, r.A,
            r.pct !== null ? Math.round(r.pct * 100) + '%' : '—',
        ]);
    }
    // Baris rekap bawah
    s2.push([]);
    const recapLabels = [['Hadir (H)', 'HADIR'], ['Sakit (S)', 'SAKIT'], ['Izin (I)', 'IZIN'], ['Alpa (A)', 'ALPA']];
    for (const [lbl, key] of recapLabels) {
        s2.push([lbl, '',
            ...sortedIds.map(id =>
                Object.values(pivot).filter(byBg => byBg[id] === key).length
            )]);
    }

    // ── Sheet 3: REKAP PER SISWA ──────────────────────────────────────────────
    const s3 = [];
    s3.push([`REKAP PER SISWA — ${className}`]);
    s3.push([`Periode: ${periodeLabel}`]);
    s3.push([]);
    s3.push(['No', 'Nama Siswa', 'H', 'S', 'I', 'A', 'Total', '% Hadir', 'Detail S/I/A']);
    for (let i = 0; i < roster.length; i++) {
        const r = rekapSiswa[i];
        s3.push([
            i + 1,
            r.s.full_name,
            r.H, r.S, r.I, r.A, r.tot,
            r.pct !== null ? Math.round(r.pct * 100) + '%' : '—',
            r.details.join('  |  ') || '-',
        ]);
    }
    // Total kelas
    const gH = rekapSiswa.reduce((a, r) => a + r.H, 0);
    const gS = rekapSiswa.reduce((a, r) => a + r.S, 0);
    const gI = rekapSiswa.reduce((a, r) => a + r.I, 0);
    const gA = rekapSiswa.reduce((a, r) => a + r.A, 0);
    const gTot = gH + gS + gI + gA;
    s3.push(['', 'TOTAL KELAS', gH, gS, gI, gA, gTot,
        gTot > 0 ? Math.round(gH / gTot * 100) + '%' : '—', '']);

    // ── Sheet 4: STATUS PERTEMUAN ─────────────────────────────────────────────
    const s4 = [];
    s4.push([`STATUS PERTEMUAN — ${className}`]);
    s4.push([`Periode: ${periodeLabel}  |  Hanya pertemuan yang sudah diinput (data belum diinput tidak muncul)`]);
    s4.push([]);
    s4.push(['No', 'ID Pertemuan', 'Tanggal', 'Jumlah Siswa Tercatat', 'H', 'S', 'I', 'A']);
    let noRow = 0;
    for (const bgId of sortedIds) {
        noRow++;
        const date = detail.find(r => r.block_group_id === bgId)?.session_date ?? '—';
        const rows = detail.filter(r => r.block_group_id === bgId);
        // ambil status terburuk per siswa untuk pertemuan ini
        const perSiswa = {};
        for (const r of rows) {
            const prev = perSiswa[r.student_id];
            if (prev === undefined || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
                perSiswa[r.student_id] = r.status;
        }
        const vals = Object.values(perSiswa);
        s4.push([
            noRow,
            bgId,
            date,
            vals.length,
            vals.filter(v => v === 'HADIR').length,
            vals.filter(v => v === 'SAKIT').length,
            vals.filter(v => v === 'IZIN').length,
            vals.filter(v => v === 'ALPA').length,
        ]);
    }

    return [
        { name: 'RINGKASAN KELAS',  aoa: s1 },
        { name: 'ABSENSI SISWA',    aoa: s2 },
        { name: 'REKAP PER SISWA',  aoa: s3 },
        { name: 'STATUS PERTEMUAN', aoa: s4 },
    ];
}

async function loadWaliSummary({ currentUser, config }) {
    const seq = ++_waliSummarySeq;
    const classId    = currentUser.wali_kelas_class_id;
    const academicYear = config.current_academic_year;
    const dateStart  = document.getElementById('wali-date-start').value || null;
    const dateEnd    = document.getElementById('wali-date-end').value   || null;
    const container  = document.getElementById('wali-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';

    try {
        const students = await getWaliAttendanceSummary(
            classId, academicYear, dateStart, dateEnd, config.current_semester
        );
        if (seq !== _waliSummarySeq) return;
        if (!students.length) {
            container.innerHTML = '<p class="hint">Belum ada siswa di kelas ini.</p>';
            return;
        }

        container.innerHTML = buildAttStatCards(students) + [...students]
            .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
            .map((s, idx) => {
                const tot   = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                const pct   = tot > 0 ? Math.round(s.HADIR / tot * 100) : null;
                const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--color-border,#e5e7eb)">
                    <span style="min-width:24px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
                    <span style="flex:1;font-size:13px">${esc(s.full_name)}</span>
                    <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500;flex-shrink:0">
                        <span style="color:var(--color-success)">${s.HADIR}H</span>
                        <span style="color:var(--color-warning,#f59e0b)">${s.IZIN}I</span>
                        <span style="color:var(--color-primary)">${s.SAKIT}S</span>
                        <span style="color:var(--color-danger)">${s.ALPA}A</span>
                        <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                    </span>
                </div>`;
            }).join('');

        document.getElementById('wali-recap-export').style.display = '';
    } catch (err) {
        if (seq !== _waliSummarySeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}
