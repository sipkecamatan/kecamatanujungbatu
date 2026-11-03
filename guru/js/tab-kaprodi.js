/**
 * @file guru/js/tab-kaprodi.js
 * Tab Kaprodi — dua jalur input kehadiran:
 *   1. Jalur reguler: siswa AKTIF di kelas (rekap per kelas dari guru internal)
 *   2. Jalur PKL: siswa PKL di DUDI (rekap dari observasi DUDI)
 *
 * `kaprodiAllStudents` diekspor karena dipakai di bagian kasus/observasi
 * di dashboard.js (pool pencarian siswa multi-jabatan).
 *
 * kasusEngine diteruskan dari dashboard.js sampai tab-kasus diekstrak.
 */
import {
    getProgram, fetchPklStudents, fetchNonPklStudents, fetchDudiPartners,
    fetchPklAttendance, fetchDudiObservations,
    getAttendanceRecapPerClass, getClassesByProgram,
    getClassStudents, getClassAttendanceByDate,
    getWaliAttendanceSummary, getClassScheduleFull,
    createPlacement, finishPlacement, bulkImportPkl,
    getLateArrivalsByRange, getExitsByRange,
} from './api.js';
import { esc, fe, fmt, localDateStr, buildPertemuanMeta, filterPerhatian, renderPerhatianAccordion, wirePerhatianCollapse, wireWaliSection, downloadLateExcel, downloadExitExcel } from './tab-shared.js';
import { buildWaliSheetsMonthly } from './tab-wali.js';

const DIMENSION_LABELS = {
    AKADEMIK: 'Akademik', KEHADIRAN: 'Kehadiran', PERILAKU: 'Perilaku',
    SOSIAL: 'Sosial', AFEKTIF: 'Afektif', BAKAT_MINAT: 'Bakat & Minat',
    FISIK: 'Fisik', LAINNYA: 'Lainnya',
};

// State modul
let kpStudents        = [];
let kpAktifStudents   = [];
let kpProgramId       = null;
let kpDudiList        = [];
let kpTabInitialized  = false;
let kpTabLoading      = false;
let kpRecapSeq        = 0;
let kpClsRecapSeq     = 0;
let _kpKasusCtx       = null;
let _kpLateSeq        = 0;
let _kpExitSeq        = 0;
let _cachedKpLate     = [];
let _cachedKpExit     = [];

// Diekspor: dipakai di bagian kasus/observasi dashboard.js
export let kaprodiAllStudents = [];

export async function initKaprodiTab({ currentUser, config, kasusEngine }) {
    const { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } = kasusEngine;

    if (kpTabInitialized || kpTabLoading) return;
    kpTabLoading = true;
    document.getElementById('kp-load-error')?.remove();

    const programId = currentUser.kaprodi_program_id ??
        (currentUser.role_type === 'KAPRODI' ? currentUser.program_id : null);
    kpProgramId = programId;
    if (!programId) {
        document.getElementById('tab-kaprodi').querySelector('.page-body').innerHTML =
            '<div class="section-card"><p class="hint">Akun ini belum terhubung ke program keahlian. Hubungi admin.</p></div>';
        kpTabInitialized = true;
        kpTabLoading = false;
        return;
    }

    try {
        const [program, students, aktifStudents, dudi] = await Promise.all([
            getProgram(programId),
            fetchPklStudents(programId),
            fetchNonPklStudents(programId),
            fetchDudiPartners(programId),
        ]);
        kpStudents      = students;
        kpDudiList      = dudi;
        kpAktifStudents = aktifStudents;

        // Pool gabung PKL + aktif (untuk Observasi & Buat Kasus)
        const seen = new Set(kpStudents.map(s => s.student_id));
        kaprodiAllStudents = [...kpStudents, ...kpAktifStudents.filter(s => !seen.has(s.student_id))];

        renderKpSummary();
        renderKpStudents();
        renderKpDudi();

        const today    = localDateStr();
        const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
        document.getElementById('kp-date-start').value  = monthAgo;
        document.getElementById('kp-date-end').value    = today;
        document.getElementById('kp-cls-start').value   = monthAgo;
        document.getElementById('kp-cls-end').value     = today;

        document.getElementById('kp-filter-btn').onclick     = loadKpRecap;
        document.getElementById('kp-cls-filter-btn').onclick = () => loadKpClsRecap({ config });

        // Wiring collapse semua section Kaprodi (standar wireWaliSection)
        wireWaliSection('kp-late-toggle',      'kp-late-body');
        wireWaliSection('kp-exit-toggle',      'kp-exit-body');
        wireWaliSection('kp-cls-toggle',       'kp-body-cls');
        wireWaliSection('kp-dudi-toggle',      'kp-body-dudi');
        wireWaliSection('kp-placement-toggle', 'kp-body-placement');
        wireWaliSection('kp-students-toggle',  'kp-body-students');
        wireWaliSection('kp-pkl-toggle',       'kp-body-pkl');
        wireWaliSection('kp-obs-toggle',       'kp-body-obs');
        wireWaliSection('kp-kasus-toggle',     'kp-body-kasus');
        const firstOfMonth = today.slice(0, 8) + '01';
        document.getElementById('kp-late-start').value = firstOfMonth;
        document.getElementById('kp-late-end').value   = today;
        document.getElementById('kp-exit-start').value = firstOfMonth;
        document.getElementById('kp-exit-end').value   = today;
        document.getElementById('kp-late-filter-btn').onclick = () => loadKpLateRecap({ config, programId });
        document.getElementById('kp-exit-filter-btn').onclick = () => loadKpExitRecap({ config, programId });

        const _kpLateExcelBtn = document.getElementById('kp-late-excel-btn');
        if (_kpLateExcelBtn) {
            _kpLateExcelBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const start = document.getElementById('kp-late-start').value;
                const end   = document.getElementById('kp-late-end').value;
                if (_cachedKpLate.length) {
                    downloadLateExcel(_cachedKpLate, `keterlambatan_kaprodi_${start}_${end}`, { withKelas: true, withRecorder: true });
                    return;
                }
                const origText = _kpLateExcelBtn.textContent;
                _kpLateExcelBtn.textContent = '...';
                _kpLateExcelBtn.disabled = true;
                try {
                    const rows = await getLateArrivalsByRange(start, end, config?.current_academic_year ?? null);
                    _cachedKpLate = rows;
                    downloadLateExcel(rows, `keterlambatan_kaprodi_${start}_${end}`, { withKelas: true, withRecorder: true });
                } catch (_) { /* biarkan tombol kembali normal */ }
                _kpLateExcelBtn.textContent = origText;
                _kpLateExcelBtn.disabled = false;
            });
        }
        const _kpExitExcelBtn = document.getElementById('kp-exit-excel-btn');
        if (_kpExitExcelBtn) {
            _kpExitExcelBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const start = document.getElementById('kp-exit-start').value;
                const end   = document.getElementById('kp-exit-end').value;
                if (_cachedKpExit.length) {
                    downloadExitExcel(_cachedKpExit, `izin_keluar_kaprodi_${start}_${end}`, { withKelas: true, withRecorder: true });
                    return;
                }
                const origText = _kpExitExcelBtn.textContent;
                _kpExitExcelBtn.textContent = '...';
                _kpExitExcelBtn.disabled = true;
                try {
                    const rows = await getExitsByRange(start, end, config?.current_academic_year ?? null);
                    _cachedKpExit = rows;
                    downloadExitExcel(rows, `izin_keluar_kaprodi_${start}_${end}`, { withKelas: true, withRecorder: true });
                } catch (_) { /* biarkan tombol kembali normal */ }
                _kpExitExcelBtn.textContent = origText;
                _kpExitExcelBtn.disabled = false;
            });
        }

        // Isi dropdown kelas dari program ini
        try {
            const kpClasses = await getClassesByProgram(programId);
            const optHtml   = kpClasses.sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(c => `<option value="${esc(c.class_id)}">${esc(c.name)}</option>`).join('');
            document.getElementById('kp-late-class').insertAdjacentHTML('beforeend', optHtml);
            document.getElementById('kp-exit-class').insertAdjacentHTML('beforeend', optHtml);
        } catch (_) { /* dropdown tetap, filter tidak aktif */ }

        const studentsBody = document.getElementById('kp-students-body');
        studentsBody.removeEventListener('click', _handleKpStudentsClick);
        studentsBody.addEventListener('click', _handleKpStudentsClick);

        await Promise.all([loadKpRecap(), loadKpClsRecap({ config }), loadKpObs(), initKpPlacementForm(programId)]);
        await _initKaprodiKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList });
        loadKpPerhatian({ programId, config });
        wirePerhatianCollapse('kp-perhatian-card');

        document.getElementById('kp-cls-export-btn')?.addEventListener('click', (e) => { e.stopPropagation(); downloadKpClsExcel({ config }); });
        kpTabInitialized = true;
    } catch (err) {
        console.error('[kaprodi]', err);
        kpTabInitialized = false;
        const panel = document.getElementById('tab-kaprodi')?.querySelector('.page-body');
        if (panel) {
            const errorEl = document.createElement('div');
            errorEl.id = 'kp-load-error';
            errorEl.className = 'alert alert-danger';
            errorEl.style.marginBottom = '12px';
            errorEl.innerHTML = 'Gagal memuat sebagian data Kaprodi. <button type="button" class="btn btn-sm btn-secondary" style="margin-left:8px">Coba lagi</button>';
            errorEl.querySelector('button').addEventListener('click', () => initKaprodiTab({ currentUser, config, kasusEngine }));
            panel.prepend(errorEl);
        }
    } finally {
        kpTabLoading = false;
    }
}

function _handleKpStudentsClick(e) {
    const btn = e.target.closest('.kp-finish-btn');
    if (btn) _handleFinishPkl(btn);
}

async function _initKaprodiKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList }) {
    const msgEl      = document.getElementById('kp-kasus-list-content');
    const studentIds = [...new Set([
        ...kpAktifStudents.map(s => s.student_id),
        ...kpStudents.map(s => s.student_id),
    ])];
    if (!studentIds.length) {
        msgEl.innerHTML = '<p class="hint">Tidak ada siswa di program ini.</p>';
        return;
    }
    _kpKasusCtx = makeKasusCtx('kp-kasus', { studentIds });
    document.getElementById('kp-kasus-back-btn')
        .addEventListener('click', () => showKasusList(_kpKasusCtx));
    wireKasusDownloadButtons(_kpKasusCtx);
    document.getElementById('kp-kasus-filter-btn')
        ?.addEventListener('click', () => loadKasusList(false, _kpKasusCtx));
    await loadKasusList(false, _kpKasusCtx);
}

async function loadKpPerhatian({ programId, config }) {
    const el = document.getElementById('kp-perhatian-content');
    if (!el) return;
    el.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const classes = await getClassesByProgram(programId);
        if (!classes.length) { el.innerHTML = '<p class="hint">Belum ada kelas di program ini.</p>'; return; }
        const classDataList = await Promise.all(
            classes.sort((a, b) => a.name.localeCompare(b.name, 'id')).map(async cls => {
                const rows = await getWaliAttendanceSummary(cls.class_id, config.current_academic_year, null, null, config.current_semester);
                const perhatian = filterPerhatian(rows);
                return { class_id: cls.class_id, name: cls.name, perhatian, roster: rows };
            })
        );
        renderPerhatianAccordion(el, classDataList);
    } catch (err) {
        el.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat: ${esc(String(err?.message ?? err))}</p>`;
    }
}

function renderKpSummary() {
    const placed = kpStudents.filter(s => s.has_placement).length;
    document.getElementById('kp-stat-total').textContent    = kpStudents.length;
    document.getElementById('kp-stat-placed').textContent   = placed;
    document.getElementById('kp-stat-unplaced').textContent = kpStudents.length - placed;
}

function renderKpStudents() {
    const tbody = document.getElementById('kp-students-body');
    const empty = document.getElementById('kp-students-empty');
    if (kpStudents.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = kpStudents.map(s => `<tr>
        <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
        <td>${esc(s.dudi_name)}</td>
        <td>${s.has_placement ? `${fmt(s.start_date)} – ${fmt(s.end_date)}` : '<span class="badge badge-tidak-hadir">Belum</span>'}</td>
        <td>${s.has_placement
            ? `<button class="btn btn-sm btn-secondary kp-finish-btn"
                data-student-id="${esc(s.student_id)}"
                data-placement-id="${esc(s.placement_id)}"
                data-nama="${esc(s.full_name)}"
                style="font-size:11px;padding:3px 8px">Selesaikan PKL</button>`
            : '—'}</td>
    </tr>`).join('');
}

async function _handleFinishPkl(btn) {
    const { studentId, placementId, nama } = btn.dataset;
    if (!confirm(`Selesaikan PKL ${nama}? Status akan kembali ke AKTIF.`)) return;
    btn.disabled = true; btn.textContent = 'Memproses…';
    try {
        await finishPlacement(studentId, placementId);
        kpStudents      = await fetchPklStudents(kpProgramId);
        kpAktifStudents = await fetchNonPklStudents(kpProgramId);
        const seen = new Set(kpStudents.map(s => s.student_id));
        kaprodiAllStudents = [...kpStudents, ...kpAktifStudents.filter(s => !seen.has(s.student_id))];
        renderKpSummary();
        renderKpStudents();
        // Reload dropdown siswa di form penempatan
        const sel = document.getElementById('kp-pl-student');
        if (sel) {
            sel.innerHTML = '<option value="">-- Pilih siswa --</option>';
            kpAktifStudents.forEach(s => {
                const o = document.createElement('option');
                o.value = s.student_id; o.textContent = `${s.full_name} (${s.nis})`;
                sel.appendChild(o);
            });
        }
        if (_kpKasusCtx) {
            _kpKasusCtx.extraQuery.studentIds = [...new Set(kaprodiAllStudents.map(s => s.student_id))];
        }
    } catch (err) {
        btn.disabled = false; btn.textContent = 'Selesaikan PKL';
        alert(`Gagal: ${fe(err)}`);
    }
}

function renderKpDudi() {
    const tbody = document.getElementById('kp-dudi-body');
    const empty = document.getElementById('kp-dudi-empty');
    if (kpDudiList.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = kpDudiList.map(d => `<tr>
        <td>${esc(d.org_name)}</td><td>${esc(d.pic_name)}</td>
    </tr>`).join('');
}

// ─── Rekap PKL (jalur DUDI) ──────────────────────────────────

async function loadKpRecap() {
    const ids   = kpStudents.map(s => s.student_id);
    const start = document.getElementById('kp-date-start').value || null;
    const end   = document.getElementById('kp-date-end').value   || null;
    const seq   = ++kpRecapSeq;
    const tbody = document.getElementById('kp-recap-body');
    const empty = document.getElementById('kp-recap-empty');
    tbody.innerHTML = '<tr><td colspan="6" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';

    if (ids.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    try {
        const rows = await fetchPklAttendance(ids, start, end);
        if (seq !== kpRecapSeq) return;
        const nameById = new Map(kpStudents.map(s => [s.student_id, { name: s.full_name, nis: s.nis }]));
        const recap = rows.map(r => ({ ...nameById.get(r.student_id), ...r }));
        if (recap.every(a => a.total === 0)) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = recap.map(a => {
            const pct   = a.total > 0 ? Math.round(a.HADIR / a.total * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(a.name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted)">${esc(a.nis ?? '—')}</span></td>
                <td style="text-align:center">${a.HADIR}</td>
                <td style="text-align:center">${a.IZIN}</td>
                <td style="text-align:center">${a.SAKIT}</td>
                <td style="text-align:center">${a.ALPA}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${a.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        if (seq !== kpRecapSeq) return;
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

// ─── Rekap Kelas (jalur reguler) ─────────────────────────────

async function loadKpClsRecap({ config }) {
    const dateStart = document.getElementById('kp-cls-start').value || null;
    const dateEnd   = document.getElementById('kp-cls-end').value   || null;
    const seq       = ++kpClsRecapSeq;
    const container = document.getElementById('kp-cls-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';

    if (!kpAktifStudents.length) {
        container.innerHTML = '<p class="hint">Belum ada siswa aktif di program ini.</p>';
        return;
    }

    try {
        const classes = await getClassesByProgram(kpProgramId);
        if (!classes.length) {
            container.innerHTML = '<p class="hint">Belum ada kelas di program ini.</p>';
            return;
        }

        const allRows  = await getAttendanceRecapPerClass(dateStart, dateEnd);
        if (seq !== kpClsRecapSeq) return;
        const classIds = new Set(classes.map(c => c.class_id));
        const rows     = allRows.filter(r => classIds.has(r.class_id));

        // Kelas tanpa data tetap muncul dengan nilai nol
        const attById    = new Map(rows.map(r => [r.class_id, r]));
        const allClsRows = classes.map(c => attById.get(c.class_id) ?? {
            class_id: c.class_id, name: c.name, HADIR: 0, IZIN: 0, SAKIT: 0, ALPA: 0, total: 0,
        });

        const sorted = allClsRows.sort((a, b) => a.name.localeCompare(b.name, 'id'));
        container.innerHTML = sorted.map((r, idx) => {
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
                    <button class="btn btn-secondary btn-sm kp-kls-excel-btn"
                        data-class-id="${esc(r.class_id)}" data-class-name="${esc(r.name)}"
                        style="font-size:11px;padding:2px 8px;flex-shrink:0">↓ Excel</button>
                </div>`;
            }).join('');

        container.querySelectorAll('.kp-kls-excel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const { classId, className: classLabel } = btn.dataset;
                downloadKelasExcel({ classId, classLabel, config, btn });
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ─── Download Excel Rekap Kelas ───────────────────────────────

export const MONTHS_RANGE = [
    ['2026-07-01','2026-07-31'],['2026-08-01','2026-08-31'],
    ['2026-09-01','2026-09-30'],['2026-10-01','2026-10-31'],
    ['2026-11-01','2026-11-30'],['2026-12-01','2026-12-31'],
    ['2027-01-01','2027-01-31'],['2027-02-01','2027-02-28'],
    ['2027-03-01','2027-03-31'],['2027-04-01','2027-04-30'],
    ['2027-05-01','2027-05-31'],['2027-06-01','2027-06-30'],
];

/**
 * Bangun dan unduh workbook Excel satu prodi.
 * Bisa dipanggil dari tab Kaprodi maupun tab Waka Kesiswaan.
 */
export async function downloadKelasExcel({ classId, classLabel, config, btn }) {
    if (btn) { btn.disabled = true; btn.textContent = 'Menyiapkan…'; }
    try {
        const academicYear = config.current_academic_year;
        const [students, scheduleRows, ...monthlyRekaps] = await Promise.all([
            getWaliAttendanceSummary(classId, academicYear, null, null, config.current_semester),
            getClassScheduleFull(classId, academicYear, null, null),
            ...MONTHS_RANGE.map(([ds, de]) =>
                getWaliAttendanceSummary(classId, academicYear, ds, de, null)
            ),
        ]);
        if (!students.length) { alert('Belum ada data kehadiran untuk kelas ini.'); return; }

        const monthlyMap = {};
        MONTHS_RANGE.forEach(([ds], i) => {
            const mon = ds.slice(0, 7);
            const m = new Map();
            for (const r of monthlyRekaps[i])
                m.set(r.student_id, { H: r.HADIR, S: r.SAKIT, I: r.IZIN, A: r.ALPA, tot: r.total });
            monthlyMap[mon] = m;
        });

        const sheets = buildWaliSheetsMonthly({ students, scheduleRows, monthlyMap, className: classLabel, academicYear });
        const wb     = XLSX.utils.book_new();
        for (const { name, ws } of sheets)
            XLSX.utils.book_append_sheet(wb, ws, name);

        const safeName = classLabel.replace(/\s+/g, '_').slice(0, 40);
        const buf  = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `rekap_absen_kaprodi_${safeName}_${academicYear}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
        alert('Gagal mengunduh: ' + fe(err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↓ Excel'; }
    }
}

export async function downloadProdiExcel({ programId, prodiLabel, config, btn }) {
    if (btn) { btn.disabled = true; btn.textContent = 'Menyiapkan…'; }
    try {
        const classes = await getClassesByProgram(programId);
        if (!classes.length) { alert('Belum ada kelas di program ini.'); return; }

        const academicYear = config.current_academic_year;
        const ALPA_MIN = 2, HADIR_MIN = 0.75;
        const MONTH_LABEL = {
            '07':'Juli','08':'Agustus','09':'September',
            '10':'Oktober','11':'November','12':'Desember',
            '01':'Januari','02':'Februari','03':'Maret',
            '04':'April','05':'Mei','06':'Juni',
        };

        const sorted = [...classes].sort((a, b) => a.name.localeCompare(b.name, 'id'));
        const classIds = new Set(sorted.map(c => c.class_id));

        // Kueri per-kelas berurutan untuk hindari timeout
        const clsResults = [];
        for (let i = 0; i < sorted.length; i++) {
            const c = sorted[i];
            if (btn) btn.textContent = `Menyiapkan… (${i + 1}/${sorted.length})`;
            const students = await getWaliAttendanceSummary(c.class_id, academicYear, null, null, config.current_semester);
            clsResults.push({ cls: c, students });
        }
        if (btn) btn.textContent = 'Menyiapkan tren…';
        const monthlyRekaps = await Promise.all(
            MONTHS_RANGE.map(([ds, de]) => getAttendanceRecapPerClass(ds, de))
        );

        const allStudents = clsResults.flatMap(d => d.students);
        if (!allStudents.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }

        let gH = 0, gS = 0, gI = 0, gA = 0;
        for (const s of allStudents) { gH += s.HADIR ?? 0; gS += s.SAKIT ?? 0; gI += s.IZIN ?? 0; gA += s.ALPA ?? 0; }
        const gTot = gH + gS + gI + gA;
        const pctProdi = gTot > 0 ? Math.round(gH / gTot * 100) + '%' : '—';

        const monthlyTotals = monthlyRekaps.map(rows => {
            let H = 0, S = 0, I = 0, A = 0;
            for (const r of rows.filter(r => classIds.has(r.class_id)))
                { H += r.HADIR ?? 0; S += r.SAKIT ?? 0; I += r.IZIN ?? 0; A += r.ALPA ?? 0; }
            return { H, S, I, A };
        });

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

        // ── Styling ───────────────────────────────────────────────────────────
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

        // ── Susun baris ───────────────────────────────────────────────────────
        const rows = [];
        rows.push([cc(`LAPORAN KEHADIRAN — ${prodiLabel}`, ST.title)]);
        rows.push([cc(`Tahun Ajaran: ${academicYear}  |  Data seluruh periode aktif`, ST.italic9)]);
        rows.push(null);
        rows.push([
            cc('JUMLAH SISWA', ST.section), cc(allStudents.length, ST.num), null,
            cc('JUMLAH KELAS', ST.section), cc(sorted.length, ST.num), null,
            cc('TINGKAT HADIR', ST.section),
            cc(pctProdi, gTot > 0 && gH / gTot < HADIR_MIN ? ST.pctBad : ST.pctOk),
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
        rows.push([cc('Data detail kehadiran per kelas tersedia melalui tombol ↓ Excel di baris kelas.', ST.italic9)]);

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
        a.href = url;
        const safeName = prodiLabel.replace(/\s+/g, '_').slice(0, 40);
        a.download = `rekap_absen_kaprodi_${safeName}_${academicYear}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
        alert('Gagal mengunduh: ' + fe(err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↓ Excel'; }
    }
}

async function downloadKpClsExcel({ config }) {
    const btn = document.getElementById('kp-cls-export-btn');
    await downloadProdiExcel({ programId: kpProgramId, prodiLabel: 'Prodi', config, btn });
    if (btn) btn.textContent = '↓ Excel';
}

// ─── Observasi dari DUDI ──────────────────────────────────────

async function loadKpObs() {
    const ids    = kpStudents.map(s => s.student_id);
    const hintEl = document.getElementById('kp-obs-hint');
    const listEl = document.getElementById('kp-obs-list');
    listEl.innerHTML = '';
    if (ids.length === 0) { hintEl.style.display = 'block'; return; }
    try {
        const rows = await fetchDudiObservations(ids);
        if (rows.length === 0) { hintEl.style.display = 'block'; return; }
        hintEl.style.display = 'none';
        const nameById = new Map(kpStudents.map(s => [s.student_id, s.full_name]));
        listEl.innerHTML = rows.map(r => `
            <div class="obs-card obs-${r.sentiment.toLowerCase()}">
                <div class="obs-meta"><strong>${esc(nameById.get(r.student_id) ?? '—')}</strong>
                    &middot; ${esc(r.author)} &middot; ${DIMENSION_LABELS[r.dimension] ?? r.dimension} &middot; ${fmt(r.date)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>`).join('');
    } catch (err) {
        listEl.innerHTML = `<div class="status-err">${esc(fe(err))}</div>`;
    }
}

// ─── Form Penempatan PKL ──────────────────────────────────────

async function initKpPlacementForm(programId) {
    async function reloadStudentSelect() {
        const el = document.getElementById('kp-pl-student');
        el.innerHTML = '<option value="">-- Pilih siswa --</option>';
        const nonPkl = await fetchNonPklStudents(programId);
        nonPkl.forEach(s => {
            const o = document.createElement('option');
            o.value = s.student_id; o.textContent = `${s.full_name} (${s.nis})`;
            el.appendChild(o);
        });
    }
    function populateDudiSelect() {
        const el = document.getElementById('kp-pl-dudi');
        el.innerHTML = '<option value="">-- Pilih DUDI --</option>';
        kpDudiList.forEach(d => {
            const o = document.createElement('option');
            o.value = d.user_id; o.textContent = d.org_name;
            el.appendChild(o);
        });
    }
    await reloadStudentSelect();
    populateDudiSelect();

    document.getElementById('kp-placement-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const resultEl = document.getElementById('kp-placement-result');
        const btn = document.getElementById('kp-pl-submit');
        btn.disabled = true; btn.textContent = 'Menyimpan…';
        resultEl.innerHTML = '';
        try {
            await createPlacement({
                studentId:  document.getElementById('kp-pl-student').value,
                dudiUserId: document.getElementById('kp-pl-dudi').value,
                startDate:  document.getElementById('kp-pl-start').value,
                endDate:    document.getElementById('kp-pl-end').value,
            });
            resultEl.innerHTML = '<p style="color:var(--color-success)">✓ Penempatan berhasil disimpan.</p>';
            kpStudents = await fetchPklStudents(programId);
            renderKpSummary(); renderKpStudents();
            await reloadStudentSelect();
        } catch (err) {
            resultEl.innerHTML = `<p style="color:var(--color-danger)">✗ ${esc(fe(err))}</p>`;
        } finally {
            btn.disabled = false; btn.textContent = 'Simpan Penempatan';
        }
    });

    document.getElementById('kp-dl-template').addEventListener('click', () => {
        const csv = 'nis,login_dudi,tanggal_mulai,tanggal_selesai\n12345,cv-maju-bersama,2027-07-01,2027-09-30\n';
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
            download: 'template_penempatan_pkl.csv',
        });
        a.click();
    });

    const fileInput = document.getElementById('kp-file-input');
    document.getElementById('kp-import-btn').onclick = () => fileInput.click();
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        const resultEl = document.getElementById('kp-placement-result');
        resultEl.innerHTML = '<p class="hint">Mengimpor…</p>';
        try {
            if (!file.name.endsWith('.csv')) throw new Error('Gunakan format CSV.');
            const csv = await file.text();
            const result = await bulkImportPkl(csv);
            resultEl.innerHTML = `<p style="color:var(--color-success)">✓ Selesai — ${result.success} berhasil, ${result.skipped} dilewati, ${result.failed} gagal.</p>`;
            kpStudents = await fetchPklStudents(programId);
            renderKpSummary(); renderKpStudents();
            await reloadStudentSelect();
        } catch (err) {
            resultEl.innerHTML = `<p style="color:var(--color-danger)">✗ ${esc(fe(err))}</p>`;
        } finally {
            fileInput.value = '';
        }
    });
}

// ── Rekap Keterlambatan (piket) — hanya siswa program ini (dijaga RLS) ────────
async function loadKpLateRecap({ config, programId }) {
    const seq       = ++_kpLateSeq;
    const start     = document.getElementById('kp-late-start').value;
    const end       = document.getElementById('kp-late-end').value;
    const classId   = document.getElementById('kp-late-class')?.value || '';
    const container = document.getElementById('kp-late-recap');
    if (!start || !end || start > end) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        let rows = await getLateArrivalsByRange(start, end, config?.current_academic_year ?? null);
        if (seq !== _kpLateSeq) return;
        if (classId) rows = rows.filter(r => r.class_id === classId);
        _cachedKpLate = rows;
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
                    <th>Tanggal</th><th>Nama Siswa</th>
                    <th>Kelas</th><th>Jam Datang</th><th>Alasan</th><th>Dicatat Oleh</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td style="white-space:nowrap">${fmtDisp(r.date)}</td>
                        <td>${esc(r.student_name)}</td>
                        <td>${esc(r.class_name)}</td>
                        <td style="white-space:nowrap">${r.arrival_time.slice(0, 5)}</td>
                        <td>${esc(r.reason || '—')}</td>
                        <td>${esc(r.recorder)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        if (seq !== _kpLateSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ── Rekap Izin Keluar (piket) — hanya siswa program ini (dijaga RLS) ──────────
async function loadKpExitRecap({ config, programId }) {
    const seq       = ++_kpExitSeq;
    const start     = document.getElementById('kp-exit-start').value;
    const end       = document.getElementById('kp-exit-end').value;
    const classId   = document.getElementById('kp-exit-class')?.value || '';
    const container = document.getElementById('kp-exit-recap');
    if (!start || !end || start > end) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        let rows = await getExitsByRange(start, end, config?.current_academic_year ?? null);
        if (seq !== _kpExitSeq) return;
        if (classId) rows = rows.filter(r => r.class_id === classId);
        _cachedKpExit = rows;
        if (!rows.length) {
            container.innerHTML = '<p class="hint">Tidak ada catatan izin keluar pada rentang ini.</p>';
            return;
        }
        const fmtDisp = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        container.innerHTML = `
            <p class="hint" style="margin-bottom:8px">${rows.length} catatan ditemukan</p>
            <div style="overflow-x:auto">
            <table class="table" style="width:100%">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th>
                    <th>Kelas</th><th>Jam Keluar</th><th>Jam Kembali</th><th>Alasan</th><th>Dicatat Oleh</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td style="white-space:nowrap">${fmtDisp(r.date)}</td>
                        <td>${esc(r.student_name)}</td>
                        <td>${esc(r.class_name)}</td>
                        <td style="white-space:nowrap">${r.exit_time ? r.exit_time.slice(0, 5) : '—'}</td>
                        <td style="white-space:nowrap">${r.return_time ? r.return_time.slice(0, 5) : '<span style="color:var(--color-danger,#dc2626)">Belum kembali</span>'}</td>
                        <td>${esc(r.reason || '—')}</td>
                        <td>${esc(r.recorder)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        if (seq !== _kpExitSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}
