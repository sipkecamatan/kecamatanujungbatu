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
    getClassesByProgram, getWaliAttendanceSummary,
    getLateArrivalsByRange, getCoachingCasesCount,
} from './api.js';
import { esc, fe, wireSimpleAccordion, localDateStr } from './tab-shared.js';
import { downloadProdiExcel, MONTHS_RANGE } from './tab-kaprodi.js';

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
        const ALPA_MIN = 2, HADIR_MIN = 0.75;
        const MONTH_LABEL = {
            '10':'Oktober','11':'November','12':'Desember',
            '01':'Januari','02':'Februari','03':'Maret',
            '04':'April','05':'Mei','06':'Juni',
        };

        const programs = await getPrograms();
        const allClassArrays = await Promise.all(programs.map(p => getClassesByProgram(p.program_id)));
        const allClasses = allClassArrays.flat().sort((a, b) => a.name.localeCompare(b.name, 'id'));
        if (!allClasses.length) { alert('Belum ada kelas untuk diunduh.'); return; }

        // ~39 call: annual per-siswa (n kelas) + 9 monthly class-level
        const [clsResults, ...monthlyRekaps] = await Promise.all([
            Promise.all(allClasses.map(c =>
                getWaliAttendanceSummary(c.class_id, academicYear, null, null, config.current_semester)
                    .then(students => ({ cls: c, students }))
            )),
            ...MONTHS_RANGE.map(([ds, de]) => getAttendanceRecapPerClass(ds, de)),
        ]);

        // Totals tahunan
        const allStudents = clsResults.flatMap(d => d.students);
        if (!allStudents.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }
        let gH = 0, gS = 0, gI = 0, gA = 0;
        for (const s of allStudents) { gH += s.HADIR ?? 0; gS += s.SAKIT ?? 0; gI += s.IZIN ?? 0; gA += s.ALPA ?? 0; }
        const gTot = gH + gS + gI + gA;
        const pctSekolah = gTot > 0 ? Math.round(gH / gTot * 100) + '%' : '—';

        // Totals bulanan (level sekolah, dari agregat kelas)
        const monthlyTotals = monthlyRekaps.map(rows => {
            let H = 0, S = 0, I = 0, A = 0;
            for (const r of rows) { H += r.HADIR ?? 0; S += r.SAKIT ?? 0; I += r.IZIN ?? 0; A += r.ALPA ?? 0; }
            return { H, S, I, A };
        });

        // Perlu Perhatian — dikelompok per kelas
        const perhatian = clsResults
            .map(({ cls, students }) => ({
                clsName: cls.name,
                rows: students
                    .map(s => {
                        const tot = (s.HADIR ?? 0) + (s.SAKIT ?? 0) + (s.IZIN ?? 0) + (s.ALPA ?? 0);
                        const pct = tot > 0 ? s.HADIR / tot : null;
                        return { s, tot, pct };
                    })
                    .filter(r => (r.s.ALPA ?? 0) >= ALPA_MIN || (r.pct !== null && r.pct < HADIR_MIN))
                    .sort((a, b) => a.s.full_name.localeCompare(b.s.full_name, 'id')),
            }))
            .filter(g => g.rows.length);

        // ── Styling (identik buildWaliSheetsMonthly) ──────────────────────────
        const C = {
            navyBg:   { patternType: 'solid', fgColor: { rgb: '1E3A5F' } },
            greenBg:  { patternType: 'solid', fgColor: { rgb: 'D4EDDA' } },
            yellowBg: { patternType: 'solid', fgColor: { rgb: 'FFF3CD' } },
            cyanBg:   { patternType: 'solid', fgColor: { rgb: 'CCE5FF' } },
            redBg:    { patternType: 'solid', fgColor: { rgb: 'F8D7DA' } },
            orangeBg: { patternType: 'solid', fgColor: { rgb: 'FFEEBA' } },
            sectionBg:{ patternType: 'solid', fgColor: { rgb: 'E8F0FE' } },
        };
        const F = {
            white: { color: { rgb: 'FFFFFF' } }, navy: { color: { rgb: '1E3A5F' } },
            green: { color: { rgb: '155724' } }, yellow: { color: { rgb: '856404' } },
            blue:  { color: { rgb: '004085' } }, red:   { color: { rgb: '721C24' } },
            grey:  { color: { rgb: '666666' } },
        };
        function S(fill, font, al) { const s = {}; if (fill) s.fill = fill; if (font) s.font = { ...font }; if (al) s.alignment = al; return s; }
        const ST = {
            hdrMain:  S(C.navyBg,    { ...F.white,  bold: true, sz: 11 }, { horizontal: 'center', wrapText: true }),
            section:  S(C.sectionBg, { ...F.navy,   bold: true, sz: 11 }, null),
            statusH:  S(C.greenBg,   { ...F.green,  bold: true }, { horizontal: 'center' }),
            statusS:  S(C.yellowBg,  { ...F.yellow, bold: true }, { horizontal: 'center' }),
            statusI:  S(C.cyanBg,    { ...F.blue,   bold: true }, { horizontal: 'center' }),
            statusA:  S(C.redBg,     { ...F.red,    bold: true }, { horizontal: 'center' }),
            pctOk:    S(C.greenBg,   F.green,  { horizontal: 'center' }),
            pctBad:   S(C.redBg,     F.red,    { horizontal: 'center' }),
            perhatian:S(C.orangeBg,  null,     null),
            title:    S(null, { ...F.navy, bold: true, sz: 14 }, null),
            italic9:  S(null, { ...F.grey, italic: true, sz: 9 }, null),
            num:      S(null, null, { horizontal: 'center' }),
        };
        function cc(v, st) {
            if (v === null || v === undefined) return { v: '', t: 's', s: st ?? {} };
            return { v, t: typeof v === 'number' ? 'n' : 's', s: st ?? {} };
        }

        // ── Susun baris worksheet ─────────────────────────────────────────────
        const rows = [];
        rows.push([cc(`LAPORAN KEHADIRAN — Semua Kelas Sekolah`, ST.title)]);
        rows.push([cc(`Tahun Ajaran: ${academicYear}  |  Data seluruh periode aktif`, ST.italic9)]);
        rows.push(null);
        rows.push([
            cc('JUMLAH SISWA', ST.section), cc(allStudents.length, ST.num), null,
            cc('PERTEMUAN TERCATAT', ST.section), cc('—', ST.num), null,
            cc('TINGKAT HADIR', ST.section),
            cc(pctSekolah, gTot > 0 && gH / gTot < HADIR_MIN ? ST.pctBad : ST.pctOk),
        ]);
        rows.push([cc('Hadir (H)', null), cc(gH, ST.statusH), null, cc('Sakit (S)', null), cc(gS, ST.statusS), null, cc('Izin (I)', null), cc(gI, ST.statusI)]);
        rows.push([cc('Alpa (A)', null), cc(gA, ST.statusA)]);
        rows.push(null);

        rows.push([cc('TREN KEHADIRAN PER BULAN', ST.section)]);
        rows.push([cc('Bulan', ST.hdrMain), cc('H', ST.hdrMain), cc('S', ST.hdrMain), cc('I', ST.hdrMain), cc('A', ST.hdrMain), cc('% Hadir', ST.hdrMain)]);
        MONTHS_RANGE.forEach(([ds], i) => {
            const [yr, mo] = ds.slice(0, 7).split('-');
            const { H, S, I, A } = monthlyTotals[i];
            const tot = H + S + I + A;
            const pct = tot > 0 ? Math.round(H / tot * 100) + '%' : '—';
            rows.push([
                cc(`${MONTH_LABEL[mo]} ${yr}`, null),
                cc(H, ST.statusH), cc(S, ST.statusS), cc(I, ST.statusI), cc(A, ST.statusA),
                cc(pct, tot > 0 && H / tot < HADIR_MIN ? ST.pctBad : tot > 0 ? ST.pctOk : ST.num),
            ]);
        });
        rows.push(null);

        rows.push([cc('SISWA PERLU PERHATIAN — SELURUH TAHUN AJARAN', ST.section)]);
        rows.push([cc('Threshold: Alpa ≥ 2 kali ATAU % hadir < 75%. Data tahunan.', ST.italic9)]);
        rows.push([
            cc('No', ST.hdrMain), cc('Nama Siswa', ST.hdrMain),
            cc('H', ST.hdrMain), cc('S', ST.hdrMain), cc('I', ST.hdrMain), cc('A', ST.hdrMain),
            cc('Total', ST.hdrMain), cc('% Hadir', ST.hdrMain), cc('Catatan', ST.hdrMain),
        ]);
        if (!perhatian.length) {
            rows.push([cc('Tidak ada siswa yang memerlukan perhatian khusus.', null)]);
        } else {
            let noP = 0;
            for (const { clsName, rows: gr } of perhatian) {
                rows.push([cc(clsName, ST.section)]);
                for (const { s, tot, pct } of gr) {
                    noP++;
                    const cat = [];
                    if (pct !== null && pct < HADIR_MIN) cat.push(`% hadir ${Math.round(pct * 100)}% < 75%`);
                    if ((s.ALPA ?? 0) >= ALPA_MIN) cat.push(`alpa ${s.ALPA}x`);
                    rows.push([
                        cc(noP, { ...ST.perhatian, ...ST.num }),
                        cc(s.full_name, ST.perhatian),
                        cc(s.HADIR ?? 0, ST.statusH), cc(s.SAKIT ?? 0, ST.statusS),
                        cc(s.IZIN ?? 0, ST.statusI),  cc(s.ALPA ?? 0, ST.statusA),
                        cc(tot, ST.num),
                        cc(pct !== null ? Math.round(pct * 100) + '%' : '—', pct !== null && pct < HADIR_MIN ? ST.pctBad : ST.pctOk),
                        cc(cat.join(', '), ST.perhatian),
                    ]);
                }
            }
        }
        rows.push(null);
        rows.push([cc('Data detail kehadiran per kelas tersedia melalui tombol ↓ Excel pada dropdown prodi di atas.', ST.italic9)]);

        // ── Build worksheet ───────────────────────────────────────────────────
        const ws = {};
        let maxC = 0;
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r] ?? [];
            if (row.length > maxC) maxC = row.length;
            for (let c = 0; c < row.length; c++) {
                if (row[c] == null) continue;
                ws[XLSX.utils.encode_cell({ r, c })] = row[c];
            }
        }
        ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: maxC - 1 } });
        ws['!cols'] = [20, 28, 6, 6, 6, 6, 8, 10, 40].map(w => ({ wch: w }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'RINGKASAN');
        const buf  = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `rekap_absensi_sekolah_${academicYear}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
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
