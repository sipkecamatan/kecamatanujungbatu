/**
 * @file guru/js/tab-wali.js
 * Tab Wali Kelas — rekap absensi, keterlambatan, izin keluar, kasus siswa.
 *
 * Fungsi kasus engine (makeKasusCtx, showKasusList, dll) masih di dashboard.js
 * dan diteruskan via parameter `kasusEngine` sampai diekstrak terpisah.
 */
import {
    getWaliKelasInfo, getWaliAttendanceSummary, getWaliCoachingStudents,
    getWaliLateArrivals, getWaliExits, getClassScheduleFull,
} from './api.js';
import { pasangNilaiRaporKelas } from './nilai-rapor-kelas-ui.js';
import { esc, fe, buildAttStatCards, wireSimpleAccordion, localDateStr } from './tab-shared.js';

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
            const academicYear = config.current_academic_year;
            const className    = document.getElementById('wali-class-title')
                .textContent.replace('Kelas Walian — ', '').trim();
            // Unduh SELURUH tahun ajaran — tidak terikat filter tanggal di layar
            // Rekap per bulan dipanggil terpisah agar angka H/S/I/A konsisten dengan website
            const MONTHS_RANGE = [
                ['2026-07-01','2026-07-31'],['2026-08-01','2026-08-31'],
                ['2026-09-01','2026-09-30'],['2026-10-01','2026-10-31'],
                ['2026-11-01','2026-11-30'],['2026-12-01','2026-12-31'],
                ['2027-01-01','2027-01-31'],['2027-02-01','2027-02-28'],
                ['2027-03-01','2027-03-31'],['2027-04-01','2027-04-30'],
                ['2027-05-01','2027-05-31'],['2027-06-01','2027-06-30'],
            ];
            const [students, scheduleRows, ...monthlyRekaps] = await Promise.all([
                getWaliAttendanceSummary(classId, academicYear, null, null, config.current_semester),
                getClassScheduleFull(classId, academicYear, null, null),
                ...MONTHS_RANGE.map(([ds, de]) =>
                    getWaliAttendanceSummary(classId, academicYear, ds, de, null)
                ),
            ]);
            // Map: 'YYYY-MM' → Map<student_id, {H,S,I,A,tot}>
            const monthlyMap = {};
            MONTHS_RANGE.forEach(([ds], i) => {
                const mon = ds.slice(0, 7);
                const m = new Map();
                for (const r of monthlyRekaps[i])
                    m.set(r.student_id, { H: r.HADIR, S: r.SAKIT, I: r.IZIN, A: r.ALPA, tot: r.total });
                monthlyMap[mon] = m;
            });
            const wb = XLSX.utils.book_new();
            for (const { name, ws } of buildWaliSheetsMonthly({ students, scheduleRows, monthlyMap, className, academicYear }))
                XLSX.utils.book_append_sheet(wb, ws, name);
            XLSX.writeFile(wb, `rekap_wali_${className.replace(/\s+/g, '_')}_${academicYear}.xlsx`);
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
        const rows = await getWaliLateArrivals(dateStart, dateEnd);
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
        const rows = await getWaliExits(dateStart, dateEnd);
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
 * Bangun workbook Excel wali kelas:
 *   Sheet 1  — RINGKASAN    : agregat tahun ajaran + tren bulanan + siswa perlu perhatian
 *   Sheet 2–10 — Okt–Jun    : 1 sheet per bulan
 *     Kolom: No|Nama|H|S|I|A|% + per pertemuan (header: tanggal/mapel/guru)
 *     Sel "—" abu-abu = sesi belum diinput guru (tidak dihitung alpa/hadir)
 *
 * Sumber data: fn_class_schedule_full — mengembalikan SEMUA sesi terjadwal × siswa.
 * status=null → belum diinput; status=text → sudah diinput.
 */
export function buildWaliSheetsMonthly({ students, scheduleRows, monthlyMap, className, academicYear, classGroups = null }) {
    const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };
    const ALPA_MIN     = 2;
    const HADIR_MIN    = 0.75;

    // Pivot: student_id → block_group_id → status (null = belum diinput)
    const pivot = {};
    for (const r of scheduleRows) {
        if (!r.block_group_id || !r.student_id) continue;
        if (!pivot[r.student_id]) pivot[r.student_id] = {};
        pivot[r.student_id][r.block_group_id] = r.status; // null tetap disimpan
    }

    // Index pertemuan: block_group_id → { date, subject, teacher }
    const ptmInfo = new Map();
    for (const r of scheduleRows) {
        if (!r.block_group_id || ptmInfo.has(r.block_group_id)) continue;
        ptmInfo.set(r.block_group_id, {
            date:    r.session_date   ?? '',
            subject: r.subject_label  ?? '',
            teacher: r.teacher_name   ?? '',
        });
    }
    // Semua pertemuan urut kronologis lalu mapel
    const allPtm = [...ptmInfo.entries()]
        .sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject));

    const MONTHS = [
        '2026-07','2026-08','2026-09',
        '2026-10','2026-11','2026-12',
        '2027-01','2027-02','2027-03','2027-04','2027-05','2027-06',
    ];
    const MONTH_ID = {
        '01':'Januari','02':'Februari','03':'Maret','04':'April',
        '05':'Mei','06':'Juni','07':'Juli','08':'Agustus',
        '09':'September','10':'Oktober','11':'November','12':'Desember',
    };

    const roster = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

    // Rekap per siswa (seluruh tahun ajaran) — hanya hitung sesi yang sudah diinput (status !== null)
    const rekap = roster.map(s => {
        const byBg = pivot[s.student_id] ?? {};
        let H = 0, S = 0, I = 0, A = 0;
        for (const [bgId] of allPtm) {
            const st = byBg[bgId];
            if (st === null || st === undefined) continue; // belum diinput → skip
            if (st === 'HADIR') H++; else if (st === 'SAKIT') S++;
            else if (st === 'IZIN') I++; else if (st === 'ALPA') A++;
        }
        const tot = H + S + I + A;
        return { s, H, S, I, A, tot, pct: tot > 0 ? H / tot : null };
    });

    // ── Palet warna ───────────────────────────────────────────────────────────
    const C = {
        navyBg:   { patternType: 'solid', fgColor: { rgb: '1E3A5F' } },
        blueBg:   { patternType: 'solid', fgColor: { rgb: '2E6DA4' } },
        skyBg:    { patternType: 'solid', fgColor: { rgb: '4A90D9' } },
        greenBg:  { patternType: 'solid', fgColor: { rgb: 'D4EDDA' } },
        yellowBg: { patternType: 'solid', fgColor: { rgb: 'FFF3CD' } },
        cyanBg:   { patternType: 'solid', fgColor: { rgb: 'CCE5FF' } },
        redBg:    { patternType: 'solid', fgColor: { rgb: 'F8D7DA' } },
        orangeBg: { patternType: 'solid', fgColor: { rgb: 'FFEEBA' } },
        greyBg:   { patternType: 'solid', fgColor: { rgb: 'F0F0F0' } },
        sectionBg:{ patternType: 'solid', fgColor: { rgb: 'E8F0FE' } },
    };
    const F = {
        white:  { color: { rgb: 'FFFFFF' } },
        navy:   { color: { rgb: '1E3A5F' } },
        green:  { color: { rgb: '155724' } },
        yellow: { color: { rgb: '856404' } },
        blue:   { color: { rgb: '004085' } },
        red:    { color: { rgb: '721C24' } },
        grey:   { color: { rgb: '666666' } },
        bold:   { bold: true },
    };
    const AL = { center: { horizontal: 'center' }, left: { horizontal: 'left' }, wrap: { wrapText: true } };

    // Buat style object SheetJS: { fill, font, alignment, border }
    function S(fill, font, alignment) {
        const s = {};
        if (fill) s.fill = fill;
        if (font) s.font = { ...font };
        if (alignment) s.alignment = alignment;
        return s;
    }
    const ST = {
        hdrMain:    S(C.navyBg,    { ...F.white, ...F.bold, sz: 11 }, { ...AL.center, ...AL.wrap }),
        hdrDate:    S(C.blueBg,    { ...F.white, ...F.bold, sz: 10 }, AL.center),
        hdrSubject: S(C.skyBg,     { ...F.white, ...F.bold, sz: 9  }, { ...AL.center, ...AL.wrap }),
        statusH:    S(C.greenBg,   { ...F.green, ...F.bold },          AL.center),
        statusS:    S(C.yellowBg,  { ...F.yellow,...F.bold },          AL.center),
        statusI:    S(C.cyanBg,    { ...F.blue,  ...F.bold },          AL.center),
        statusA:    S(C.redBg,     { ...F.red,   ...F.bold },          AL.center),
        pctOk:      S(C.greenBg,   F.green,                            AL.center),
        pctBad:     S(C.redBg,     F.red,                              AL.center),
        pctWarn:    S(C.yellowBg,  F.yellow,                           AL.center),
        perhatian:  S(C.orangeBg,  null,                               null),
        total:      S(C.greyBg,    F.bold,                             null),
        section:    S(C.sectionBg, { ...F.navy, ...F.bold, sz: 11 },   null),
        title:      S(null,        { ...F.navy, ...F.bold, sz: 14 },   null),
        italic9:    S(null,        { ...F.grey, italic: true, sz: 9 }, null),
        number:     S(null,        null,                                AL.center),
    };

    // Buat cell object untuk SheetJS
    function cc(v, st) {
        if (v === null || v === undefined) return { v: '', t: 's', s: st ?? {} };
        return { v, t: typeof v === 'number' ? 'n' : 's', s: st ?? {} };
    }

    // Bangun worksheet dari array baris (setiap baris = array cell object atau null)
    function buildWs(rows, colWidths, merges) {
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
        if (colWidths) ws['!cols']   = colWidths.map(w => ({ wch: w }));
        if (merges)    ws['!merges'] = merges;
        return ws;
    }

    // ── SHEET 1: RINGKASAN ────────────────────────────────────────────────────
    const gH = rekap.reduce((a, r) => a + r.H, 0);
    const gS = rekap.reduce((a, r) => a + r.S, 0);
    const gI = rekap.reduce((a, r) => a + r.I, 0);
    const gA = rekap.reduce((a, r) => a + r.A, 0);
    const gTot = gH + gS + gI + gA;
    const pctKelas = gTot > 0 ? Math.round(gH / gTot * 100) + '%' : '—';

    const r1 = [];
    r1.push([cc(`LAPORAN KEHADIRAN — ${className}`, ST.title)]);
    r1.push([cc(`Tahun Ajaran: ${academicYear}  |  Data seluruh periode aktif`, ST.italic9)]);
    r1.push(null);
    r1.push([
        cc('JUMLAH SISWA',      ST.section), cc(roster.length, ST.number), null,
        cc('PERTEMUAN TERCATAT',ST.section), cc(allPtm.length, ST.number), null,
        cc('TINGKAT HADIR KELAS',ST.section), cc(pctKelas, gTot > 0 && gH/gTot < HADIR_MIN ? ST.pctBad : ST.pctOk),
    ]);
    r1.push([
        cc('Hadir (H)', null), cc(gH, ST.statusH), null,
        cc('Sakit (S)', null), cc(gS, ST.statusS), null,
        cc('Izin (I)',  null), cc(gI, ST.statusI),
    ]);
    r1.push([cc('Alpa (A)', null), cc(gA, ST.statusA)]);
    r1.push(null);

    // Tren bulanan
    r1.push([cc('TREN KEHADIRAN PER BULAN', ST.section)]);
    r1.push([
        cc('Bulan',    ST.hdrMain), cc('Pertemuan', ST.hdrMain),
        cc('H',        ST.hdrMain), cc('S',         ST.hdrMain),
        cc('I',        ST.hdrMain), cc('A',         ST.hdrMain),
        cc('% Hadir',  ST.hdrMain), cc('Siswa Perlu Perhatian', ST.hdrMain),
    ]);
    for (const mon of MONTHS) {
        const [yr, mo] = mon.split('-');
        const ptmMon = allPtm.filter(([, i]) => i.date.startsWith(mon));
        let mH = 0, mS = 0, mI = 0, mA = 0;
        for (const r of rekap) {
            const byBg = pivot[r.s.student_id] ?? {};
            for (const [bgId] of ptmMon) {
                const st = byBg[bgId];
                if (st === null || st === undefined) continue; // belum diinput
                if (st === 'HADIR') mH++; else if (st === 'SAKIT') mS++;
                else if (st === 'IZIN') mI++; else if (st === 'ALPA') mA++;
            }
        }
        const mTot = mH + mS + mI + mA;
        const mPct = mTot > 0 ? Math.round(mH / mTot * 100) + '%' : '—';
        let nPerhatian = 0;
        for (const r of rekap) {
            const byBg = pivot[r.s.student_id] ?? {};
            let sisH = 0, sisTot = 0, sisA = 0;
            for (const [bgId] of ptmMon) {
                const st = byBg[bgId];
                if (st === null || st === undefined) continue; // belum diinput
                sisTot++; if (st === 'HADIR') sisH++; else if (st === 'ALPA') sisA++;
            }
            if (sisA >= ALPA_MIN || (sisTot > 0 && sisH / sisTot < HADIR_MIN)) nPerhatian++;
        }
        r1.push([
            cc(`${MONTH_ID[mo]} ${yr}`, null),
            cc(ptmMon.length, ST.number),
            cc(mH, ST.statusH), cc(mS, ST.statusS), cc(mI, ST.statusI), cc(mA, ST.statusA),
            cc(mPct, mTot > 0 && mH/mTot < HADIR_MIN ? ST.pctBad : mTot > 0 ? ST.pctOk : ST.number),
            cc(nPerhatian > 0 ? nPerhatian + ' siswa' : '—', nPerhatian > 0 ? ST.pctWarn : ST.number),
        ]);
    }
    r1.push(null);

    // Siswa perlu perhatian (seluruh tahun)
    r1.push([cc('SISWA PERLU PERHATIAN — SELURUH TAHUN AJARAN', ST.section)]);
    r1.push([cc('Threshold: Alpa ≥ 2 kali ATAU % hadir < 75%. Pertemuan belum diinput tidak dihitung alpa.', ST.italic9)]);
    r1.push([
        cc('No',         ST.hdrMain), cc('Nama Siswa', ST.hdrMain),
        cc('H',          ST.hdrMain), cc('S',          ST.hdrMain),
        cc('I',          ST.hdrMain), cc('A',          ST.hdrMain),
        cc('Total',      ST.hdrMain), cc('% Hadir',    ST.hdrMain),
        cc('Catatan',    ST.hdrMain),
    ]);
    let noP = 0;

    const pushPerhatianRow = (r) => {
        noP++;
        const cat = [];
        if (r.pct !== null && r.pct < HADIR_MIN) cat.push(`% hadir ${Math.round(r.pct * 100)}% < 75%`);
        if (r.A >= ALPA_MIN) cat.push(`alpa ${r.A}x`);
        r1.push([
            cc(noP,           { ...ST.perhatian, ...ST.number }),
            cc(r.s.full_name,  ST.perhatian),
            cc(r.H, ST.statusH), cc(r.S, ST.statusS),
            cc(r.I, ST.statusI), cc(r.A, ST.statusA),
            cc(r.tot,         { ...ST.perhatian, ...ST.number }),
            cc(r.pct !== null ? Math.round(r.pct * 100) + '%' : '—',
               r.pct !== null && r.pct < HADIR_MIN ? ST.pctBad : ST.pctOk),
            cc(cat.join(', '), ST.perhatian),
        ]);
    };

    if (classGroups) {
        // Tampilkan per kelas dengan header kelas
        const rekapById = new Map(rekap.map(r => [r.s.student_id, r]));
        for (const grp of classGroups) {
            const grpPerhatian = [...grp.studentIds]
                .map(id => rekapById.get(id))
                .filter(r => r && (r.A >= ALPA_MIN || (r.pct !== null && r.pct < HADIR_MIN)))
                .sort((a, b) => a.s.full_name.localeCompare(b.s.full_name, 'id'));
            if (!grpPerhatian.length) continue;
            r1.push([cc(grp.name, ST.section)]);
            for (const r of grpPerhatian) pushPerhatianRow(r);
        }
    } else {
        for (const r of rekap) {
            if (r.A < ALPA_MIN && (r.pct === null || r.pct >= HADIR_MIN)) continue;
            pushPerhatianRow(r);
        }
    }

    if (noP === 0)
        r1.push([null, cc('Tidak ada siswa yang memerlukan perhatian khusus.', { s: { font: { color: { rgb: '155724' }, italic: true } } })]);

    const ws1 = buildWs(r1, [4, 30, 6, 6, 6, 6, 8, 14, 40], null);

    // ── SHEET 2–10: PER BULAN ─────────────────────────────────────────────────
    const monthSheets = MONTHS.map(mon => {
        const [yr, mo] = mon.split('-');
        const sheetName = `${MONTH_ID[mo].substring(0, 3)} ${yr.slice(2)}`;   // "Okt 26"

        const ptmMon = allPtm.filter(([, i]) => i.date.startsWith(mon));

        // Kelompok pertemuan per tanggal (untuk header baris 1 yang di-merge)
        const dateMap = new Map(); // date → [bgId,...]
        for (const [bgId, i] of ptmMon) {
            if (!dateMap.has(i.date)) dateMap.set(i.date, []);
            dateMap.get(i.date).push(bgId);
        }
        const sortedDates = [...dateMap.keys()].sort();

        const FIXED = 7; // No, Nama, H, S, I, A, %

        // Baris header-1: kolom tetap + label tanggal (akan di-merge per tanggal)
        const hdr1 = [
            cc('No',       ST.hdrMain), cc('Nama Siswa', ST.hdrMain),
            cc('Hadir',    ST.statusH), cc('Sakit',      ST.statusS),
            cc('Izin',     ST.statusI), cc('Alpa',       ST.statusA),
            cc('% Hadir',  ST.hdrMain),
        ];
        // Baris header-2: mapel per pertemuan
        const hdr2 = Array(FIXED).fill(null);
        // Baris header-3: nama guru per pertemuan
        const hdr3 = Array(FIXED).fill(null);
        const merges = [];
        let colIdx = FIXED;

        for (const date of sortedDates) {
            const bgIds = dateMap.get(date);
            const dd = date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2'); // "dd/mm"
            hdr1.push(cc(dd, ST.hdrDate));
            for (let k = 1; k < bgIds.length; k++) hdr1.push(null); // placeholder merge
            for (const bgId of bgIds) {
                const info = ptmInfo.get(bgId);
                hdr2.push(cc(info?.subject || '—', ST.hdrSubject));
                hdr3.push(cc(info?.teacher || '—', ST.hdrSubject));
            }
            if (bgIds.length > 1)
                merges.push({ s: { r: 3, c: colIdx }, e: { r: 3, c: colIdx + bgIds.length - 1 } });
            colIdx += bgIds.length;
        }

        // Style untuk sel belum diinput
        const stBelum = S(
            { patternType: 'solid', fgColor: { rgb: 'DDDDDD' } },
            { color: { rgb: '888888' } },
            AL.center
        );

        // Rekap bulanan dari fn_class_attendance_summary (sama dengan website)
        const monRekap = monthlyMap?.[mon] ?? new Map();

        // Baris data per siswa
        const dataRows = rekap.map((r, idx) => {
            const byBg = pivot[r.s.student_id] ?? {};
            // H/S/I/A dari fn_class_attendance_summary agar konsisten dengan website
            const ms   = monRekap.get(r.s.student_id) ?? { H: 0, S: 0, I: 0, A: 0, tot: 0 };
            const mH = ms.H, mS = ms.S, mI = ms.I, mA = ms.A, mTot = ms.tot;
            const mPct = mTot > 0 ? Math.round(mH / mTot * 100) + '%' : '—';
            const warn = mA >= ALPA_MIN || (mTot > 0 && mH / mTot < HADIR_MIN);

            const row = [
                cc(idx + 1,       warn ? { ...ST.perhatian, ...ST.number } : ST.number),
                cc(r.s.full_name,  warn ? ST.perhatian : null),
                cc(mH, ST.statusH), cc(mS, ST.statusS),
                cc(mI, ST.statusI), cc(mA, ST.statusA),
                cc(mPct, mTot > 0 && mH / mTot < HADIR_MIN ? ST.pctBad
                    : mTot > 0 ? ST.pctOk : ST.number),
            ];
            for (const [bgId] of ptmMon) {
                const st = byBg[bgId];
                if (st === null || st === undefined) {
                    row.push(cc('—', stBelum)); // belum diinput
                } else {
                    row.push(cc(STATUS_HURUF[st] ?? st,
                        { HADIR: ST.statusH, SAKIT: ST.statusS, IZIN: ST.statusI, ALPA: ST.statusA }[st] ?? ST.number));
                }
            }
            return row;
        });

        // Baris total — hitung hanya dari sesi yang sudah diinput
        const totRow = [
            cc('', ST.total), cc('TOTAL KELAS', ST.total),
            cc(dataRows.reduce((a, r) => a + (r[2]?.v ?? 0), 0), { ...ST.total, ...ST.statusH }),
            cc(dataRows.reduce((a, r) => a + (r[3]?.v ?? 0), 0), { ...ST.total, ...ST.statusS }),
            cc(dataRows.reduce((a, r) => a + (r[4]?.v ?? 0), 0), { ...ST.total, ...ST.statusI }),
            cc(dataRows.reduce((a, r) => a + (r[5]?.v ?? 0), 0), { ...ST.total, ...ST.statusA }),
            cc('', ST.total),
        ];
        for (const [bgId] of ptmMon) {
            // Hitung berapa siswa yang sudah punya status (diinput) di pertemuan ini
            const nInput = Object.values(pivot).filter(b => b[bgId] !== undefined && b[bgId] !== null).length;
            totRow.push(cc(nInput > 0 ? nInput : '—', nInput > 0 ? ST.total : stBelum));
        }

        // Baris Jumlah H/S/I/A per kolom pertemuan
        const stJumlahLbl = S(C.greyBg, { ...F.bold, sz: 9 }, AL.left);
        const mkJumlahRow = (label, stCode, stCell) => {
            const row = [cc('', stJumlahLbl), cc(label, stJumlahLbl),
                cc('', stJumlahLbl), cc('', stJumlahLbl),
                cc('', stJumlahLbl), cc('', stJumlahLbl), cc('', stJumlahLbl)];
            for (const [bgId] of ptmMon) {
                const n = Object.values(pivot).filter(b => b[bgId] === stCode).length;
                row.push(cc(n > 0 ? n : '—', n > 0 ? stCell : stBelum));
            }
            return row;
        };
        const jumlahH = mkJumlahRow('Jumlah H', 'HADIR', ST.statusH);
        const jumlahS = mkJumlahRow('Jumlah S', 'SAKIT', ST.statusS);
        const jumlahI = mkJumlahRow('Jumlah I', 'IZIN',  ST.statusI);
        const jumlahA = mkJumlahRow('Jumlah A', 'ALPA',  ST.statusA);

        const allRows = [
            [cc(`ABSENSI ${MONTH_ID[mo].toUpperCase()} ${yr} — ${className}`, ST.title)],
            [cc('Sel abu-abu (—) = sesi belum diinput guru. Nama guru tertera di baris header ketiga.', ST.italic9)],
            null,
            hdr1,
            hdr2,
            hdr3,
            ...dataRows,
            totRow,
            jumlahH,
            jumlahS,
            jumlahI,
            jumlahA,
        ];

        const colWidths = [4, 30, 6, 6, 6, 6, 8, ...Array(ptmMon.length).fill(10)];
        const ws = buildWs(allRows, colWidths, merges);

        // Freeze pane: bekukan 2 kolom kiri + 6 baris atas (title+sub+blank+hdr1+hdr2+hdr3)
        ws['!freeze'] = { xSplit: 2, ySplit: 6 };

        return { name: sheetName, ws };
    });

    return [{ name: 'RINGKASAN', ws: ws1 }, ...monthSheets];
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
                        <span style="color:var(--color-primary)">${s.SAKIT}S</span>
                        <span style="color:var(--color-warning,#f59e0b)">${s.IZIN}I</span>
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
