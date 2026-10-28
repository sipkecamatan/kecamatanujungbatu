/**
 * @file guru/js/tab-waka-humas.js
 * Tab Waka Humas — rekap PKL, DUDI, observasi, dan kasus PKL.
 */
import {
    fetchAllPklStudents, fetchAllDudiPartners,
    fetchPklAttendance, fetchDudiObservations,
    getOpenCases,
} from './api.js';
import { esc, fe, fmt } from './tab-shared.js';

const DIMENSION_LABELS = {
    AKADEMIK: 'Akademik', KEHADIRAN: 'Kehadiran', PERILAKU: 'Perilaku',
    SOSIAL: 'Sosial', AFEKTIF: 'Afektif', BAKAT_MINAT: 'Bakat & Minat',
    FISIK: 'Fisik', LAINNYA: 'Lainnya',
};

const CASE_STATUS_LABEL = {
    OPEN: 'Buka', UNDER_REVIEW: 'Ditinjau', INTERVENTION: 'Intervensi',
    MONITORING: 'Monitoring', CLOSED: 'Tutup',
};

function localDateStr(d = new Date()) {
    return d.toLocaleDateString('sv-SE');
}

let whStudents = [];
let whDudiList = [];
let _whTabInit = false;

export async function initWakaHumasTab({ currentUser }) {
    if (_whTabInit) return;
    _whTabInit = true;

    const today    = localDateStr();
    const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
    document.getElementById('wh-date-start').value = monthAgo;
    document.getElementById('wh-date-end').value   = today;
    document.getElementById('wh-filter-btn').onclick = loadWhRecap;

    try {
        [whStudents, whDudiList] = await Promise.all([
            fetchAllPklStudents(),
            fetchAllDudiPartners(),
        ]);
        renderWhStats();
        renderWhStudents();
        renderWhDudi();
        await Promise.all([loadWhRecap(), loadWhObs(), loadWhCases(currentUser)]);
    } catch (err) {
        console.error('[waka_humas]', err);
        _whTabInit = false;
        const container = document.getElementById('tab-waka_humas');
        if (container) {
            const errEl = document.createElement('p');
            errEl.style.cssText = 'color:var(--color-danger);padding:12px 0;';
            errEl.textContent = 'Gagal memuat data Waka Humas. Silakan muat ulang halaman.';
            container.prepend(errEl);
        }
    }
}

function renderWhStats() {
    const placed = whStudents.filter(s => s.has_placement).length;
    document.getElementById('wh-stat-total').textContent  = whStudents.length;
    document.getElementById('wh-stat-placed').textContent = placed;
    document.getElementById('wh-stat-dudi').textContent   = whDudiList.length;
}

function renderWhStudents() {
    const tbody = document.getElementById('wh-students-body');
    const empty = document.getElementById('wh-students-empty');
    if (whStudents.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = whStudents.map(s => `<tr>
        <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
        <td>${esc(s.program_name)}</td>
        <td>${esc(s.dudi_name)}</td>
        <td>${s.has_placement ? `${fmt(s.start_date)} – ${fmt(s.end_date)}` : '<span class="badge badge-tidak-hadir">Belum</span>'}</td>
    </tr>`).join('');
}

function renderWhDudi() {
    const tbody = document.getElementById('wh-dudi-body');
    const empty = document.getElementById('wh-dudi-empty');
    if (whDudiList.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = whDudiList.map(d => `<tr>
        <td>${esc(d.org_name)}</td><td>${esc(d.pic_name)}</td><td>${esc(d.program_name)}</td>
    </tr>`).join('');
}

async function loadWhRecap() {
    const ids   = whStudents.map(s => s.student_id);
    const start = document.getElementById('wh-date-start').value;
    const end   = document.getElementById('wh-date-end').value;
    const tbody = document.getElementById('wh-recap-body');
    const empty = document.getElementById('wh-recap-empty');
    tbody.innerHTML = '<tr><td colspan="7" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';

    if (ids.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    try {
        const rows = await fetchPklAttendance(ids, start, end);
        const nameMap = new Map(whStudents.map(s => [s.student_id, { name: s.full_name, prog: s.program_name }]));
        const recap = rows.filter(r => nameMap.has(r.student_id))
            .map(r => ({ ...nameMap.get(r.student_id), ...r }));
        if (recap.every(a => a.total === 0)) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = recap.map(a => {
            const pct = a.total > 0 ? Math.round(a.HADIR / a.total * 100) : 0;
            return `<tr><td>${esc(a.name)}</td><td>${esc(a.prog)}</td><td>${a.HADIR}</td><td>${a.SAKIT}</td><td>${a.IZIN}</td><td>${a.ALPA}</td><td>${a.total > 0 ? pct + '%' : '—'}</td></tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadWhObs() {
    const ids    = whStudents.map(s => s.student_id);
    const hintEl = document.getElementById('wh-obs-hint');
    const listEl = document.getElementById('wh-obs-list');
    listEl.innerHTML = '';
    if (ids.length === 0) { hintEl.style.display = 'block'; return; }
    try {
        const rows = await fetchDudiObservations(ids);
        if (rows.length === 0) { hintEl.style.display = 'block'; return; }
        hintEl.style.display = 'none';
        const nameById = new Map(whStudents.map(s => [s.student_id, s.full_name]));
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

async function loadWhCases(currentUser) {
    const tbody = document.getElementById('wh-cases-body');
    const empty = document.getElementById('wh-cases-empty');
    tbody.innerHTML = '<tr><td colspan="4" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';
    try {
        const cases = await getOpenCases(currentUser.school_id, 'PKL');
        if (cases.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = cases.map(c => `<tr>
            <td>${esc(c.student?.full_name ?? '—')}</td>
            <td>${esc(c.title)}</td>
            <td>${esc(CASE_STATUS_LABEL[c.status] ?? c.status)}</td>
            <td>${fmt(c.created_at)}</td>
        </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}
