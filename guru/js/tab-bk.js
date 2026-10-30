/**
 * @file guru/js/tab-bk.js
 * Tab BK — rekap kehadiran per program/kelas, dan kasus bimbingan.
 *
 * kasusEngine (makeKasusCtx, showKasusList, dll) diteruskan dari dashboard.js.
 */
import { supabase } from './api.js';
import {
    getPrograms, getAttendanceRecapPerClass,
    getWaliAttendanceSummary, getStudentAttendanceSessions,
    getClassStudents, getClassAttendanceByDate,
} from './api.js';
import { esc, fe, wireSimpleAccordion, localDateStr, buildPertemuanMeta } from './tab-shared.js';
import { downloadProdiExcel, downloadKelasExcel } from './tab-kaprodi.js';

/* global XLSX */

let _bkKasusCtx = null;

export async function initBkTab({ config, kasusEngine }) {
    const { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } = kasusEngine;

    wireSimpleAccordion('bk-att-card');
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('bk-att-start').value = firstOfMonth;
    document.getElementById('bk-att-end').value   = today;
    document.getElementById('bk-att-filter-btn').onclick = () => loadBkAttendanceRecap({ config });
    document.getElementById('bk-att-export-btn').onclick = () => downloadBkAttExcel({ config });
    await loadBkAttendanceRecap({ config });
    await _initBkKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList });
}

async function _initBkKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList }) {
    if (!_bkKasusCtx) {
        _bkKasusCtx = makeKasusCtx('bk-kasus', {});
        document.getElementById('bk-kasus-back-btn')
            .addEventListener('click', () => showKasusList(_bkKasusCtx));
        wireKasusDownloadButtons(_bkKasusCtx);
        document.getElementById('bk-kasus-filter-btn')
            ?.addEventListener('click', () => loadKasusList(false, _bkKasusCtx));
    }
    await loadKasusList(false, _bkKasusCtx);
}

async function loadBkAttendanceRecap({ config }) {
    const dateStart = document.getElementById('bk-att-start').value || null;
    const dateEnd   = document.getElementById('bk-att-end').value   || null;
    const container = document.getElementById('bk-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const [programs, rows] = await Promise.all([
            getPrograms(),
            getAttendanceRecapPerClass(dateStart, dateEnd),
        ]);

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada data kehadiran.</p>';
            return;
        }

        const renderClsRow = (r, idx) => {
            const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
            const pct  = tot > 0 ? Math.round(r.HADIR / tot * 100) : null;
            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--color-border,#e5e7eb)">
                <span style="min-width:24px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
                <span style="flex:1;font-size:13px">${esc(r.name)}</span>
                <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500;flex-shrink:0">
                    <span style="color:var(--color-success)">${r.HADIR}H</span>
                    <span style="color:var(--color-primary)">${r.SAKIT}S</span>
                    <span style="color:var(--color-warning,#f59e0b)">${r.IZIN}I</span>
                    <span style="color:var(--color-danger)">${r.ALPA}A</span>
                    <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                </span>
            </div>`;
        };

        if (!programs.length) {
            // SMA/SMP: tidak ada program keahlian — tampilkan semua kelas flat + tombol ↓ Excel per kelas
            const renderFlat = (r, idx) => {
                const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                const pct  = tot > 0 ? Math.round(r.HADIR / tot * 100) : null;
                const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--color-border,#e5e7eb)">
                    <span style="min-width:24px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
                    <span style="flex:1;font-size:13px">${esc(r.name)}</span>
                    <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500;flex-shrink:0">
                        <span style="color:var(--color-success)">${r.HADIR}H</span>
                        <span style="color:var(--color-primary)">${r.SAKIT}S</span>
                        <span style="color:var(--color-warning,#f59e0b)">${r.IZIN}I</span>
                        <span style="color:var(--color-danger)">${r.ALPA}A</span>
                        <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                    </span>
                    <button class="btn btn-secondary btn-sm bk-kls-excel-btn"
                        data-class-id="${esc(r.class_id)}" data-class-name="${esc(r.name)}"
                        style="font-size:11px;padding:2px 8px;flex-shrink:0">↓ Excel</button>
                </div>`;
            };
            const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'id'));
            container.innerHTML = `<div style="padding:4px 0">${sorted.map(renderFlat).join('')}</div>`;
            container.querySelectorAll('.bk-kls-excel-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const { classId, className: classLabel } = btn.dataset;
                    downloadKelasExcel({ classId, classLabel, config, btn });
                });
            });
        } else {
            const classMap = new Map(rows.map(r => [r.class_id, r]));
            const progMap  = new Map();
            for (const prog of programs) progMap.set(prog.program_id, { ...prog, classes: [] });

            const { data: classProgData, error: cpErr } = await supabase
                .from('classes')
                .select('class_id, program_id')
                .in('class_id', rows.map(r => r.class_id));
            if (cpErr) throw cpErr;

            for (const cp of classProgData ?? []) {
                const prog = progMap.get(cp.program_id);
                const cls  = classMap.get(cp.class_id);
                if (prog && cls) prog.classes.push(cls);
            }

            const activeProgs = [...progMap.values()].filter(p => p.classes.length > 0);
            container.innerHTML = activeProgs.map(prog => {
                const clsSorted = prog.classes.sort((a, b) => a.name.localeCompare(b.name, 'id'));
                return `
                <details class="att-accordion" style="margin-bottom:8px" data-program-id="${esc(prog.program_id)}">
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">${esc(prog.name)}</span>
                        <span class="att-acc-names">${clsSorted.length} kelas</span>
                        <button class="btn btn-secondary btn-sm bk-prodi-excel-btn"
                            data-program-id="${esc(prog.program_id)}"
                            data-program-name="${esc(prog.name)}"
                            style="font-size:11px;padding:2px 8px;margin-left:8px;flex-shrink:0">↓ Excel</button>
                    </summary>
                    <div style="padding:4px 0">${clsSorted.map(renderClsRow).join('')}</div>
                </details>`;
            }).join('');

            // Wire tombol Excel per prodi — stopPropagation agar tidak toggle accordion
            container.querySelectorAll('.bk-prodi-excel-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const { programId, programName } = btn.dataset;
                    downloadProdiExcel({ programId, prodiLabel: programName, config, btn });
                });
            });
        }

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

async function downloadBkAttExcel({ config }) {
    const btn = document.getElementById('bk-att-export-btn');
    btn.disabled = true;
    btn.textContent = 'Menyiapkan…';
    try {
        const academicYear = config.current_academic_year;
        const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };
        const PRIO         = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };

        const allRows = await getAttendanceRecapPerClass(null, null);
        if (!allRows.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }

        const wb = XLSX.utils.book_new();

        const results = await Promise.all(
            allRows.map(r => Promise.all([
                getClassStudents(r.class_id),
                getClassAttendanceByDate(r.class_id, academicYear, null, null),
            ]).then(([roster, detail]) => ({ cls: r, roster, detail })))
        );

        for (const { cls, roster, detail } of results.sort((a, b) => a.cls.name.localeCompare(b.cls.name, 'id'))) {
            if (!roster.length) continue;

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
        XLSX.writeFile(wb, `rekap_absensi_bk_${academicYear}.xlsx`);
    } catch (err) {
        alert('Gagal mengunduh: ' + fe(err));
    } finally {
        btn.disabled = false;
        btn.textContent = '↓ Unduh Excel';
    }
}
