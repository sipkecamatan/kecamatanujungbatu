/**
 * @file guru/js/tab-waka-kurikulum.js
 * Tab Waka Kurikulum — statistik kehadiran guru, sesi belum diisi, rekap rentang.
 */
import {
    getWakaKurStats,
    getPendingSessionsByTeacher, getPendingSessionsDetail,
} from './api.js';
import { pasangNilaiPimpinan } from './nilai-pimpinan-ui.js';
import { pasangNilaiRaporKelas } from './nilai-rapor-kelas-ui.js';
import { pasangKunciPeriode } from './kunci-periode-ui.js';
import { esc, fe, fmtTime, localDateStr } from './tab-shared.js';

let _wkKur2Visible = false;
let _wkKur2Seq     = 0;
let _wkKurTabInit  = false;
const _wkKurStatsSeq = {};

export async function initWakaKurTab({ config, panel } = {}) {
    const tabEl = panel ?? document.getElementById('tab-waka_kurikulum');
    pasangNilaiPimpinan(tabEl, { esc, tahun: config?.current_academic_year, semester: config?.current_semester });
    pasangNilaiRaporKelas(tabEl, { esc, mode: 'pimpinan', tahun: config?.current_academic_year, semester: config?.current_semester });
    pasangKunciPeriode(tabEl, { esc, tahun: config?.current_academic_year, semester: config?.current_semester });
    if (!_wkKurTabInit) {
        _wkKurTabInit = true;
        const today = localDateStr();
        document.getElementById('wk-kur-start').value = today;
        document.getElementById('wk-kur-end').value   = today;
        document.getElementById('wk-kur2-btn').onclick = handleWkKur2Btn;
        await loadWkKur2();
    }
}

async function loadWkKurStats(dateStart, dateEnd, prefix = 'wk-kur2', emptyMsg = 'Tidak ada sesi hari ini') {
    const elHadir       = document.getElementById(`${prefix}-val-hadir`);
    const elPending     = document.getElementById(`${prefix}-val-pending`);
    const elDetailSudah = document.getElementById(`${prefix}-detail-sudah`);
    const elDetailBelum = document.getElementById(`${prefix}-detail-belum`);

    if (!elHadir) return;

    const seq = (_wkKurStatsSeq[prefix] || 0) + 1;
    _wkKurStatsSeq[prefix] = seq;
    elHadir.textContent = '…'; elPending.textContent = '…';
    if (elDetailSudah) elDetailSudah.textContent = '';
    if (elDetailBelum) elDetailBelum.textContent = '';

    try {
        const d = await getWakaKurStats(dateStart, dateEnd);
        if (seq !== _wkKurStatsSeq[prefix]) return;

        elHadir.textContent = (d.pct_hadir != null) ? d.pct_hadir + '%' : '—';
        if (elDetailSudah) {
            elDetailSudah.textContent = d.guru_total > 0
                ? `${d.guru_hadir} / ${d.guru_total} guru sudah input absensi`
                : emptyMsg;
        }

        elPending.textContent = d.guru_belum;
        if (elDetailBelum) {
            elDetailBelum.textContent = d.guru_total === 0 ? emptyMsg
                : d.guru_belum > 0 ? `${d.guru_belum} guru masih memiliki sesi belum diisi`
                : 'Tidak ada sesi yang belum diisi.';
        }

    } catch (e) {
        if (seq !== _wkKurStatsSeq[prefix]) return;
        elHadir.textContent = '!'; elPending.textContent = '!';
        if (elDetailSudah) elDetailSudah.textContent = 'Gagal memuat ringkasan.';
        if (elDetailBelum) elDetailBelum.textContent = fe(e);
        console.error('[loadWkKurStats]', e);
    }
}


async function loadWkKur2() {
    const seq = ++_wkKur2Seq;
    _wkKurStatsSeq['wk-kur2'] = (_wkKurStatsSeq['wk-kur2'] || 0) + 1;
    const hintEl    = document.getElementById('wk-kur2-hint');
    const wrapEl    = document.getElementById('wk-kur2-wrap');
    const tbody     = document.getElementById('wk-kur2-body');
    const btn       = document.getElementById('wk-kur2-btn');
    const dateStart = document.getElementById('wk-kur-start').value || null;
    const dateEnd   = document.getElementById('wk-kur-end').value || null;

    const statsRow = document.getElementById('wk-kur2-stats-row');
    hintEl.style.display    = 'none';
    wrapEl.style.display    = 'none';
    statsRow.style.display  = 'none';
    tbody.innerHTML         = '';
    _wkKur2Visible          = false;
    if (dateStart && dateEnd && dateStart > dateEnd) {
        hintEl.textContent = 'Tanggal awal tidak boleh melewati tanggal akhir.';
        hintEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Tampilkan';
        return;
    }
    btn.disabled            = true;
    btn.textContent         = 'Memuat…';

    try {
        const [groups] = await Promise.all([
            getPendingSessionsByTeacher(dateStart, dateEnd),
            loadWkKurStats(dateStart, dateEnd, 'wk-kur2', 'Tidak ada sesi pada rentang ini'),
        ]);
        if (seq !== _wkKur2Seq) return;
        statsRow.style.display = '';
        btn.disabled = false;
        if (groups.length === 0) {
            hintEl.textContent   = '✓ Tidak ada sesi yang menunggu pengisian absensi pada rentang ini.';
            hintEl.style.display = 'block';
            btn.textContent      = 'Sembunyikan';
            _wkKur2Visible = true;
            return;
        }

        groups.sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, 'id'));
        let html = '';
        groups.forEach((row, idx) => {
            const count      = Number(row.jumlah);
            const detailId   = `wk-kur2-detail-${idx}`;
            const countBadge = `<span style="font-size:11px;background:var(--color-surface-raised,rgba(0,0,0,.12));border-radius:4px;padding:1px 6px;margin-left:4px">${count} sesi</span>`;
            html += `<tr style="cursor:pointer" data-detail-id="${detailId}" data-teacher-id="${row.teacher_id}" data-start="${esc(dateStart||'')}" data-end="${esc(dateEnd||'')}">
                <td style="text-align:center">${idx + 1}</td>
                <td>${esc(row.teacher_name)}${countBadge}</td>
                <td style="text-align:center;font-size:18px;color:var(--color-text-muted)">&#8250;</td>
            </tr>
            <tr id="${detailId}" style="display:none" data-loaded="0">
                <td colspan="3" style="padding:0">
                    <table style="width:100%;border-collapse:collapse;background:var(--color-surface-raised,rgba(0,0,0,.15))">
                        <thead><tr style="font-size:11px;color:var(--color-text-muted)">
                            <th style="padding:6px 12px;text-align:left">Tanggal</th>
                            <th style="padding:6px 12px;text-align:left">Sesi</th>
                            <th style="padding:6px 12px;text-align:left">Mata Pelajaran</th>
                            <th style="padding:6px 12px;text-align:left">Kelas</th>
                        </tr></thead>
                        <tbody id="${detailId}-body"><tr><td colspan="4" style="padding:8px 12px;color:var(--color-text-muted)">Memuat…</td></tr></tbody>
                    </table>
                </td>
            </tr>`;
        });
        tbody.innerHTML = html;
        tbody.querySelectorAll('tr[data-detail-id]').forEach(tr => {
            tr.addEventListener('click', () => {
                _wkKur2ToggleDetail(
                    tr.dataset.detailId,
                    tr.dataset.teacherId,
                    tr.dataset.start || null,
                    tr.dataset.end   || null,
                );
            });
        });
        wrapEl.style.display = '';
        btn.textContent      = 'Sembunyikan';
        _wkKur2Visible = true;
    } catch (err) {
        if (seq !== _wkKur2Seq) return;
        btn.textContent      = 'Tampilkan';
        hintEl.textContent   = `Gagal memuat data. ${fe(err)}`;
        hintEl.style.display = 'block';
    } finally {
        if (seq === _wkKur2Seq) btn.disabled = false;
    }
}

async function _wkKur2ToggleDetail(detailId, teacherId, dateStart, dateEnd) {
    const seq = _wkKur2Seq;
    const row = document.getElementById(detailId);
    if (!row) return;
    const visible = row.style.display !== 'none';
    row.style.display = visible ? 'none' : '';
    if (!visible && row.dataset.loaded === '0') {
        row.dataset.loaded = '1';
        const bodyEl = document.getElementById(detailId + '-body');
        bodyEl.innerHTML = '<tr><td colspan="4" style="padding:8px 12px;color:var(--color-text-muted)">Memuat…</td></tr>';
        try {
            const sesi = await getPendingSessionsDetail(teacherId, dateStart || null, dateEnd || null);
            if (seq !== _wkKur2Seq || !row.isConnected) return;
            bodyEl.innerHTML = sesi.length === 0
                ? `<tr><td colspan="4" style="padding:8px 12px;color:var(--color-text-muted)">Tidak ada data.</td></tr>`
                : sesi.map(s => `<tr style="font-size:13px">
                    <td style="padding:5px 12px">${esc(s.session_date ?? '—')}</td>
                    <td style="padding:5px 12px">${fmtTime(s.session_start)} – ${fmtTime(s.session_end)}</td>
                    <td style="padding:5px 12px">${esc(s.subject_name ?? '—')}</td>
                    <td style="padding:5px 12px">${esc(s.class_name ?? '—')}</td>
                </tr>`).join('');
        } catch (err) {
            if (seq !== _wkKur2Seq || !row.isConnected) return;
            row.dataset.loaded = '0';
            bodyEl.innerHTML = `<tr><td colspan="4" style="padding:8px 12px;color:var(--color-danger,#ef4444)">Gagal memuat. ${fe(err)}</td></tr>`;
        }
    }
}

function handleWkKur2Btn() {
    if (_wkKur2Visible) {
        document.getElementById('wk-kur2-wrap').style.display = 'none';
        document.getElementById('wk-kur2-stats-row').style.display = 'none';
        document.getElementById('wk-kur2-hint').style.display = 'none';
        _wkKur2Visible = false;
        document.getElementById('wk-kur2-btn').textContent = 'Tampilkan';
    } else {
        loadWkKur2();
    }
}
