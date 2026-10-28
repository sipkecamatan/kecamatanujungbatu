/**
 * @file guru/js/tab-kepsek.js
 * Tab Kepsek — monitoring kehadiran, ringkasan pembinaan, manajemen admin,
 * dan pengaturan berbagi data ke wilayah.
 */
import {
    listSchoolAdmins, addSchoolAdmin, removeSchoolAdmin,
    getKepsekMonitoring, getKepsekCaseSummary, getSchoolSummary,
    getRegionSharingStatus, setRegionSharingLevel,
} from './api.js';
import { pasangNilaiPimpinan } from './nilai-pimpinan-ui.js';
import { pasangNilaiRaporKelas } from './nilai-rapor-kelas-ui.js';
import { pasangKunciPeriode } from './kunci-periode-ui.js';
import { esc, fe, wireSimpleAccordion, localDateStr } from './tab-shared.js';

/* global Chart */

const BULAN_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

let _ksTabInit       = false;
let _ksChart         = null;
let _ksMonitoringSeq = 0;
let _ksAdminTabInit  = false;
let _ksCurrentUser   = null; // untuk window.confirmRemoveAdmin

window.confirmRemoveAdmin = async function(btn) {
    const uid  = btn.dataset.uid;
    const name = btn.dataset.name;
    if (!confirm(`Hapus akun admin "${name}"?\n\nMereka tidak akan bisa login lagi.`)) return;
    btn.disabled = true;
    try {
        await removeSchoolAdmin(uid);
        await loadAdminList({ currentUser: _ksCurrentUser });
    } catch (err) {
        alert(`Gagal menghapus: ${fe(err)}`);
        btn.disabled = false;
    }
};

export async function initKepsekTab({ currentUser, config }) {
    _ksCurrentUser = currentUser;
    pasangNilaiPimpinan(document.getElementById('tab-kepsek'), {
        esc, tahun: config?.current_academic_year, semester: config?.current_semester,
    });
    pasangNilaiRaporKelas(document.getElementById('tab-kepsek'), {
        esc, mode: 'pimpinan', tahun: config?.current_academic_year, semester: config?.current_semester,
    });
    pasangKunciPeriode(document.getElementById('tab-kepsek'), {
        esc, tahun: config?.current_academic_year, semester: config?.current_semester,
    });

    if (!_ksTabInit) {
        _ksTabInit = true;
        wireSimpleAccordion('ks-chart-card');
        wireSimpleAccordion('ks-monitoring-card');
        wireSimpleAccordion('ks-admin-card');
        wireSimpleAccordion('ks-region-card');

        document.getElementById('ks-period-toggle').addEventListener('click', e => {
            const btn = e.target.closest('.ks-period-btn');
            if (!btn || btn.disabled) return;
            document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            const ayLalu = period === 'tahun_ajaran_lalu' ? _prevAcademicYear(config) : null;
            loadKepsekMonitoring(period, { config, ayLalu });
        });

        document.getElementById('ks-range-btn').addEventListener('click', () => {
            const start = document.getElementById('ks-range-start').value;
            const end   = document.getElementById('ks-range-end').value;
            if (!start || !end) return;
            if (start > end) {
                const errEl = document.getElementById('ks-monitoring-error');
                errEl.textContent = 'Tanggal awal tidak boleh setelah tanggal akhir.';
                errEl.style.display = 'block';
                return;
            }
            document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
            loadKepsekMonitoring('rentang', { config, dateStart: start, dateEnd: end });
        });

        document.getElementById('ks-range-start').value = localDateStr(new Date(Date.now() - 6 * 86400000));
        document.getElementById('ks-range-end').value   = localDateStr();
    }

    await Promise.all([
        loadSchoolSummary(),
        loadKepsekMonitoring('7_hari', { config }),
        loadKepsekKasusRingkasan(),
    ]);
    await initKsAdminTab({ currentUser });
    await initKsRegionSharing();
}

function _prevAcademicYear(config) {
    const y = parseInt(config?.current_academic_year?.split('/')[0] ?? new Date().getFullYear());
    return `${y - 1}/${y}`;
}

function _fmtChartLabel(dateStr, byMonth) {
    const d = new Date(dateStr + 'T00:00:00');
    return byMonth
        ? BULAN_ID[d.getMonth()] + ' ' + d.getFullYear()
        : d.getDate() + ' ' + BULAN_ID[d.getMonth()];
}

async function loadKepsekMonitoring(period, { config, ayLalu = null, dateStart = null, dateEnd = null } = {}) {
    const seq    = ++_ksMonitoringSeq;
    const errEl  = document.getElementById('ks-monitoring-error');
    const hintEl = document.getElementById('ks-chart-hint');

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    ['ks-pct-hadir','ks-pct-sakit','ks-pct-izin-siswa','ks-pct-alpa','ks-pct-late','ks-pct-exits','ks-pct-guru'].forEach(id => setText(id, '…'));
    ['ks-sub-hadir','ks-sub-sakit','ks-sub-izin-siswa','ks-sub-alpa','ks-sub-late','ks-sub-exits','ks-sub-guru'].forEach(id => setText(id, ''));
    hintEl.textContent = '';
    errEl.style.display = 'none';
    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    try {
        const d = await getKepsekMonitoring(period, ayLalu, dateStart, dateEnd);
        if (seq !== _ksMonitoringSeq) return;
        const s = d.summary ?? {};

        const r     = s.rincian_absensi ?? {};
        const baris = Number(r.baris ?? 0);
        const total = Number(s.siswa_total ?? 0);

        const pctR = (k) => baris > 0 ? Math.round(100 * Number(r[k] ?? 0) / baris) + '%' : '—';
        const subR = (k) => baris > 0 ? `${r[k] ?? 0} dari ${baris}` : '';
        const pctE = (n) => total > 0 && n != null ? Math.round(100 * Number(n) / total) + '%' : '—';
        const subE = (n) => n != null ? `${n} kejadian` : '';

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
        setText('ks-pct-guru',       (s.pct_guru != null && !isNaN(s.pct_guru)) ? s.pct_guru + '%' : '—');
        setText('ks-sub-guru',       `${s.guru_hadir ?? 0} / ${s.guru_total ?? 0} guru`);

        const chartData = d.chart ?? [];
        hintEl.innerHTML = _buildChartCaption(period, d);
        _renderKepsekChart(chartData, d.by_month);

        const btnTahunLalu = document.querySelector('.ks-period-btn[data-period="tahun_ajaran_lalu"]');
        if (btnTahunLalu) {
            const earliest  = d.data_earliest;
            const prevAyEnd = _prevAcademicYear(config).split('/')[1] + '-06-30';
            const noData = !earliest || earliest > prevAyEnd;
            btnTahunLalu.disabled     = noData;
            btnTahunLalu.style.opacity = noData ? '0.4' : '';
            if (noData && btnTahunLalu.classList.contains('active')) {
                btnTahunLalu.classList.remove('active');
                const btn7 = document.querySelector('.ks-period-btn[data-period="7_hari"]');
                if (btn7) btn7.classList.add('active');
                loadKepsekMonitoring('7_hari', { config });
            }
        }
    } catch (err) {
        if (seq !== _ksMonitoringSeq) return;
        errEl.textContent   = `Gagal memuat data: ${fe(err)}`;
        errEl.style.display = 'block';
        ['ks-pct-hadir','ks-pct-sakit','ks-pct-izin-siswa','ks-pct-alpa','ks-pct-late','ks-pct-exits','ks-pct-guru'].forEach(id => setText(id, '—'));
        hintEl.textContent = '';
        if (_ksChart) { _ksChart.destroy(); _ksChart = null; }
        console.error('[kepsek monitoring]', err);
    }
}

function _renderKepsekChart(chartData, byMonth) {
    const canvas = document.getElementById('ks-chart');
    const maxY2  = Math.max(10, ...chartData.map(p => p.count_late ?? 0), ...chartData.map(p => p.count_exits ?? 0));
    const pr     = chartData.length <= 14 ? 4 : 2;
    const labels = chartData.map(p => _fmtChartLabel(p.date, byMonth));

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
                ds('Hadir (%)',        'pct_hadir', '#1D9E75', 'y1', { fill: true }),
                ds('Sakit (%)',        'pct_sakit', '#f59e0b', 'y1'),
                ds('Izin (%)',         'pct_izin',  '#8b5cf6', 'y1'),
                ds('Alpa (%)',         'pct_alpa',  '#ef4444', 'y1'),
                ds('Guru di Kelas (%)', 'pct_guru', '#185FA5', 'y1'),
                ds('Terlambat',    'count_late',    '#f97316', 'y2'),
                ds('Izin Keluar',  'count_exits',   '#ec4899', 'y2'),
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => {
                    const v = ctx.parsed.y;
                    return ctx.dataset.yAxisID === 'y2'
                        ? `${ctx.dataset.label}: ${v != null ? v + ' siswa' : '—'}`
                        : `${ctx.dataset.label}: ${v != null ? v + '%' : '—'}`;
                }}},
            },
            scales: {
                y1: { type: 'linear', display: true, position: 'left',  min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: '#0001' } },
                y2: { type: 'linear', display: true, position: 'right', min: 0, max: maxY2, title: { display: true, text: 'Jumlah Siswa', font: { size: 10 } }, ticks: { font: { size: 11 }, precision: 0 }, grid: { drawOnChartArea: false } },
                x:  { ticks: { font: { size: 11 }, maxRotation: 45 } },
            },
        },
    });
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

function fmtNum(n) { return (n ?? 0).toLocaleString('id-ID'); }

async function loadSchoolSummary() {
    try {
        const s = await getSchoolSummary();
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('ks-sum-siswa',      fmtNum(s.total_siswa));
        set('ks-sum-pkl',        fmtNum(s.total_pkl));
        set('ks-sum-staf',       fmtNum(s.total_staf));
        set('ks-sum-program',    fmtNum(s.total_program));
        set('ks-sum-kelas',      fmtNum(s.total_kelas));
        set('ks-sum-sesi',       fmtNum(s.pertemuan_hari_ini));
        set('ks-sum-hadir-hari', fmtNum(s.guru_mengajar_hari_ini));
    } catch (err) {
        console.error('[kepsek summary]', err);
    }
}

async function loadKepsekKasusRingkasan() {
    const el = document.getElementById('ks-pembinaan-ringkasan');
    if (!el) return;
    const BARIS = [['OPEN','Buka'],['UNDER_REVIEW','Ditinjau'],['INTERVENTION','Intervensi'],['MONITORING','Monitoring'],['CLOSED','Tutup']];
    try {
        const d = await getKepsekCaseSummary();
        const aktif = BARIS.slice(0, 4).reduce((j, [k]) => j + (Number(d?.per_status?.[k]) || 0), 0);
        const sel = (label, nilai) =>
            `<div style="padding:8px 12px;border:1px solid var(--color-border);border-radius:var(--radius);min-width:120px">
                <div style="font-size:12px;color:var(--color-text-muted)">${esc(label)}</div>
                <div style="font-size:20px;font-weight:600">${esc(String(nilai ?? '—'))}</div>
            </div>`;
        const hari = d?.rata_hari_penyelesaian;
        el.innerHTML = `
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                ${sel('Total kasus', d?.total ?? 0)}${sel('Masih aktif', aktif)}${sel('Tutup', d?.per_status?.CLOSED ?? 0)}
                ${sel('Dibuka 30 hari terakhir', d?.dibuka_30_hari ?? 0)}${sel('Ditutup 30 hari terakhir', d?.ditutup_30_hari ?? 0)}
                ${sel('Rata-rata lama penyelesaian', hari == null ? '—' : hari + ' hari')}
            </div>
            <table class="rc-table" style="width:100%;max-width:420px"><thead><tr><th>Status</th><th>Jumlah</th></tr></thead><tbody>
                ${BARIS.map(([k, l]) => `<tr><td>${esc(l)}</td><td>${esc(String(d?.per_status?.[k] ?? 0))}</td></tr>`).join('')}
            </tbody></table>
            <p class="hint" style="margin:10px 0 0;font-size:12px">Jalur: Sekolah ${esc(String(d?.per_track?.SEKOLAH ?? 0))} · PKL ${esc(String(d?.per_track?.PKL ?? 0))}</p>`;
    } catch (err) {
        el.innerHTML = `<p class="status-err">Gagal memuat ringkasan pembinaan. ${esc(fe(err, 's'))}</p>`;
    }
}

async function initKsAdminTab({ currentUser }) {
    if (!_ksAdminTabInit) {
        _ksAdminTabInit = true;
        document.getElementById('ks-add-admin-form').addEventListener('submit', e => handleAddAdmin(e, { currentUser }));
    }
    await loadAdminList({ currentUser });
}

async function loadAdminList({ currentUser }) {
    const el = document.getElementById('ks-admin-list');
    try {
        const admins = await listSchoolAdmins();
        if (!admins.length) { el.innerHTML = '<p class="hint">Belum ada data admin.</p>'; return; }
        el.innerHTML = `
            <table class="data-table" style="width:100%">
                <thead><tr><th style="text-align:left">Nama</th><th style="text-align:left">Login Admin</th><th></th></tr></thead>
                <tbody>
                    ${admins.map(a => `
                        <tr>
                            <td>${esc(a.full_name)}</td>
                            <td><code style="font-size:12px">${esc(a.login_identifier || '—')}</code></td>
                            <td style="text-align:right">
                                ${a.user_id === currentUser.user_id
                                    ? '<span class="hint">(Anda)</span>'
                                    : `<button class="btn btn-sm btn-danger" data-uid="${esc(a.user_id)}" data-name="${esc(a.full_name)}" onclick="confirmRemoveAdmin(this)">Hapus</button>`
                                }
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (err) {
        el.innerHTML = `<p class="hint">Gagal memuat daftar admin: ${fe(err)}</p>`;
    }
}

async function handleAddAdmin(e, { currentUser }) {
    e.preventDefault();
    const btn      = document.getElementById('ks-add-admin-btn');
    const msgEl    = document.getElementById('ks-add-admin-msg');
    const resultEl = document.getElementById('ks-new-admin-result');
    const name     = document.getElementById('ks-admin-name').value.trim();
    const loginId  = document.getElementById('ks-admin-loginid').value.trim();
    const idType   = document.getElementById('ks-admin-idtype').value;

    if (loginId.length < 9) {
        msgEl.textContent = 'NIP/NIK minimal 9 karakter.'; msgEl.style.display = 'block'; return;
    }
    btn.disabled = true; msgEl.style.display = 'none'; resultEl.style.display = 'none';
    try {
        const result = await addSchoolAdmin({ full_name: name, login_identifier: loginId, identifier_type: idType });
        document.getElementById('ks-result-loginid').textContent  = result.login_identifier;
        document.getElementById('ks-result-password').textContent = result.temp_password;
        resultEl.style.display = 'block';
        e.target.reset();
        e.target.closest('details').open = false;
        await loadAdminList({ currentUser });
    } catch (err) {
        msgEl.textContent = fe(err); msgEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

async function initKsRegionSharing() {
    const statusEl = document.getElementById('ks-region-status');
    const listEl   = document.getElementById('ks-region-levels');
    const msgEl    = document.getElementById('ks-region-msg');
    if (!statusEl || !listEl) return;
    msgEl.style.display = 'none';

    const TINGKAT = [
        { level: 'KECAMATAN', label: 'Kecamatan', nama: 'wilayah',   ada: 'terdaftar_di_wilayah', aktif: 'dibagikan',           bisa: 'dapat_mengubah' },
        { level: 'KABUPATEN', label: 'Kabupaten', nama: 'kabupaten', ada: 'terdaftar_kabupaten',  aktif: 'dibagikan_kabupaten', bisa: 'dapat_mengubah_kabupaten' },
        { level: 'PROVINSI',  label: 'Provinsi',  nama: 'provinsi',  ada: 'terdaftar_provinsi',   aktif: 'dibagikan_provinsi',  bisa: 'dapat_mengubah_provinsi' },
    ];

    const show = (st) => {
        listEl.replaceChildren();
        const adaTingkat = TINGKAT.some(t => st[t.ada]);
        statusEl.textContent = adaTingkat
            ? 'Pilih sendiri tingkat mana yang boleh melihat angka ringkas sekolah ini.'
            : 'Sekolah Anda belum didaftarkan ke wilayah mana pun oleh pengelola platform.';
        for (const t of TINGKAT) {
            const row  = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
            const info = document.createElement('span');
            const nama = st[t.nama] ? ': ' + st[t.nama] : '';
            info.textContent = t.label + nama + ' — ' +
                (!st[t.ada] ? 'belum dicatat oleh pengelola platform'
                    : st[t.aktif] ? 'DIBAGIKAN' : 'tidak dibagikan');
            row.append(info);
            if (st[t.ada] && st[t.bisa]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = st[t.aktif] ? 'btn' : 'btn btn-primary';
                btn.textContent = st[t.aktif] ? 'Hentikan berbagi' : 'Bagikan ke ' + t.label.toLowerCase();
                btn.addEventListener('click', async () => {
                    const aktifkan = !st[t.aktif];
                    const tanya = aktifkan
                        ? `Bagikan ringkasan agregat sekolah ke ${t.label.toLowerCase()}?\n\nYang terlihat hanya angka ringkas: jumlah siswa aktif, jumlah orang tua aktif, kehadiran, cakupan input, serta jumlah keterlambatan dan izin keluar. Tidak ada nama atau data pribadi siswa maupun orang tua. Anda dapat menghentikannya kapan saja.`
                        : `Hentikan berbagi ke ${t.label.toLowerCase()}? Sekolah ini akan langsung hilang dari dashboard tingkat itu.`;
                    if (!window.confirm(tanya)) return;
                    btn.disabled = true; msgEl.style.display = 'none';
                    try {
                        show(await setRegionSharingLevel(t.level, aktifkan));
                        msgEl.textContent = aktifkan ? 'Berbagi ke ' + t.label.toLowerCase() + ' diaktifkan.'
                                                     : 'Berbagi ke ' + t.label.toLowerCase() + ' dihentikan.';
                        msgEl.className = 'status-msg status-ok';
                    } catch (err) {
                        msgEl.textContent = 'Gagal menyimpan: ' + fe(err, 's');
                        msgEl.className = 'status-msg status-err';
                        btn.disabled = false;
                    } finally {
                        msgEl.style.display = 'inline-block';
                    }
                });
                row.append(btn);
            }
            listEl.append(row);
        }
    };

    try {
        show(await getRegionSharingStatus());
    } catch {
        statusEl.textContent = 'Gagal memuat status berbagi data.';
        listEl.replaceChildren();
    }
}
