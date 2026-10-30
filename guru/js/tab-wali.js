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

            const [students, detail] = await Promise.all([
                getWaliAttendanceSummary(classId, academicYear, null, null, null),
                getClassAttendanceByDate(classId, academicYear, null, null, null),
            ]);

            const PRIO = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };
            const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };

            // Pivot per pertemuan (block_group_id), ambil status terburuk
            const pivot = {};
            for (const r of detail) {
                if (!r.block_group_id) continue;
                if (!pivot[r.student_id]) pivot[r.student_id] = {};
                const prev = pivot[r.student_id][r.block_group_id];
                if (prev === undefined || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
                    pivot[r.student_id][r.block_group_id] = r.status;
            }

            const { sortedIds, labelById } = buildPertemuanMeta(detail);
            const roster = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
            const header   = ['No', 'Nama', ...sortedIds.map(id => labelById.get(id)), 'H', 'I', 'S', 'A', 'Persentase'];
            const dataRows = roster.map((s, idx) => {
                const byBg = pivot[s.student_id] ?? {};
                let H = 0, I = 0, S = 0, A = 0;
                for (const st of Object.values(byBg)) {
                    if (st === 'HADIR') H++; else if (st === 'IZIN') I++;
                    else if (st === 'SAKIT') S++; else if (st === 'ALPA') A++;
                }
                const tot = H + I + S + A;
                const pct = tot > 0 ? Math.round(H / tot * 100) + '%' : '—';
                return [idx + 1, s.full_name,
                    ...sortedIds.map(id => STATUS_HURUF[byBg[id]] ?? ''),
                    H, I, S, A, pct];
            });

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...dataRows]), 'Rekap Kehadiran');

            const className = document.getElementById('wali-class-title')
                .textContent.replace('Kelas Walian — ', '').trim();
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
