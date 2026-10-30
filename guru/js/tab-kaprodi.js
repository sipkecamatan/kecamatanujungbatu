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
    createPlacement, finishPlacement, bulkImportPkl,
} from './api.js';
import { esc, fe, fmt, localDateStr, buildPertemuanMeta } from './tab-shared.js';

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
        document.getElementById('kp-cls-export-btn').onclick = () => downloadKpClsExcel({ config });

        const studentsBody = document.getElementById('kp-students-body');
        studentsBody.removeEventListener('click', _handleKpStudentsClick);
        studentsBody.addEventListener('click', _handleKpStudentsClick);

        await Promise.all([loadKpRecap(), loadKpClsRecap({ config }), loadKpObs(), initKpPlacementForm(programId)]);
        await _initKaprodiKasusSection({ makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList });

        document.querySelectorAll('#kp-accordion .kp-acc-header').forEach(header => {
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);
            newHeader.addEventListener('click', () => {
                const targetId = newHeader.dataset.target;
                const isOpen   = newHeader.closest('.kp-acc-item').classList.contains('open');
                document.querySelectorAll('#kp-accordion .kp-acc-item').forEach(item => {
                    item.classList.remove('open');
                    item.querySelector('.kp-acc-body').style.display = 'none';
                });
                if (!isOpen) {
                    const item = newHeader.closest('.kp-acc-item');
                    item.classList.add('open');
                    document.getElementById(targetId).style.display = 'block';
                }
            });
        });
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

        container.innerHTML = allClsRows
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
            .map((r, idx) => {
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

        document.getElementById('kp-cls-export-btn').style.display = '';

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ─── Download Excel Rekap Kelas ───────────────────────────────

async function downloadKpClsExcel({ config }) {
    const btn = document.getElementById('kp-cls-export-btn');
    btn.disabled = true;
    btn.textContent = 'Menyiapkan…';
    try {
        const classes = await getClassesByProgram(kpProgramId);
        if (!classes.length) return;

        const academicYear = config.current_academic_year;
        const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };
        const PRIO         = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };

        const wb = XLSX.utils.book_new();

        // Ambil semua data paralel — roster nama/NIS + detail per tanggal
        const results = await Promise.all(
            classes.map(c => Promise.all([
                getClassStudents(c.class_id),
                getClassAttendanceByDate(c.class_id, academicYear, null, null),
            ]).then(([roster, detail]) => ({ cls: c, roster, detail })))
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

            // Nama sheet max 31 karakter (batas Excel)
            const sheetName = cls.name.slice(0, 31);
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...dataRows]), sheetName);
        }

        if (!wb.SheetNames.length) { alert('Belum ada data kehadiran untuk diunduh.'); return; }
        XLSX.writeFile(wb, `rekap_absensi_kelas_${academicYear}.xlsx`);
    } catch (err) {
        alert('Gagal mengunduh: ' + fe(err));
    } finally {
        btn.disabled = false;
        btn.textContent = 'Unduh Excel';
    }
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
