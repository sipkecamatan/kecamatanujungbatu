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
} from './api.js';
import { esc, fe, wireSimpleAccordion, localDateStr } from './tab-shared.js';

let _bkKasusCtx = null;

export async function initBkTab({ config, kasusEngine }) {
    const { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } = kasusEngine;

    wireSimpleAccordion('bk-att-card');
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('bk-att-start').value = firstOfMonth;
    document.getElementById('bk-att-end').value   = today;
    document.getElementById('bk-att-filter-btn').onclick = () => loadBkAttendanceRecap({ config });
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

        const html = activeProgs.map(prog => {
            const classAccordions = prog.classes
                .sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(r => {
                    const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                    const pctH = tot > 0 ? Math.round(r.HADIR / tot * 100) : 0;
                    const pctI = tot > 0 ? Math.round(r.IZIN  / tot * 100) : 0;
                    const pctS = tot > 0 ? Math.round(r.SAKIT / tot * 100) : 0;
                    const pctA = tot > 0 ? Math.round(r.ALPA  / tot * 100) : 0;
                    const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                    return `
                    <details class="att-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                        <summary class="att-accordion-summary">
                            <span class="att-acc-name">${esc(r.name)}</span>
                            <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                                <span style="color:${colH}">${pctH}%H</span>
                                <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                                <span style="color:var(--color-primary)">${pctS}%S</span>
                                <span style="color:var(--color-danger)">${pctA}%A</span>
                            </span>
                        </summary>
                        <div data-class-id="${esc(r.class_id)}"
                             data-date-start="${esc(dateStart ?? '')}"
                             data-date-end="${esc(dateEnd ?? '')}"
                             style="padding:4px 0">
                            <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                        </div>
                    </details>`;
                }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px">
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">${esc(prog.name)}</span>
                    <span class="att-acc-names">${prog.classes.length} kelas</span>
                </summary>
                <div style="padding:4px 0">${classAccordions}</div>
            </details>`;
        }).join('');

        container.innerHTML = html;

        container.querySelectorAll('details.wz-accordion-inner').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';
                const classId = body.dataset.classId;
                const dStart  = body.dataset.dateStart || null;
                const dEnd    = body.dataset.dateEnd   || null;
                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span class="att-acc-name">
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('div');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid = stuDet.dataset.studentId;
                            const ds  = stuDet.dataset.dateStart || null;
                            const de  = stuDet.dataset.dateEnd   || null;
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi.</p>';
                                return;
                            }
                            try {
                                const sessions = await getStudentAttendanceSessions(sid, ds, de, null, config.current_academic_year);
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA:  'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                // Dedup per block_group_id — satu pertemuan bisa punya beberapa schedule_id
                                // (multi-jam), ambil baris dengan status terburuk.
                                const PRIO = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };
                                const bgMap = new Map();
                                for (const s of sessions) {
                                    const bgId = s.schedule?.block_group_id ?? s.schedule?.schedule_id;
                                    const prev = bgMap.get(bgId);
                                    if (!prev || (PRIO[s.status] ?? 99) < (PRIO[prev.status] ?? 99))
                                        bgMap.set(bgId, s);
                                }
                                const grouped = [...bgMap.values()]
                                    .sort((a, b) => (b.schedule.session_date ?? '').localeCompare(a.schedule.session_date ?? ''));
                                const hadirCount    = grouped.filter(s => s.status === 'HADIR').length;
                                const absenSessions = grouped.filter(s => s.status !== 'HADIR');
                                const hadirInfo = hadirCount > 0
                                    ? `<div style="padding:6px 24px;font-size:12px;color:var(--color-text-muted);border-top:0.5px solid var(--color-border)">✓ ${hadirCount} sesi hadir</div>`
                                    : '';
                                const absenHtml = absenSessions.length
                                    ? absenSessions.map(s => `
                                        <div style="display:flex;align-items:center;gap:8px;padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                            <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">${esc(s.schedule.session_date)}</span>
                                            <span style="flex:1;font-size:12px;color:var(--color-text-muted)">${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}</span>
                                            <span style="font-size:11px;font-weight:600;color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                                ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                            </span>
                                        </div>`).join('')
                                    : `<div style="padding:6px 24px;font-size:12px;color:var(--color-text-muted);border-top:0.5px solid var(--color-border)">Tidak ada ketidakhadiran.</div>`;
                                sBody.innerHTML = absenHtml + hadirInfo;
                            } catch (err) {
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });
                } catch (err) {
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}
