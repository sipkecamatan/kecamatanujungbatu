/**
 * @file guru/js/tab-waka-kesiswaan.js
 * Tab Waka Kesiswaan — rekap absensi semua kelas, rekap keterlambatan,
 * ringkasan kasus bimbingan.
 *
 * kasusEngine diteruskan dari dashboard.js.
 */
import {
    supabase,
    getPrograms, getAttendanceRecapPerClass,
    getClassesByProgram, getWaliAttendanceSummary, getClassScheduleFull,
    getLateArrivalsByRange, getCoachingCasesCount,
} from './api.js';
import { esc, fe, wireSimpleAccordion, localDateStr } from './tab-shared.js';
import { downloadProdiExcel, MONTHS_RANGE } from './tab-kaprodi.js';
import { buildWaliSheetsMonthly } from './tab-wali.js';

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
                        <span style="color:var(--color-primary)">${r.SAKIT}S</span>
                        <span style="color:var(--color-warning,#f59e0b)">${r.IZIN}I</span>
                        <span style="color:var(--color-danger)">${r.ALPA}A</span>
                        <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                    </span>
                </div>`;
            }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px" data-program-id="${esc(prog.program_id)}">
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">${esc(prog.name)}</span>
                    <span class="att-acc-names">${rows.length} kelas</span>
                    <button class="btn btn-secondary btn-sm wk-prodi-excel-btn"
                        data-program-id="${esc(prog.program_id)}"
                        data-program-name="${esc(prog.name)}"
                        style="font-size:11px;padding:2px 8px;margin-left:8px;flex-shrink:0">↓ Excel</button>
                </summary>
                <div style="padding:4px 0">${classRows}</div>
            </details>`;
        }).join('');

        // Wire tombol Excel per prodi — stopPropagation agar tidak toggle accordion
        container.querySelectorAll('.wk-prodi-excel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { programId, programName } = btn.dataset;
                downloadProdiExcel({ programId, prodiLabel: programName, config, btn });
            });
        });

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

        const programs = await getPrograms();
        const allClassArrays = await Promise.all(programs.map(p => getClassesByProgram(p.program_id)));
        const allClasses = allClassArrays.flat().sort((a, b) => a.name.localeCompare(b.name, 'id'));
        if (!allClasses.length) { alert('Belum ada kelas untuk diunduh.'); return; }

        const clsData = await Promise.all(allClasses.map(async c => {
            const [students, scheduleRows, ...monthlyRekaps] = await Promise.all([
                getWaliAttendanceSummary(c.class_id, academicYear, null, null, config.current_semester),
                getClassScheduleFull(c.class_id, academicYear, null, null),
                ...MONTHS_RANGE.map(([ds, de]) =>
                    getWaliAttendanceSummary(c.class_id, academicYear, ds, de, null)
                ),
            ]);
            const monthlyMap = {};
            MONTHS_RANGE.forEach(([ds], i) => {
                const mon = ds.slice(0, 7);
                const m = new Map();
                for (const r of monthlyRekaps[i])
                    m.set(r.student_id, { H: r.HADIR, S: r.SAKIT, I: r.IZIN, A: r.ALPA, tot: r.total });
                monthlyMap[mon] = m;
            });
            return { cls: c, students, scheduleRows, monthlyMap };
        }));

        const wb = XLSX.utils.book_new();

        // Sheet RINGKASAN — semua siswa, dikelompokkan per kelas
        const allStudents     = clsData.flatMap(d => d.students);
        const allScheduleRows = clsData.flatMap(d => d.scheduleRows);
        const combinedMonthly = {};
        for (const [ds] of MONTHS_RANGE) {
            const mon = ds.slice(0, 7);
            const m = new Map();
            for (const d of clsData)
                for (const [sid, v] of (d.monthlyMap[mon] ?? new Map()))
                    m.set(sid, v);
            combinedMonthly[mon] = m;
        }
        const classGroups = clsData
            .filter(d => d.students.length)
            .map(d => ({ name: d.cls.name, studentIds: new Set(d.students.map(s => s.student_id)) }));

        if (allStudents.length) {
            const sheets = buildWaliSheetsMonthly({
                students: allStudents, scheduleRows: allScheduleRows,
                monthlyMap: combinedMonthly, className: 'Semua Kelas', academicYear,
                classGroups,
            });
            XLSX.utils.book_append_sheet(wb, sheets[0].ws, 'RINGKASAN');
        }

        // Sheet per kelas — agregat tahunan saja (No|Nama|NIS|H|S|I|A|%)
        for (const { cls, students } of clsData) {
            if (!students.length) continue;
            const sorted = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
            const header = ['No', 'Nama', 'NIS', 'H', 'S', 'I', 'A', '%Hadir'];
            const dataRows = sorted.map((s, idx) => {
                const tot = s.HADIR + s.SAKIT + s.IZIN + s.ALPA;
                const pct = tot > 0 ? Math.round(s.HADIR / tot * 100) + '%' : '—';
                return [idx + 1, s.full_name, s.nis ?? '', s.HADIR, s.SAKIT, s.IZIN, s.ALPA, pct];
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...dataRows]), cls.name.slice(0, 31));
        }

        if (!wb.SheetNames.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }
        XLSX.writeFile(wb, `rekap_absensi_sekolah_${academicYear}.xlsx`);
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
