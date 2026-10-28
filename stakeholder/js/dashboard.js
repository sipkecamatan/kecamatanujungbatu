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
    const ds   = d.date_start ?? '', de = d.date_end ?? '';
    const data = d.chart ?? [];
    if (data.length === 0) return '<strong>Belum ada data</strong><br>Tidak ada catatan absensi pada periode ini.';

    // ── Judul ────────────────────────────────────────────────────────────────
    let title;
    switch (period) {
        case 'hari_ini':          title = `Kehadiran Hari Ini — ${_fmtTgl(ds)}`; break;
        case '7_hari':            title = `Tren 7 Hari Terakhir — ${_fmtTgl(ds)} s/d ${_fmtTgl(de)}`; break;
        case 'minggu_lalu':       title = `Tren Minggu Lalu — ${_fmtTgl(ds)} s/d ${_fmtTgl(de)}`; break;
        case 'bulan_lalu':        title = `Tren ${_fmtBulan(ds)}`; break;
        case 'tahun_ajaran_lalu': title = `Tren Tahun Ajaran ${ds.split('-')[0]}/${de.split('-')[0]}`; break;
        case 'rentang':           title = `Rentang ${_fmtTgl(ds)} s/d ${_fmtTgl(de)}`; break;
        default:                  title = 'Tren Kehadiran';
    }

    // ── Analisis data ────────────────────────────────────────────────────────
    const vals    = key => data.map(p => p[key]).filter(v => v != null && !isNaN(v));
    const first   = key => vals(key)[0];
    const last   = key => { const v = vals(key); return v[v.length - 1]; };
    const avgV   = key => { const v = vals(key); return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null; };
    const minV   = key => Math.min(...vals(key));
    const maxV   = key => Math.max(...vals(key));
    const total  = key => data.reduce((s, p) => s + (p[key] ?? 0), 0);
    const STABIL = 3;

    function insightHadir() {
        const v = vals('pct_hadir'); if (!v.length) return null;
        const f = first('pct_hadir'), l = last('pct_hadir'), a = avgV('pct_hadir');
        const mn = minV('pct_hadir'), mx = maxV('pct_hadir'), delta = l - f;
        if (v.length === 1) {
            const absen = 100 - f;
            return absen <= 0 ? `Kehadiran siswa ${f}% — seluruh siswa hadir.`
                 : `Kehadiran siswa ${f}% — sekitar 1 dari ${Math.round(100/absen)} siswa tidak hadir.`;
        }
        if (mx - mn > 20) return `Kehadiran siswa tidak merata, antara ${mn}% dan ${mx}% — perlu ditelusuri hari-hari dengan angka rendah.`;
        if (Math.abs(delta) >= STABIL) {
            return delta > 0
                ? `Kehadiran siswa membaik dari ${f}% menjadi ${l}% — tren positif.`
                : `Kehadiran siswa turun dari ${f}% menjadi ${l}% — perlu ditelusuri penyebabnya.`;
        }
        if (a >= 90) return `Kehadiran siswa baik, konsisten di atas 90%.`;
        const absen = 100 - a;
        const dari = Math.round(100 / absen);
        return a >= 80
            ? `Kehadiran siswa ${a}% — rata-rata 1 dari ${dari} siswa tidak hadir setiap hari.`
            : `Kehadiran siswa ${a}% — di bawah 80%, perlu penanganan segera.`;
    }

    function insightAlpa() {
        const v = vals('pct_alpa'); if (!v.length) return null;
        const f = first('pct_alpa'), l = last('pct_alpa'), a = avgV('pct_alpa');
        const mn = minV('pct_alpa'), mx = maxV('pct_alpa'), delta = l - f;
        if (v.length === 1) {
            return f < 3 ? `Alpa ${f}% — terkendali.`
                 : f < 7 ? `Alpa ${f}% — perlu dipantau wali kelas.`
                 :         `Alpa ${f}% — siswa tidak hadir tanpa keterangan, perlu tindak lanjut BK.`;
        }
        if (mx - mn > 20) return `Alpa berfluktuasi antara ${mn}% dan ${mx}% — perlu ditelusuri faktor penyebabnya.`;
        if (Math.abs(delta) >= STABIL) {
            return delta > 0
                ? `Alpa naik dari ${f}% menjadi ${l}% — ketidakhadiran tanpa keterangan meningkat, perlu penanganan.`
                : `Alpa turun dari ${f}% menjadi ${l}% — perbaikan kedisiplinan siswa.`;
        }
        return a < 3 ? `Alpa terkendali di sekitar ${a}%.`
             : a < 7 ? `Alpa ${a}% — perlu dipantau wali kelas dan BK.`
             :         `Alpa ${a}% — cukup tinggi, perlu tindak lanjut segera.`;
    }

    function insightSakitIzin() {
        const vs = vals('pct_sakit'), vi = vals('pct_izin');
        const parts = [];
        const tren = (v, f, l, a) => {
            const delta = l - f;
            if (Math.abs(delta) >= STABIL) return delta > 0 ? `naik dari ${f}% menjadi ${l}%` : `turun dari ${f}% menjadi ${l}%`;
            return `stabil di ${a}%`;
        };
        if (vs.length) {
            const f = first('pct_sakit'), l = last('pct_sakit'), a = avgV('pct_sakit');
            const t = vs.length === 1 ? `${f}%` : tren(vs, f, l, a);
            parts.push(`Sakit ${t}${a >= 10 && vs.length > 1 ? ' — perlu perhatian kondisi kesehatan siswa' : ''}.`);
        }
        if (vi.length) {
            const f = first('pct_izin'), l = last('pct_izin'), a = avgV('pct_izin');
            const t = vi.length === 1 ? `${f}%` : tren(vi, f, l, a);
            parts.push(`Izin ${t}.`);
        }
        return parts.join(' ') || null;
    }

    function insightGuru() {
        const v = vals('pct_guru'); if (!v.length) return null;
        const f = first('pct_guru'), l = last('pct_guru'), a = avgV('pct_guru');
        const mn = minV('pct_guru'), mx = maxV('pct_guru'), delta = l - f;
        if (v.length === 1) {
            return f >= 90 ? `Guru di kelas ${f}% — pengisian absensi terlaksana dengan baik.`
                 : f >= 70 ? `Guru di kelas ${f}% — perlu ditingkatkan.`
                 :           `Guru di kelas ${f}% — kepatuhan pengisian absensi rendah, perlu pembinaan.`;
        }
        if (mx - mn > 20) return `Pengisian absensi guru tidak merata, antara ${mn}% dan ${mx}% — ada hari-hari dengan kepatuhan rendah yang perlu ditelusuri.`;
        if (Math.abs(delta) >= STABIL) {
            return delta > 0
                ? `Guru di kelas naik dari ${f}% menjadi ${l}% — kepatuhan pengisian absensi membaik.`
                : `Guru di kelas turun dari ${f}% menjadi ${l}% — perlu dorongan pengisian absensi.`;
        }
        return a >= 90 ? `Guru di kelas konsisten di atas 90% — pengisian absensi terlaksana dengan baik.`
             : a >= 70 ? `Guru di kelas rata-rata ${a}% — masih ada ruang peningkatan kepatuhan.`
             :           `Guru di kelas rata-rata ${a}% — kepatuhan pengisian absensi perlu ditingkatkan.`;
    }

    function insightLateExit() {
        const totLate = total('count_late'), totExits = total('count_exits');
        const hari = data.length;
        const periodeKata = period === 'hari_ini' ? 'Hari ini' : 'Sepanjang periode';
        if (totLate === 0 && totExits === 0)
            return `${periodeKata} tidak ada keterlambatan maupun izin keluar.`;
        const lateStr  = totLate  === 0 ? null
            : hari > 1 ? `${totLate} keterlambatan (rata-rata ${(totLate/hari).toFixed(1)}/hari)`
            :            `${totLate} keterlambatan`;
        const exitStr  = totExits === 0 ? null
            : hari > 1 ? `${totExits} izin keluar (rata-rata ${(totExits/hari).toFixed(1)}/hari)`
            :            `${totExits} izin keluar`;
        const angka = [lateStr, exitStr].filter(Boolean).join(' dan ');
        const sinyal = totLate >= 10 || totExits >= 10 ? ' — perlu evaluasi kebijakan disiplin.' : '.';
        return `${periodeKata} tercatat ${angka}${sinyal}`;
    }

    const parts = [
        insightHadir(),
        insightAlpa(),
        insightSakitIzin(),
        insightGuru(),
        insightLateExit(),
    ].filter(Boolean);

    return `<strong>${title}</strong><br>${parts.join(' ')}`;
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
