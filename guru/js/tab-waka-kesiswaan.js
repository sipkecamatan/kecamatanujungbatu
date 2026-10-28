/**
 * @file guru/js/tab-waka-kesiswaan.js
 * Tab Waka Kesiswaan — rekap absensi semua kelas, rekap keterlambatan,
 * ringkasan kasus bimbingan.
 *
 * kasusEngine diteruskan dari dashboard.js.
 */
import { supabase } from './api.js';
import {
    getPrograms, getAttendanceRecapPerClass,
    getClassStudents, getClassAttendanceByDate,
    getLateArrivalsByRange, getCoachingCasesCount,
} from './api.js';
import { esc, fe, wireSimpleAccordion, localDateStr, buildPertemuanMeta } from './tab-shared.js';

export let wkKasusCtx = null;
let _wkAttendanceRequestSeq = 0;
let _wkLateRequestSeq       = 0;

export async function initWakaKesiswaanTab({ config, kasusEngine }) {
    const { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } = kasusEngine;

    wireSimpleAccordion('wk-att-card');
    wireSimpleAccordion('wk-late-card');
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('wk-att-start').value = firstOfMonth;
    document.getElementById('wk-att-end').value   = today;
    document.getElementById('wk-att-filter-btn').onclick  = () => loadWkAttendanceRecap({ config });
    document.getElementById('wk-att-export-btn').onclick  = () => downloadWkAttExcel({ config });

    document.getElementById('wk-late-start').value = firstOfMonth;
    document.getElementById('wk-late-end').value   = today;
    document.getElementById('wk-late-filter-btn').onclick = () => loadWkLateRecap({ config });

    await loadWkAttendanceRecap({ config });
    await loadWkLateRecap({ config });
    await _initWakaKesiswaanKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList });
}

async function _initWakaKesiswaanKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList }) {
    if (!wkKasusCtx) {
        wkKasusCtx = makeKasusCtx('wk-kasus', {});
        document.getElementById('wk-kasus-back-btn')
            .addEventListener('click', () => showKasusList(wkKasusCtx));
        wireKasusDownloadButtons(wkKasusCtx);
        document.getElementById('wk-kasus-filter-btn')
            ?.addEventListener('click', () => loadKasusList(false, wkKasusCtx));
    }
    await loadKasusList(false, wkKasusCtx);
    await renderWkCount();
}

export async function renderWkCount() {
    const rekapEl = document.getElementById('wk-kasus-count-rekap');
    if (!rekapEl) return;
    try {
        const counts = await getCoachingCasesCount();
        const lbl    = 'font-size:11px;color:var(--color-text-muted);margin-top:2px';
        rekapEl.style.display = '';
        rekapEl.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-primary)">${counts.OPEN ?? 0}</div>
                    <div style="${lbl}">Terbuka</div>
                </div>
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-warning,#f59e0b)">${counts.UNDER_REVIEW ?? 0}</div>
                    <div style="${lbl}">Ditinjau</div>
                </div>
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-danger)">${counts.INTERVENTION ?? 0}</div>
                    <div style="${lbl}">Intervensi</div>
                </div>
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-success)">${counts.MONITORING ?? 0}</div>
                    <div style="${lbl}">Monitoring</div>
                </div>
            </div>`;
    } catch (err) {
        console.error('[renderWkCount]', err);
        rekapEl.style.display = '';
        rekapEl.innerHTML = `<div class="alert alert-danger">Gagal memuat rekap kasus: ${esc(fe(err))}</div>`;
    }
}

async function loadWkAttendanceRecap({ config }) {
    const requestSeq = ++_wkAttendanceRequestSeq;
    const dateStart  = document.getElementById('wk-att-start').value || null;
    const dateEnd    = document.getElementById('wk-att-end').value   || null;
    const container  = document.getElementById('wk-att-recap');
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const [programs, rows] = await Promise.all([
            getPrograms(),
            getAttendanceRecapPerClass(dateStart, dateEnd),
        ]);
        if (requestSeq !== _wkAttendanceRequestSeq) return;

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada data kehadiran.</p>';
            return;
        }

        const classMap = new Map(rows.map(r => [r.class_id, r]));
        const progMap  = new Map();
        for (const prog of programs) progMap.set(prog.program_id, { ...prog, classes: [] });

        const { data: classProgData, error: cpErr } = await supabase
            .from('classes').select('class_id, program_id')
            .in('class_id', rows.map(r => r.class_id));
        if (cpErr) throw cpErr;

        for (const cp of classProgData ?? []) {
            const prog = progMap.get(cp.program_id);
            const cls  = classMap.get(cp.class_id);
            if (prog && cls) prog.classes.push(cls);
        }

        const activeProgs = [...progMap.values()].filter(p => p.classes.length > 0);

        container.innerHTML = activeProgs.map(prog => {
            const rows = prog.classes.sort((a, b) => a.name.localeCompare(b.name, 'id'));
            const classRows = rows.map((r, idx) => {
                const tot   = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                const pct   = tot > 0 ? Math.round(r.HADIR / tot * 100) : null;
                const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--color-border,#e5e7eb)">
                    <span style="min-width:24px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
                    <span style="flex:1;font-size:13px">${esc(r.name)}</span>
                    <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500;flex-shrink:0">
                        <span style="color:var(--color-success)">${r.HADIR}H</span>
                        <span style="color:var(--color-warning,#f59e0b)">${r.IZIN}I</span>
                        <span style="color:var(--color-primary)">${r.SAKIT}S</span>
                        <span style="color:var(--color-danger)">${r.ALPA}A</span>
                        <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                    </span>
                </div>`;
            }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px">
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">${esc(prog.name)}</span>
                    <span class="att-acc-names">${rows.length} kelas</span>
                </summary>
                <div style="padding:4px 0">${classRows}</div>
            </details>`;
        }).join('');

        document.getElementById('wk-att-export-btn').style.display = '';

    } catch (err) {
        if (requestSeq !== _wkAttendanceRequestSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

async function downloadWkAttExcel({ config }) {
    const btn = document.getElementById('wk-att-export-btn');
    btn.disabled = true;
    btn.textContent = 'Menyiapkan…';
    try {
        const academicYear = config.current_academic_year;
        const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };
        const PRIO         = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };

        const allRows = await getAttendanceRecapPerClass(null, null);
        if (!allRows.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }

        const wb = XLSX.utils.book_new();

        // Fetch semua kelas paralel
        const results = await Promise.all(
            allRows.map(r => Promise.all([
                getClassStudents(r.class_id),
                getClassAttendanceByDate(r.class_id, academicYear, null, null),
            ]).then(([roster, detail]) => ({ cls: r, roster, detail })))
        );

        for (const { cls, roster, detail } of results.sort((a, b) => a.cls.name.localeCompare(b.cls.name, 'id'))) {
            if (!roster.length) continue;

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
            const sorted = [...roster].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

            const header = ['No', 'Nama', 'NIS', ...sortedIds.map(id => labelById.get(id)), 'H', 'I', 'S', 'A', '%Hadir'];
            const dataRows = sorted.map((s, idx) => {
                const byBg = pivot[s.student_id] ?? {};
                let H = 0, I = 0, S = 0, A = 0;
                for (const st of Object.values(byBg)) {
                    if (st === 'HADIR') H++; else if (st === 'IZIN') I++;
                    else if (st === 'SAKIT') S++; else if (st === 'ALPA') A++;
                }
                const tot = H + I + S + A;
                const pct = tot > 0 ? Math.round(H / tot * 100) + '%' : '—';
                return [idx + 1, s.full_name, s.nis ?? '',
                    ...sortedIds.map(id => STATUS_HURUF[byBg[id]] ?? ''),
                    H, I, S, A, pct];
            });

            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...dataRows]), cls.name.slice(0, 31));
        }

        if (!wb.SheetNames.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }
        XLSX.writeFile(wb, `rekap_absensi_semua_kelas_${academicYear}.xlsx`);
    } catch (err) {
        alert('Gagal mengunduh: ' + fe(err));
    } finally {
        btn.disabled = false;
        btn.textContent = 'Unduh Excel';
    }
}

async function loadWkLateRecap({ config }) {
    const requestSeq = ++_wkLateRequestSeq;
    const start      = document.getElementById('wk-late-start').value;
    const end        = document.getElementById('wk-late-end').value;
    const container  = document.getElementById('wk-late-recap');
    if (!start || !end || start > end) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getLateArrivalsByRange(start, end, config?.current_academic_year ?? null);
        if (requestSeq !== _wkLateRequestSeq) return;
        if (!rows.length) {
            container.innerHTML = '<p class="hint">Tidak ada catatan keterlambatan pada rentang ini.</p>';
            return;
        }
        const fmtDisp = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        container.innerHTML = `
            <p class="hint" style="margin-bottom:8px">${rows.length} catatan ditemukan</p>
            <div style="overflow-x:auto">
            <table class="table" style="width:100%">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Kelas</th><th>Jam Datang</th><th>Alasan</th><th>Dicatat Oleh</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td style="white-space:nowrap">${fmtDisp(r.date)}</td>
                        <td>${esc(r.student_name)}</td>
                        <td>${esc(r.nis)}</td>
                        <td>${esc(r.class_name)}</td>
                        <td style="white-space:nowrap">${r.arrival_time.slice(0, 5)}</td>
                        <td>${esc(r.reason || '—')}</td>
                        <td>${esc(r.recorder)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        if (requestSeq !== _wkLateRequestSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}
