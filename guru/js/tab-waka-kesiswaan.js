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
    getWaliAttendanceSummary, getStudentAttendanceSessions,
    getLateArrivalsByRange, getCoachingCasesCount,
} from './api.js';
import { esc, fe, wireSimpleAccordion, localDateStr } from './tab-shared.js';

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
    document.getElementById('wk-att-filter-btn').onclick = () => loadWkAttendanceRecap({ config });

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

        const html = activeProgs.map(prog => {
            const classAccordions = prog.classes
                .sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(r => {
                    const tot  = r.total;
                    const pctH = tot > 0 ? Math.round(r.HADIR / tot * 100) : 0;
                    const pctI = tot > 0 ? Math.round(r.IZIN  / tot * 100) : 0;
                    const pctS = tot > 0 ? Math.round(r.SAKIT / tot * 100) : 0;
                    const pctA = tot > 0 ? Math.round(r.ALPA  / tot * 100) : 0;
                    const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                    const safeId = r.class_id.replace(/[^a-z0-9]/gi, '_');
                    return `
                    <details class="att-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                        <summary class="att-accordion-summary">
                            <span>${esc(r.name)}</span>
                            <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                                <span style="color:${colH}">${pctH}%H</span>
                                <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                                <span style="color:var(--color-primary)">${pctS}%S</span>
                                <span style="color:var(--color-danger)">${pctA}%A</span>
                            </span>
                        </summary>
                        <div id="wkdet-body-${safeId}"
                             data-class-id="${esc(r.class_id)}"
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
                    const students = await getWaliAttendanceSummary(classId, config.current_academic_year, dStart, dEnd);
                    if (requestSeq !== _wkAttendanceRequestSeq) return;
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            const safeId = s.student_id.replace(/[^a-z0-9]/gi, '_');
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
                                <div id="wkstu-body-${safeId}" style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('[id^="wkstu-body-"]');
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
                                if (requestSeq !== _wkAttendanceRequestSeq) return;
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)', IZIN: 'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)', ALPA: 'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                const grouped = [];
                                const seen = new Map();
                                for (const s of sessions) {
                                    const key = s.schedule.schedule_id ?? s.attendance_id;
                                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                                }
                                sBody.innerHTML = grouped.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)}${s.schedule.session_start ? ` · ${esc(s.schedule.session_start.slice(0, 5))}` : ''}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                        </span>
                                        <span style="font-size:11px;font-weight:600;color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                        </span>
                                    </div>`).join('');
                            } catch (err) {
                                if (requestSeq !== _wkAttendanceRequestSeq) return;
                                delete sBody.dataset.loaded;
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });
                } catch (err) {
                    if (requestSeq !== _wkAttendanceRequestSeq) return;
                    delete body.dataset.loaded;
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        if (requestSeq !== _wkAttendanceRequestSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
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
