/**
 * @file stakeholder/js/dashboard.js
 * Dashboard Portal Stakeholder — ringkasan agregat sekolah (view-only).
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import { initSessionGuard } from '../../shared/session-guard.js';
import {
    supabase, logout, getCurrentUserRow, isActiveStakeholder,
    getStakeholderSummary, getKepsekMonitoring, getSchoolConfig,
} from './api.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

function fmtNum(n)  { return (n ?? 0).toLocaleString('id-ID'); }
function fmtPct(n)  { return (n === null || n === undefined) ? '—' : n + '%'; }
function fmtTime(d) {
    if (!d) return '—';
    return 'Diperbarui ' + new Date(d).toLocaleString('id-ID', { timeZone:'Asia/Jakarta', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ─── MONITORING KEHADIRAN ────────────────────────────────────
// Dipindahkan dari portal guru (guru/js/dashboard.js, tab Kepsek).
// Sumber data sama persis: RPC fn_kepsek_monitoring. Nama fungsi dan
// id DOM dipertahankan agar mudah dibandingkan bila salah satunya
// berubah di kemudian hari.

const BULAN_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

let _config  = null;
let _ksChart = null;
let _monitoringFilter = { period: '7_hari', academicYear: null, dateStart: null, dateEnd: null };
let _monitoringRequest = 0;
let _summaryRequest = 0;
let _accessEnded = false;
let _accessCheck = null;

function localDateStr(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const value = type => parts.find(p => p.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}

function _prevAcademicYear() {
    const y = parseInt(_config?.current_academic_year?.split('/')[0] ?? localDateStr().slice(0, 4));
    return `${y - 1}/${y}`;
}

function fmtChartLabel(dateStr, byMonth) {
    const d = new Date(dateStr + 'T00:00:00');
    return byMonth
        ? BULAN_ID[d.getMonth()] + ' ' + d.getFullYear()
        : d.getDate() + ' ' + BULAN_ID[d.getMonth()];
}

async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.replace(getLoginUrl()); return; }

    const user = await getCurrentUserRow(auth.user);
    if (!isActiveStakeholder(user)) {
        await endStakeholderAccess();
        return;
    }

    document.getElementById('hdr-name').textContent = user.full_name;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';
    initStakeholderAccessGuard();
    await Promise.all([
        applyBrandingById(user.school_id, supabase),
        checkMustChangePassword(supabase, user),
        initLoginGuard(supabase, user),
        loadSummary(),
        getSchoolConfig().then(c => { _config = c; }).catch(() => { _config = null; }),
    ]);

    // Monitoring kehadiran — identik dengan tampilan Kepala Sekolah
    wireMonitoringControls();
    await loadKepsekMonitoring('7_hari');

    document.getElementById('refresh-btn').onclick = () => {
        loadSummary();
        const f = _monitoringFilter;
        loadKepsekMonitoring(f.period, f.academicYear, f.dateStart, f.dateEnd);
    };
    showPwaBanner({ hasBottomNav: false });
    initSessionGuard(supabase, getLoginUrl());
}

async function endStakeholderAccess() {
    if (_accessEnded) return;
    _accessEnded = true;
    ++_monitoringRequest;
    ++_summaryRequest;
    document.getElementById('app').style.display = 'none';
    clearMonitoring();
    try { await supabase.auth.signOut({ scope: 'local' }); }
    finally { window.location.replace(getLoginUrl()); }
}

async function verifyStakeholderAccess() {
    if (_accessEnded) return false;
    if (_accessCheck) return _accessCheck;
    _accessCheck = (async () => {
        const user = await getCurrentUserRow();
        if (!isActiveStakeholder(user)) {
            await endStakeholderAccess();
            return false;
        }
        return true;
    })();
    try { return await _accessCheck; }
    finally { _accessCheck = null; }
}

function initStakeholderAccessGuard() {
    const check = () => {
        if (!document.hidden) verifyStakeholderAccess().catch(err => console.error('[stakeholder access]', err));
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    setInterval(check, 60000);
}

async function loadSummary() {
    if (_accessEnded) return;
    const request = ++_summaryRequest;
    const btn    = document.getElementById('refresh-btn');
    const errBox = document.getElementById('error-box');
    btn.disabled = true;
    btn.textContent = 'Memuat…';
    errBox.style.display = 'none';

    try {
        const s = await getStakeholderSummary();
        if (request !== _summaryRequest) return;
        document.getElementById('st-siswa').textContent          = fmtNum(s.total_siswa);
        document.getElementById('st-pkl').textContent            = fmtNum(s.total_pkl);
        document.getElementById('st-staf').textContent           = fmtNum(s.total_staf);
        document.getElementById('st-program').textContent        = fmtNum(s.total_program);
        document.getElementById('st-kelas').textContent          = fmtNum(s.total_kelas);
        document.getElementById('st-sesi').textContent           = fmtNum(s.pertemuan_hari_ini);
        document.getElementById('st-hadir-hari').textContent     = fmtNum(s.guru_mengajar_hari_ini);
        document.getElementById('updated-at').textContent        = fmtTime(s.updated_at);
    } catch (err) {
        if (request !== _summaryRequest) return;
        for (const id of ['st-siswa','st-pkl','st-staf','st-program','st-kelas','st-sesi','st-hadir-hari','updated-at']) {
            document.getElementById(id).textContent = '—';
        }
        errBox.textContent   = 'Gagal memuat ringkasan. Periksa koneksi lalu coba lagi.';
        errBox.style.display = 'block';
    } finally {
        if (request === _summaryRequest) {
            btn.disabled    = false;
            btn.textContent = 'Muat Ulang';
        }
    }
}

function clearMonitoring() {
    for (const id of ['ks-pct-hadir','ks-pct-sakit','ks-pct-izin-siswa','ks-pct-alpa','ks-pct-late','ks-pct-exits','ks-pct-guru']) {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    }
    for (const id of ['ks-sub-hadir','ks-sub-sakit','ks-sub-izin-siswa','ks-sub-alpa','ks-sub-late','ks-sub-exits','ks-sub-guru','ks-chart-hint']) {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    }
    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }
}

function monitoringPct(value, total) {
    return total === 0 || value == null || !Number.isFinite(Number(value)) ? '—' : value + '%';
}

function _fmtTgl(iso) {
    const [y, m, day] = iso.split('-');
    const BLN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    return `${+day} ${BLN[+m - 1]} ${y}`;
}
function _fmtBulan(iso) {
    const [y, m] = iso.split('-');
    const BLN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    return `${BLN[+m - 1]} ${y}`;
}
function _buildChartCaption(period, d) {
    const ds = d.date_start ?? '', de = d.date_end ?? '';
    const byMonth = d.by_month;
    const noData  = !d.chart || d.chart.length === 0;
    const CARA = 'Hadir/Sakit/Izin/Alpa = % dari total catatan absensi (bukan jumlah siswa unik). ' +
                 'Guru di Kelas = % guru berjadwal yang kelasnya sudah diisi absensi (sumbu kiri). ' +
                 'Terlambat dan Izin Keluar = jumlah kejadian (sumbu kanan).';
    if (noData) return '<strong>Belum ada data</strong><br>Tidak ada catatan absensi pada periode ini.';
    let title, narasi;
    switch (period) {
        case 'hari_ini':
            title  = `Kehadiran Hari Ini — ${_fmtTgl(ds)}`;
            narasi = `Satu titik data untuk ${_fmtTgl(ds)}. ${CARA}`;
            break;
        case '7_hari':
            title  = `Tren 7 Hari Terakhir — ${_fmtTgl(ds)} s/d ${_fmtTgl(de)}`;
            narasi = `Setiap titik = satu hari sekolah dengan absensi tercatat. Hari tanpa absensi tidak muncul. ${CARA}`;
            break;
        case 'minggu_lalu':
            title  = `Tren Minggu Lalu — ${_fmtTgl(ds)} s/d ${_fmtTgl(de)}`;
            narasi = `Setiap titik = satu hari sekolah dengan absensi tercatat. ${CARA}`;
            break;
        case 'bulan_lalu':
            title  = `Tren ${_fmtBulan(ds)} — per Hari`;
            narasi = `Setiap titik = satu hari sekolah pada ${_fmtBulan(ds)}. ${CARA}`;
            break;
        case 'tahun_ajaran_lalu': {
            const tMulai = ds.split('-')[0], tAkhir = de.split('-')[0];
            title  = `Tren Tahun Ajaran ${tMulai}/${tAkhir} — per Bulan`;
            narasi = `Setiap titik = satu bulan dalam tahun ajaran ${tMulai}/${tAkhir}. ` +
                     `Hadir/Sakit/Izin/Alpa = % dari total catatan absensi bulan itu. ` +
                     `Guru di Kelas = % guru berjadwal yang kelasnya sudah diisi (sumbu kiri). ` +
                     `Terlambat dan Izin Keluar = jumlah kejadian (sumbu kanan).`;
            break;
        }
        case 'rentang':
            title  = `Rentang ${_fmtTgl(ds)} s/d ${_fmtTgl(de)} — per ${byMonth ? 'Bulan' : 'Hari'}`;
            narasi = byMonth
                ? `Rentang > 60 hari: setiap titik = satu bulan. ${CARA}`
                : `Setiap titik = satu hari sekolah dengan absensi tercatat. ${CARA}`;
            break;
        default:
            title  = 'Tren Kehadiran';
            narasi = CARA;
    }
    return `<strong>${title}</strong><br>${narasi}`;
}

async function loadKepsekMonitoring(period, academicYear = null, dateStart = null, dateEnd = null) {
    if (_accessEnded) return;
    _monitoringFilter = { period, academicYear, dateStart, dateEnd };
    const request = ++_monitoringRequest;
    const errEl  = document.getElementById('ks-monitoring-error');
    const hintEl = document.getElementById('ks-chart-hint');

    clearMonitoring();
    ['ks-pct-hadir','ks-pct-guru'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '…'; });
    errEl.style.display = 'none';

    try {
        const d = await getKepsekMonitoring(period, academicYear, dateStart, dateEnd);
        if (request !== _monitoringRequest) return;
        const s = d.summary ?? {};

        const r      = s.rincian_absensi ?? {};
        const baris  = Number(r.baris ?? 0);
        const total  = Number(s.siswa_total ?? 0);

        const pctR = (k) => baris > 0 ? Math.round(100 * Number(r[k] ?? 0) / baris) + '%' : '—';
        const subR = (k) => baris > 0 ? `${r[k] ?? 0} dari ${baris}` : '';
        const pctE = (n) => total > 0 && n != null ? Math.round(100 * Number(n) / total) + '%' : '—';
        const subE = (n) => n != null ? `${n} kejadian` : '';
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        setText('ks-pct-hadir',      pctR('hadir'));
        setText('ks-sub-hadir',      subR('hadir'));
        setText('ks-pct-sakit',      pctR('sakit'));
        setText('ks-sub-sakit',      subR('sakit'));
        setText('ks-pct-izin-siswa', pctR('izin'));
        setText('ks-sub-izin-siswa', subR('izin'));
        setText('ks-pct-alpa',       pctR('alpa'));
        setText('ks-sub-alpa',       subR('alpa'));
        setText('ks-pct-late',       pctE(s.count_late));
        setText('ks-sub-late',       subE(s.count_late));
        setText('ks-pct-exits',      pctE(s.count_exits));
        setText('ks-sub-exits',      subE(s.count_exits));
        setText('ks-pct-guru',       monitoringPct(s.pct_guru, s.guru_total));
        setText('ks-sub-guru',       `${s.guru_hadir ?? 0} / ${s.guru_total ?? 0} guru`);

        const chartData = d.chart ?? [];
        hintEl.innerHTML = _buildChartCaption(period, d);

        renderKepsekChart(chartData, d.by_month);

        // Nonaktifkan tombol Tahun Lalu bila tidak ada data untuk tahun ajaran lalu
        const btnTahunLalu = document.querySelector('.ks-period-btn[data-period="tahun_ajaran_lalu"]');
        if (btnTahunLalu) {
            const earliest = d.data_earliest;
            const _prevAyEnd = _prevAcademicYear().split('/')[1] + '-06-30';
            const noData = !earliest || earliest > _prevAyEnd;
            btnTahunLalu.disabled = noData;
            btnTahunLalu.style.opacity = noData ? '0.4' : '';
            if (noData && btnTahunLalu.classList.contains('active')) {
                btnTahunLalu.classList.remove('active');
                const btn7 = document.querySelector('.ks-period-btn[data-period="7_hari"]');
                if (btn7) btn7.classList.add('active');
                loadKepsekMonitoring('7_hari');
            }
        }
    } catch (err) {
        if (request !== _monitoringRequest) return;
        clearMonitoring();
        errEl.textContent   = `Gagal memuat data monitoring: ${err.message ?? err}`;
        errEl.style.display = 'block';
        console.error('[stakeholder monitoring]', err);
    }
}

function renderKepsekChart(chartData, byMonth) {
    const canvas = document.getElementById('ks-chart');
    const maxY2  = Math.max(10, ...chartData.map(p => p.count_late ?? 0), ...chartData.map(p => p.count_exits ?? 0));
    const pr     = chartData.length <= 14 ? 4 : 2;
    const labels = chartData.map(p => fmtChartLabel(p.date, byMonth));

    const ds = (label, key, color, yId, extra = {}) => ({
        label, yAxisID: yId, tension: 0.3, spanGaps: true, pointRadius: pr,
        borderColor: color, backgroundColor: color + '18',
        data: chartData.map(p => p[key] ?? null),
        ...extra,
    });

    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    _ksChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                ds('Hadir (%)',       'pct_hadir', '#1D9E75', 'y1', { fill: true }),
                ds('Sakit (%)',       'pct_sakit', '#f59e0b', 'y1'),
                ds('Izin (%)',        'pct_izin',  '#8b5cf6', 'y1'),
                ds('Alpa (%)',        'pct_alpa',  '#ef4444', 'y1'),
                ds('Guru di Kelas (%)', 'pct_guru','#185FA5', 'y1'),
                ds('Terlambat',    'count_late',  '#f97316', 'y2'),
                ds('Izin Keluar',  'count_exits', '#ec4899', 'y2'),
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            return ctx.dataset.yAxisID === 'y2'
                                ? `${ctx.dataset.label}: ${v != null ? v + ' siswa' : '—'}`
                                : `${ctx.dataset.label}: ${v != null ? v + '%' : '—'}`;
                        },
                    },
                },
            },
            scales: {
                y1: {
                    type: 'linear', position: 'left', min: 0, max: 100,
                    ticks: { callback: v => v + '%', font: { size: 11 } },
                    grid: { color: '#0001' },
                },
                y2: {
                    type: 'linear', position: 'right', min: 0, max: maxY2,
                    title: { display: true, text: 'Jumlah Siswa', font: { size: 10 } },
                    ticks: { font: { size: 11 }, precision: 0 },
                    grid: { drawOnChartArea: false },
                },
                x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
            },
        },
    });
}

function wireMonitoringControls() {
    document.getElementById('ks-period-toggle')?.addEventListener('click', e => {
        const btn = e.target.closest('.ks-period-btn');
        if (!btn || btn.disabled) return;
        document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const period = btn.dataset.period;
        const ayLalu = period === 'tahun_ajaran_lalu' ? _prevAcademicYear() : null;
        loadKepsekMonitoring(period, ayLalu);
    });

    document.getElementById('ks-range-btn')?.addEventListener('click', () => {
        const start = document.getElementById('ks-range-start').value;
        const end   = document.getElementById('ks-range-end').value;
        if (!start || !end) return;
        document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
        loadKepsekMonitoring('rentang', null, start, end);
    });

    // Default rentang: 7 hari terakhir
    document.getElementById('ks-range-start').value = localDateStr(new Date(Date.now() - 6 * 86400000));
    document.getElementById('ks-range-end').value   = localDateStr();
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    window.location.replace(getLoginUrl());
});

init().catch(err => console.error('[stakeholder] init failed:', err));
