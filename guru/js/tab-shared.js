/**
 * @file guru/js/tab-shared.js
 * Utilitas bersama yang dipakai oleh file tab-*.js.
 * Fungsi-fungsi ini diekstrak dari dashboard.js.
 */
import { getLoginUrl } from '../../shared/branding.js';

export function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '';
    return el.innerHTML;
}

const SIP_EXIT_MS = 150;

export function sipCloseOverlay(el) {
    if (!el) return;
    clearTimeout(el._exitT);
    el.classList.add('sip-exit');
    el._exitT = setTimeout(() => {
        el.classList.remove('sip-exit');
        el.style.display = 'none';
    }, SIP_EXIT_MS);
}

export function sipPrepareOpen(el) {
    if (!el) return;
    clearTimeout(el._exitT);
    el.classList.remove('sip-exit');
}

export function showInputModal(message, { placeholder = '', defaultValue = '', okClass = 'btn-primary' } = {}) {
    return new Promise(resolve => {
        const modal  = document.getElementById('input-confirm-modal');
        const msgEl  = document.getElementById('icm-message');
        const input  = document.getElementById('icm-input');
        const btnOk  = document.getElementById('icm-ok');
        const btnCan = document.getElementById('icm-cancel');
        msgEl.textContent = message;
        input.value = defaultValue;
        input.placeholder = placeholder;
        btnOk.className = 'btn ' + okClass;
        sipPrepareOpen(modal);
        modal.style.display = 'flex';
        input.focus();
        const done = (val) => {
            sipCloseOverlay(modal);
            input.removeEventListener('keydown', onKey);
            btnOk.removeEventListener('click', onOk);
            btnCan.removeEventListener('click', onCan);
            resolve(val);
        };
        const onOk  = () => done(input.value);
        const onCan = () => done(null);
        const onKey = (e) => { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCan(); };
        btnOk.addEventListener('click', onOk);
        btnCan.addEventListener('click', onCan);
        input.addEventListener('keydown', onKey);
    });
}

export function fe(err, ctx = 'muat') {
    console.error('[guru]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) {
        if (!fe._redirecting) {
            fe._redirecting = true;
            setTimeout(() => { fe._redirecting = false; }, 10000);
            setTimeout(() => window.location.replace(getLoginUrl()), 1500);
        }
        return 'Sesi habis. Mengalihkan ke halaman login…';
    }
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi. Periksa jaringan.';
    if (m.includes('security policy') || m.includes('permission') || m.includes('forbidden')) return 'Tidak memiliki izin.';
    if (err?.code) {
        const code = String(err.code);
        if (code === 'PGRST116') return 'Data tidak ditemukan.';
        if (code.startsWith('23')) return ctx === 's' ? 'Data duplikat atau tidak valid.' : 'Terjadi kesalahan data.';
    }
    return ctx === 's' ? 'Gagal menyimpan. Silakan coba lagi.'
         : ctx === 'h' ? 'Gagal menghapus. Silakan coba lagi.'
         : 'Gagal memuat data. Silakan coba lagi.';
}

export function fmtTime(t) { return t ? t.slice(0, 5) : '—'; }

export function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function localDateStr(d = new Date()) {
    return d.toLocaleDateString('sv-SE');
}

export function buildAttStatCards(rows, getTot = r => r.HADIR + r.IZIN + r.SAKIT + r.ALPA) {
    const tot  = rows.reduce((s, r) => s + getTot(r), 0);
    const h    = rows.reduce((s, r) => s + r.HADIR, 0);
    const i    = rows.reduce((s, r) => s + r.IZIN, 0);
    const sk   = rows.reduce((s, r) => s + r.SAKIT, 0);
    const a    = rows.reduce((s, r) => s + r.ALPA, 0);
    const pctH = tot > 0 ? Math.round(h  / tot * 100) : 0;
    const pctI = tot > 0 ? Math.round(i  / tot * 100) : 0;
    const pctS = tot > 0 ? Math.round(sk / tot * 100) : 0;
    const pctA = tot > 0 ? Math.round(a  / tot * 100) : 0;
    const muted = 'var(--color-text-muted)';
    const colH = tot === 0 ? muted : pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
    const colI = tot === 0 ? muted : 'var(--color-warning,#f59e0b)';
    const colS = tot === 0 ? muted : 'var(--color-primary)';
    const colA = tot === 0 ? muted : 'var(--color-danger)';
    const lbl  = 'font-size:11px;color:var(--color-text-muted);margin-top:2px';
    return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colH}">${pctH}%</div>
            <div style="${lbl}">Hadir</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colS}">${pctS}%</div>
            <div style="${lbl}">Sakit</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colI}">${pctI}%</div>
            <div style="${lbl}">Izin</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colA}">${pctA}%</div>
            <div style="${lbl}">Alpa</div>
        </div>
    </div>`;
}

/**
 * Dari daftar baris { block_group_id, session_date }, hasilkan:
 *   - sortedIds : block_group_id[] urut kronologis
 *   - labelById : Map<block_group_id, string>
 *       "YYYY-MM-DD"       jika satu pertemuan per hari
 *       "YYYY-MM-DD (n)"   jika lebih dari satu pertemuan per hari
 */
export function buildPertemuanMeta(rows) {
    // Kumpulkan block_group_id unik + tanggal pertamanya
    const bgDate = new Map();
    for (const r of rows) {
        if (r.block_group_id && !bgDate.has(r.block_group_id))
            bgDate.set(r.block_group_id, r.session_date);
    }
    // Urut berdasarkan session_date lalu insertion order
    const sorted = [...bgDate.entries()]
        .sort(([, a], [, b]) => a < b ? -1 : a > b ? 1 : 0);

    // Hitung berapa pertemuan per tanggal
    const countPerDate = new Map();
    for (const [, date] of sorted)
        countPerDate.set(date, (countPerDate.get(date) ?? 0) + 1);

    const indexPerDate = new Map();
    const labelById   = new Map();
    for (const [bgId, date] of sorted) {
        if (countPerDate.get(date) === 1) {
            labelById.set(bgId, date);
        } else {
            const n = (indexPerDate.get(date) ?? 0) + 1;
            indexPerDate.set(date, n);
            labelById.set(bgId, `${date} (${n})`);
        }
    }
    return { sortedIds: sorted.map(([id]) => id), labelById };
}

// ── Siswa Perlu Perhatian — helper bersama ───────────────────

export const PERHATIAN_ALPA_MIN  = 2;
export const PERHATIAN_HADIR_MIN = 0.75;

/** Hitung siswa perlu perhatian dari baris summary API. */
export function filterPerhatian(rows) {
    return rows
        .map(s => {
            const H = Number(s.hadir ?? s.HADIR ?? 0);
            const S = Number(s.sakit ?? s.SAKIT ?? 0);
            const I = Number(s.izin  ?? s.IZIN  ?? 0);
            const A = Number(s.alpa  ?? s.ALPA  ?? 0);
            const tot = H + S + I + A;
            const pct = tot > 0 ? H / tot : null;
            return { ...s, H, S, I, A, tot, pct };
        })
        .filter(r => r.A >= PERHATIAN_ALPA_MIN || (r.pct !== null && r.pct < PERHATIAN_HADIR_MIN))
        .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'id'));
}

/** Render satu baris siswa (dipakai di flat list dan di dalam accordion). */
function _rowHtml(r, idx) {
    const cat = [];
    if (r.pct !== null && r.pct < PERHATIAN_HADIR_MIN) cat.push(`hadir ${Math.round(r.pct * 100)}% < 75%`);
    if (r.A >= PERHATIAN_ALPA_MIN) cat.push(`alpa ${r.A}x`);
    const pctColor = r.pct !== null && r.pct < PERHATIAN_HADIR_MIN ? 'var(--color-danger)' : 'var(--color-success)';
    return `<div style="padding:6px 4px;border-bottom:1px solid var(--color-border)">
        <div style="display:flex;align-items:baseline;gap:6px">
            <span style="min-width:20px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
            <span style="flex:1;font-size:13px;font-weight:500">${esc(r.full_name ?? '')}</span>
            <span style="font-size:13px;font-weight:700;color:${pctColor};flex-shrink:0">${r.pct !== null ? Math.round(r.pct * 100) + '%' : '—'}</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;padding-left:26px;margin-top:2px;font-size:11px">
            <span style="color:var(--color-success)">${r.H}H</span>
            <span style="color:var(--color-primary)">${r.S}S</span>
            <span style="color:var(--color-warning)">${r.I}I</span>
            <span style="color:var(--color-danger)">${r.A}A</span>
            <span style="color:var(--color-text-muted)">${esc(cat.join(' · '))}</span>
        </div>
    </div>`;
}

/** Header section Siswa Perlu Perhatian dengan tombol refresh. */
export function perhatianSectionHeader(refreshId) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <h3 style="margin:0">Siswa Perlu Perhatian</h3>
        <button class="btn btn-secondary btn-sm" id="${refreshId}" title="Muat ulang">↻</button>
    </div>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 12px">
        Alpa ≥ 2 kali atau % hadir &lt; 75% · Semester berjalan
    </p>`;
}

/**
 * Render daftar flat (1 kelas — Wali Kelas).
 * @param {HTMLElement} el kontainer
 * @param {Array} siswaPerhatian hasil filterPerhatian()
 */
export function renderPerhatianFlat(el, siswaPerhatian) {
    if (!siswaPerhatian.length) {
        el.innerHTML = '<p class="hint" style="color:var(--color-success)">Tidak ada siswa yang memerlukan perhatian khusus saat ini.</p>';
        return;
    }
    el.innerHTML = siswaPerhatian.map(_rowHtml).join('');
}

/**
 * Render accordion per kelas (Kaprodi, Waka, BK).
 * @param {HTMLElement} el kontainer
 * @param {Array<{class_id, name, perhatian, roster}>} classDataList
 * @param {Function|null} onExpand async fn(class_id) → Array siswa — jika null, data sudah ada di perhatian[]
 */
export function renderPerhatianAccordion(el, classDataList, onExpand = null) {
    const withData = classDataList.filter(c => onExpand ? true : c.perhatian.length);
    if (!withData.length) {
        el.innerHTML = '<p class="hint" style="color:var(--color-success)">Tidak ada siswa yang memerlukan perhatian khusus saat ini.</p>';
        return;
    }
    el.innerHTML = withData.map(cls => {
        const panelId = `pph-panel-${cls.class_id}`;
        const btnId   = `pph-btn-${cls.class_id}`;
        const countLabel = onExpand
            ? (cls.perhatian?.length != null ? `${cls.perhatian.length} siswa` : 'Klik untuk cek')
            : `${cls.perhatian.length} siswa perlu perhatian`;
        const totalLabel = cls.total != null ? ` · ${cls.total} siswa` : (cls.roster?.length != null ? ` · ${cls.roster.length} siswa` : '');
        const pctKelas = cls.roster?.length
            ? cls.roster.reduce((a, r) => a + r.H, 0) / Math.max(cls.roster.reduce((a, r) => a + r.tot, 0), 1)
            : null;
        const pctLabel = pctKelas != null ? ` · ${Math.round(pctKelas * 100)}% hadir` : '';
        return `<div style="border:1px solid var(--color-border);border-radius:8px;margin-bottom:8px;overflow:hidden">
            <button id="${btnId}" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--color-surface);border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--color-text);text-align:left">
                <span>${esc(cls.name)}</span>
                <span style="display:flex;gap:10px;align-items:center;font-size:12px;font-weight:400;flex-shrink:0">
                    <span style="color:var(--color-danger)">${countLabel}</span>
                    <span style="color:var(--color-text-muted)">${(totalLabel + pctLabel).replace(/^ · /, '')}</span>
                    <span class="pph-caret" style="color:var(--color-text-muted)">▶</span>
                </span>
            </button>
            <div id="${panelId}" style="display:none;padding:0 4px 4px;background:var(--color-surface)">
                <p class="hint">Memuat…</p>
            </div>
        </div>`;
    }).join('');

    // Wire expand
    withData.forEach(cls => {
        const panelId = `pph-panel-${cls.class_id}`;
        const btnId   = `pph-btn-${cls.class_id}`;
        const btn   = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        if (!btn || !panel) return;
        let loaded = !onExpand;
        btn.addEventListener('click', async () => {
            const open = panel.style.display !== 'none';
            panel.style.display = open ? 'none' : 'block';
            btn.querySelector('.pph-caret').textContent = open ? '▶' : '▼';
            if (!open && !loaded) {
                loaded = true;
                try {
                    const rows = await onExpand(cls.class_id);
                    const perhatian = filterPerhatian(rows);
                    if (!perhatian.length) {
                        panel.innerHTML = '<p class="hint" style="padding:8px;color:var(--color-success)">Tidak ada siswa perlu perhatian di kelas ini.</p>';
                    } else {
                        panel.innerHTML = perhatian.map(_rowHtml).join('');
                        const countEl = btn.querySelector('span[style*="color-danger"]');
                        if (countEl) countEl.textContent = `${perhatian.length} siswa perlu perhatian`;
                    }
                } catch {
                    panel.innerHTML = '<p class="hint" style="color:var(--color-danger)">Gagal memuat.</p>';
                }
            } else if (!open && loaded && !onExpand) {
                panel.innerHTML = (cls.perhatian || []).map(_rowHtml).join('');
            }
        });
    });
}

/**
 * Buat section-card "Siswa Perlu Perhatian" bisa dilipat.
 * Header (toggle) diklik → body tampil/sembunyi; default tertutup.
 * Klik tombol refresh di dalam header tidak memicu toggle.
 */
export function wirePerhatianCollapse(cardId) {
    const card = document.getElementById(cardId);
    if (!card || card.dataset.pphCollWired) return;
    card.dataset.pphCollWired = '1';
    const base   = cardId.replace(/-card$/, '');
    const toggle = document.getElementById(base + '-toggle');
    const body   = document.getElementById(base + '-body');
    const caret  = toggle?.querySelector('.pph-sect-caret');
    if (!toggle || !body) return;
    toggle.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        if (caret) caret.textContent = open ? '▶' : '▼';
    });
}

export function wireSimpleAccordion(cardId) {
    const card = document.getElementById(cardId);
    if (!card || card.dataset.accWired) return;
    const header = card.querySelector('.kp-acc-header');
    const body   = card.querySelector('.kp-acc-body');
    if (!header || !body) return;
    card.dataset.accWired = '1';
    header.addEventListener('click', () => {
        const open = card.classList.contains('open');
        card.classList.toggle('open', !open);
        body.style.display = open ? 'none' : 'block';
    });
}

/**
 * Unduh Excel keterlambatan (late_arrivals).
 * @param {Array}  rows      — dari getWaliLateArrivals atau getLateArrivalsByRange
 * @param {string} filename  — nama file tanpa ekstensi
 * @param {Object} opts
 * @param {boolean} [opts.withKelas=false]    — sertakan kolom Kelas
 * @param {boolean} [opts.withRecorder=false] — sertakan kolom Dicatat Oleh
 */
export function downloadLateExcel(rows, filename, { withKelas = false, withRecorder = false } = {}) {
    /* global XLSX */
    const header = ['Tanggal', 'Nama Siswa', 'NIS'];
    if (withKelas) header.push('Kelas');
    header.push('Jam Masuk', 'Alasan');
    if (withRecorder) header.push('Dicatat Oleh');

    const fmtTgl = (iso) => {
        if (!iso) return '—';
        const [y, m, d] = iso.split('-');
        const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
        return `${Number(d)} ${bln[Number(m)-1]} ${y}`;
    };

    const data = rows.map(r => {
        const row = [fmtTgl(r.date), r.student_name ?? '—', r.nis ?? '—'];
        if (withKelas) row.push(r.class_name ?? '—');
        row.push(r.arrival_time ? r.arrival_time.slice(0, 5) : '—', r.reason || '');
        if (withRecorder) row.push(r.recorder ?? '—');
        return row;
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Keterlambatan');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename + '.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Unduh Excel rekap keterlambatan wali kelas — format RINGKASAN + sheet per bulan.
 * @param {Array}  rows         — dari getWaliLateArrivals (seluruh tahun ajaran)
 * @param {Array}  students     — dari getEnrolledStudents [{student_id, full_name, nis}]
 * @param {string} className    — nama kelas, misal "X AKL 1"
 * @param {string} academicYear — misal "2026/2027"
 * @param {string} filename     — nama file tanpa ekstensi
 */
export function downloadWaliLateRekap(rows, students, className, academicYear, filename) {
    /* global XLSX */
    const BLN_LABEL = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    const BLN_NAMA  = ['Januari','Februari','Maret','April','Mei','Juni',
                       'Juli','Agustus','September','Oktober','November','Desember'];

    // Tahun ajaran: "2026/2027" → tahun mulai 2026, bulan Jul–Des 2026 + Jan–Jun 2027
    const [tahunMulai] = academicYear.split('/').map(Number);
    // 12 bulan: [7,8,9,10,11,12, 1,2,3,4,5,6]
    const BULAN_URUT = [7,8,9,10,11,12,1,2,3,4,5,6].map((m, i) => ({
        bulan: m,
        tahun: m >= 7 ? tahunMulai : tahunMulai + 1,
        label: `${BLN_LABEL[m-1]} ${String(m >= 7 ? tahunMulai : tahunMulai + 1).slice(2)}`,
        nama:  `${BLN_NAMA[m-1]} ${m >= 7 ? tahunMulai : tahunMulai + 1}`,
    }));

    // Index: student_id → nama
    const studentMap = new Map(students.map(s => [s.student_id, s]));

    // Kelompokkan rows per bulan
    const byMonth = new Map(); // key: "YYYY-MM"
    for (const r of rows) {
        const key = r.date.slice(0, 7);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(r);
    }

    // Hitung total per siswa per bulan (untuk threshold perlu perhatian ≥ 3)
    // perStudentMonth: Map<student_id, Map<"YYYY-MM", [row]>>
    const perStudentMonth = new Map();
    for (const r of rows) {
        if (!perStudentMonth.has(r.student_id)) perStudentMonth.set(r.student_id, new Map());
        const mMap = perStudentMonth.get(r.student_id);
        const key = r.date.slice(0, 7);
        if (!mMap.has(key)) mMap.set(key, []);
        mMap.get(key).push(r);
    }

    // Total per siswa (seluruh tahun)
    const perStudent = new Map(); // student_id → total
    for (const r of rows) {
        perStudent.set(r.student_id, (perStudent.get(r.student_id) ?? 0) + 1);
    }

    const S = (v, opts = {}) => ({ v, ...opts });
    const wb = XLSX.utils.book_new();

    // ── Helper styling ──────────────────────────────────────────────────────
    const HEADER_FILL = { fgColor: { rgb: '1E3A5F' } };
    const SUBHEAD_FILL = { fgColor: { rgb: '2D6A9F' } };
    const ALT_FILL    = { fgColor: { rgb: 'EBF2FA' } };
    const WARN_FILL   = { fgColor: { rgb: 'FFF3CD' } };
    const BORDER_THIN = { style: 'thin', color: { rgb: 'CCCCCC' } };
    const BORDER_ALL  = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
    const FONT_WHITE  = { color: { rgb: 'FFFFFF' }, bold: true, name: 'Arial', sz: 10 };
    const FONT_BOLD   = { bold: true, name: 'Arial', sz: 10 };
    const FONT_NORM   = { name: 'Arial', sz: 10 };
    const FONT_MUTED  = { name: 'Arial', sz: 10, color: { rgb: '888888' } };

    const cell = (v, { fill, font, align, border } = {}) => {
        const c = { v, t: typeof v === 'number' ? 'n' : 's' };
        const s = {};
        if (fill)   s.fill   = { patternType: 'solid', ...fill };
        if (font)   s.font   = font;
        if (align)  s.alignment = align;
        if (border) s.border = border;
        if (Object.keys(s).length) c.s = s;
        return c;
    };
    const hCell = (v) => cell(v, { fill: HEADER_FILL, font: FONT_WHITE, border: BORDER_ALL, align: { horizontal: 'center' } });
    const shCell = (v) => cell(v, { fill: SUBHEAD_FILL, font: FONT_WHITE, border: BORDER_ALL });
    const bCell = (v) => cell(v, { font: FONT_BOLD, border: BORDER_ALL });
    const nCell = (v) => cell(v, { font: FONT_NORM, border: BORDER_ALL });
    const mCell = (v) => cell(v, { font: FONT_MUTED, border: BORDER_ALL, align: { horizontal: 'center' } });
    const numCell = (v) => cell(v, { font: FONT_NORM, border: BORDER_ALL, align: { horizontal: 'center' } });
    const warnCell = (v) => cell(v, { fill: WARN_FILL, font: FONT_BOLD, border: BORDER_ALL, align: { horizontal: 'center' } });

    // ── Sheet RINGKASAN ──────────────────────────────────────────────────────
    const wsData = [];

    // Baris 1: judul
    wsData.push([cell(`REKAP KETERLAMBATAN — ${className}`, { font: { bold: true, name: 'Arial', sz: 14 } })]);
    wsData.push([cell(`Tahun Ajaran: ${academicYear}  |  Data seluruh periode aktif`, { font: FONT_MUTED })]);
    wsData.push([]);

    // Blok statistik
    const totalKejadian = rows.length;
    const totalSiswa    = students.length;
    // Siswa unik yang pernah terlambat
    const siswaPernahTerlambat = perStudent.size;
    wsData.push([
        bCell('JUMLAH SISWA'), numCell(totalSiswa), cell(''),
        bCell('TOTAL KEJADIAN'), numCell(totalKejadian), cell(''),
        bCell('SISWA PERNAH TERLAMBAT'), numCell(siswaPernahTerlambat),
    ]);
    wsData.push([]);

    // Tren per bulan
    wsData.push([shCell('TREN KETERLAMBATAN PER BULAN')]);
    wsData.push([
        hCell('Bulan'), hCell('Kejadian'), hCell('Siswa Terlibat'), hCell('Siswa Perlu Perhatian (≥3x)'),
    ]);
    for (const { bulan, tahun, nama } of BULAN_URUT) {
        const key = `${tahun}-${String(bulan).padStart(2,'0')}`;
        const mRows = byMonth.get(key) ?? [];
        const siswaUnik = new Set(mRows.map(r => r.student_id)).size;
        // siswa perlu perhatian: terlambat ≥ 3 kali bulan ini
        const perlu = [...new Set(mRows.map(r => r.student_id))]
            .filter(id => mRows.filter(r => r.student_id === id).length >= 3).length;
        if (!mRows.length) {
            wsData.push([nCell(nama), mCell('—'), mCell('—'), mCell('—')]);
        } else {
            wsData.push([nCell(nama), numCell(mRows.length), numCell(siswaUnik),
                perlu > 0 ? warnCell(`${perlu} siswa`) : numCell(0)]);
        }
    }
    wsData.push([]);

    // Siswa perlu perhatian: ≥ 3 kali dalam 1 bulan manapun
    const perluPerhatian = [];
    for (const [studentId, mMap] of perStudentMonth) {
        const bulanBermasalah = [];
        for (const [mKey, mRows] of mMap) {
            if (mRows.length >= 3) bulanBermasalah.push({ key: mKey, count: mRows.length });
        }
        if (bulanBermasalah.length > 0) {
            const s = studentMap.get(studentId);
            const totalS = perStudent.get(studentId) ?? 0;
            const catatan = bulanBermasalah
                .map(({ key, count }) => {
                    const [y, m] = key.split('-').map(Number);
                    return `${BLN_LABEL[m-1]} ${count}x`;
                }).join(', ');
            perluPerhatian.push({ nama: s?.full_name ?? '—', nis: s?.nis ?? '—', total: totalS, catatan });
        }
    }
    perluPerhatian.sort((a, b) => b.total - a.total);

    wsData.push([shCell('SISWA PERLU PERHATIAN — SELURUH TAHUN AJARAN')]);
    wsData.push([cell('Threshold: terlambat ≥ 3 kali dalam 1 bulan.', { font: FONT_MUTED })]);
    wsData.push([hCell('No'), hCell('Nama Siswa'), hCell('NIS'), hCell('Total Terlambat'), hCell('Catatan')]);
    if (!perluPerhatian.length) {
        wsData.push([cell(''), nCell('Tidak ada siswa yang melewati threshold.'), cell(''), cell(''), cell('')]);
    } else {
        perluPerhatian.forEach(({ nama, nis, total, catatan }, i) => {
            wsData.push([numCell(i + 1), nCell(nama), nCell(nis), numCell(total), nCell(catatan)]);
        });
    }

    const wsRingkasan = XLSX.utils.aoa_to_sheet(wsData);
    wsRingkasan['!cols'] = [
        { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 35 },
    ];
    // Merge judul dan subheader
    wsRingkasan['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 3 } }, // TREN header
    ];
    XLSX.utils.book_append_sheet(wb, wsRingkasan, 'RINGKASAN');

    // ── Sheet per bulan (selalu 12 sheet) ───────────────────────────────────
    for (const { bulan, tahun, label, nama } of BULAN_URUT) {
        const key = `${tahun}-${String(bulan).padStart(2,'0')}`;
        const mRows = byMonth.get(key) ?? [];

        const sheetData = [];
        sheetData.push([cell(`KETERLAMBATAN ${nama.toUpperCase()} — ${className}`, { font: { bold: true, name: 'Arial', sz: 12 } })]);
        sheetData.push([]);

        let colWidths = [{ wch: 5 }, { wch: 28 }, { wch: 14 }, { wch: 7 }];
        let mergeEndCol = 3;

        if (!mRows.length) {
            sheetData.push([hCell('No'), hCell('Nama Siswa'), hCell('NIS'), hCell('Total')]);
            sheetData.push([cell(''), nCell('Tidak ada keterlambatan bulan ini.'), cell(''), cell('')]);
        } else {
            const tanggalSet = [...new Set(mRows.map(r => r.date))].sort();
            mergeEndCol = 3 + tanggalSet.length - 1;
            colWidths = [...colWidths, ...tanggalSet.map(() => ({ wch: 20 }))];

            const siswaIds  = [...new Set(mRows.map(r => r.student_id))];
            const siswaList = siswaIds
                .map(id => studentMap.get(id) ?? { student_id: id, full_name: '—', nis: '—' })
                .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
            const cellIdx = new Map();
            for (const r of mRows) {
                const val = r.arrival_time
                    ? (r.reason ? `${r.arrival_time.slice(0,5)} – ${r.reason}` : r.arrival_time.slice(0,5))
                    : (r.reason || '✓');
                const k = `${r.student_id}|${r.date}`;
                cellIdx.set(k, cellIdx.has(k) ? `${cellIdx.get(k)} / ${val}` : val);
            }
            const fmtTanggal = (iso) => {
                const [, , d] = iso.split('-');
                return `${Number(d)}/${String(bulan).padStart(2,'0')}`;
            };
            sheetData.push([
                hCell('No'), hCell('Nama Siswa'), hCell('NIS'), hCell('Total'),
                ...tanggalSet.map(d => hCell(fmtTanggal(d))),
            ]);
            siswaList.forEach(({ student_id, full_name, nis }, i) => {
                const total = mRows.filter(r => r.student_id === student_id).length;
                const row = [
                    numCell(i + 1),
                    cell(full_name, { font: FONT_BOLD, border: BORDER_ALL }),
                    nCell(nis),
                    total >= 3 ? warnCell(total) : numCell(total),
                ];
                for (const d of tanggalSet) {
                    const v = cellIdx.get(`${student_id}|${d}`);
                    row.push(v ? nCell(v) : mCell(''));
                }
                sheetData.push(row);
            });
        }

        const wsSheet = XLSX.utils.aoa_to_sheet(sheetData);
        wsSheet['!cols'] = colWidths;
        wsSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: mergeEndCol } }];
        XLSX.utils.book_append_sheet(wb, wsSheet, label);
    }

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename + '.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Unduh Excel izin keluar (student_exits).
 * @param {Array}  rows      — dari getWaliExits atau getExitsByRange
 * @param {string} filename  — nama file tanpa ekstensi
 * @param {Object} opts
 * @param {boolean} [opts.withKelas=false]
 * @param {boolean} [opts.withRecorder=false]
 */
export function downloadExitExcel(rows, filename, { withKelas = false, withRecorder = false } = {}) {
    /* global XLSX */
    const header = ['Tanggal', 'Nama Siswa', 'NIS'];
    if (withKelas) header.push('Kelas');
    header.push('Jam Keluar', 'Jam Kembali', 'Alasan');
    if (withRecorder) header.push('Dicatat Oleh');

    const fmtTgl = (iso) => {
        if (!iso) return '—';
        const [y, m, d] = iso.split('-');
        const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
        return `${Number(d)} ${bln[Number(m)-1]} ${y}`;
    };
    const fmtJam = (t) => (t && t !== '—') ? t.slice(0, 5) : '—';

    const data = rows.map(r => {
        const row = [fmtTgl(r.date), r.student_name ?? '—', r.nis ?? '—'];
        if (withKelas) row.push(r.class_name ?? '—');
        row.push(fmtJam(r.exit_time), fmtJam(r.return_time), r.reason || '');
        if (withRecorder) row.push(r.recorder ?? '—');
        return row;
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Izin Keluar');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename + '.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Unduh Excel rekap izin keluar wali kelas — format RINGKASAN + sheet per bulan.
 * @param {Array}  rows         — dari getWaliExits (seluruh tahun ajaran)
 * @param {Array}  students     — dari getEnrolledStudents [{student_id, full_name, nis}]
 * @param {string} className    — nama kelas, misal "X AKL 1"
 * @param {string} academicYear — misal "2026/2027"
 * @param {string} filename     — nama file tanpa ekstensi
 */
export function downloadWaliExitRekap(rows, students, className, academicYear, filename) {
    /* global XLSX */
    const BLN_LABEL = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    const BLN_NAMA  = ['Januari','Februari','Maret','April','Mei','Juni',
                       'Juli','Agustus','September','Oktober','November','Desember'];

    const [tahunMulai] = academicYear.split('/').map(Number);
    const BULAN_URUT = [7,8,9,10,11,12,1,2,3,4,5,6].map((m) => ({
        bulan: m,
        tahun: m >= 7 ? tahunMulai : tahunMulai + 1,
        label: `${BLN_LABEL[m-1]} ${String(m >= 7 ? tahunMulai : tahunMulai + 1).slice(2)}`,
        nama:  `${BLN_NAMA[m-1]} ${m >= 7 ? tahunMulai : tahunMulai + 1}`,
    }));

    const studentMap = new Map(students.map(s => [s.student_id, s]));

    const byMonth = new Map();
    for (const r of rows) {
        const key = r.date.slice(0, 7);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(r);
    }

    const perStudentMonth = new Map();
    for (const r of rows) {
        if (!perStudentMonth.has(r.student_id)) perStudentMonth.set(r.student_id, new Map());
        const mMap = perStudentMonth.get(r.student_id);
        const key = r.date.slice(0, 7);
        if (!mMap.has(key)) mMap.set(key, []);
        mMap.get(key).push(r);
    }

    const perStudent = new Map();
    for (const r of rows) perStudent.set(r.student_id, (perStudent.get(r.student_id) ?? 0) + 1);

    const wbExit = XLSX.utils.book_new();

    const HEADER_FILL  = { fgColor: { rgb: '1E3A5F' } };
    const SUBHEAD_FILL = { fgColor: { rgb: '2D6A9F' } };
    const WARN_FILL    = { fgColor: { rgb: 'FFF3CD' } };
    const BORDER_THIN  = { style: 'thin', color: { rgb: 'CCCCCC' } };
    const BORDER_ALL   = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
    const FONT_WHITE   = { color: { rgb: 'FFFFFF' }, bold: true, name: 'Arial', sz: 10 };
    const FONT_BOLD    = { bold: true, name: 'Arial', sz: 10 };
    const FONT_NORM    = { name: 'Arial', sz: 10 };
    const FONT_MUTED   = { name: 'Arial', sz: 10, color: { rgb: '888888' } };

    const ecell = (v, { fill, font, align, border } = {}) => {
        const c = { v, t: typeof v === 'number' ? 'n' : 's' };
        const s = {};
        if (fill)   s.fill   = { patternType: 'solid', ...fill };
        if (font)   s.font   = font;
        if (align)  s.alignment = align;
        if (border) s.border = border;
        if (Object.keys(s).length) c.s = s;
        return c;
    };
    const hCell   = (v) => ecell(v, { fill: HEADER_FILL,  font: FONT_WHITE, border: BORDER_ALL, align: { horizontal: 'center' } });
    const shCell  = (v) => ecell(v, { fill: SUBHEAD_FILL, font: FONT_WHITE, border: BORDER_ALL });
    const bCell   = (v) => ecell(v, { font: FONT_BOLD, border: BORDER_ALL });
    const nCell   = (v) => ecell(v, { font: FONT_NORM, border: BORDER_ALL });
    const mCell   = (v) => ecell(v, { font: FONT_MUTED, border: BORDER_ALL, align: { horizontal: 'center' } });
    const numCell = (v) => ecell(v, { font: FONT_NORM,  border: BORDER_ALL, align: { horizontal: 'center' } });
    const warnCell= (v) => ecell(v, { fill: WARN_FILL,  font: FONT_BOLD,   border: BORDER_ALL, align: { horizontal: 'center' } });

    // ── Sheet RINGKASAN ──────────────────────────────────────────────────────
    const wsData = [];
    wsData.push([ecell(`REKAP IZIN KELUAR — ${className}`, { font: { bold: true, name: 'Arial', sz: 14 } })]);
    wsData.push([ecell(`Tahun Ajaran: ${academicYear}  |  Data seluruh periode aktif`, { font: FONT_MUTED })]);
    wsData.push([]);
    wsData.push([
        bCell('JUMLAH SISWA'), numCell(students.length), ecell(''),
        bCell('TOTAL KEJADIAN'), numCell(rows.length), ecell(''),
        bCell('SISWA PERNAH IZIN KELUAR'), numCell(perStudent.size),
    ]);
    wsData.push([]);
    wsData.push([shCell('TREN IZIN KELUAR PER BULAN')]);
    wsData.push([hCell('Bulan'), hCell('Kejadian'), hCell('Siswa Terlibat'), hCell('Siswa Perlu Perhatian (≥3x)')]);

    for (const { bulan, tahun, nama } of BULAN_URUT) {
        const key = `${tahun}-${String(bulan).padStart(2,'0')}`;
        const mRows = byMonth.get(key) ?? [];
        const siswaUnik = new Set(mRows.map(r => r.student_id)).size;
        const perlu = [...new Set(mRows.map(r => r.student_id))]
            .filter(id => mRows.filter(r => r.student_id === id).length >= 3).length;
        if (!mRows.length) {
            wsData.push([nCell(nama), mCell('—'), mCell('—'), mCell('—')]);
        } else {
            wsData.push([nCell(nama), numCell(mRows.length), numCell(siswaUnik),
                perlu > 0 ? warnCell(`${perlu} siswa`) : numCell(0)]);
        }
    }
    wsData.push([]);

    const perluPerhatian = [];
    for (const [studentId, mMap] of perStudentMonth) {
        const bulanBermasalah = [];
        for (const [mKey, mRows] of mMap) {
            if (mRows.length >= 3) bulanBermasalah.push({ key: mKey, count: mRows.length });
        }
        if (bulanBermasalah.length > 0) {
            const s = studentMap.get(studentId);
            const totalS = perStudent.get(studentId) ?? 0;
            const catatan = bulanBermasalah.map(({ key, count }) => {
                const [, m] = key.split('-').map(Number);
                return `${BLN_LABEL[m-1]} ${count}x`;
            }).join(', ');
            perluPerhatian.push({ nama: s?.full_name ?? '—', nis: s?.nis ?? '—', total: totalS, catatan });
        }
    }
    perluPerhatian.sort((a, b) => b.total - a.total);

    wsData.push([shCell('SISWA PERLU PERHATIAN — SELURUH TAHUN AJARAN')]);
    wsData.push([ecell('Threshold: izin keluar ≥ 3 kali dalam 1 bulan.', { font: FONT_MUTED })]);
    wsData.push([hCell('No'), hCell('Nama Siswa'), hCell('NIS'), hCell('Total Izin Keluar'), hCell('Catatan')]);
    if (!perluPerhatian.length) {
        wsData.push([ecell(''), nCell('Tidak ada siswa yang melewati threshold.'), ecell(''), ecell(''), ecell('')]);
    } else {
        perluPerhatian.forEach(({ nama, nis, total, catatan }, i) => {
            wsData.push([numCell(i + 1), nCell(nama), nCell(nis), numCell(total), nCell(catatan)]);
        });
    }

    const wsRingkasan = XLSX.utils.aoa_to_sheet(wsData);
    wsRingkasan['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 35 }];
    wsRingkasan['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 3 } },
    ];
    XLSX.utils.book_append_sheet(wbExit, wsRingkasan, 'RINGKASAN');

    // ── Sheet per bulan (selalu 12 sheet) ───────────────────────────────────
    for (const { bulan, tahun, label, nama } of BULAN_URUT) {
        const key = `${tahun}-${String(bulan).padStart(2,'0')}`;
        const mRows = byMonth.get(key) ?? [];

        const sheetData = [];
        sheetData.push([ecell(`IZIN KELUAR ${nama.toUpperCase()} — ${className}`, { font: { bold: true, name: 'Arial', sz: 12 } })]);
        sheetData.push([]);

        let colWidths = [{ wch: 5 }, { wch: 28 }, { wch: 14 }, { wch: 7 }];
        let mergeEndCol = 3;

        if (!mRows.length) {
            sheetData.push([hCell('No'), hCell('Nama Siswa'), hCell('NIS'), hCell('Total')]);
            sheetData.push([ecell(''), nCell('Tidak ada izin keluar bulan ini.'), ecell(''), ecell('')]);
        } else {
            const tanggalSet = [...new Set(mRows.map(r => r.date))].sort();
            mergeEndCol = 3 + tanggalSet.length - 1;
            colWidths = [...colWidths, ...tanggalSet.map(() => ({ wch: 22 }))];

            const siswaIds  = [...new Set(mRows.map(r => r.student_id))];
            const siswaList = siswaIds
                .map(id => studentMap.get(id) ?? { student_id: id, full_name: '—', nis: '—' })
                .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
            const cellIdx = new Map();
            for (const r of mRows) {
                const val = r.exit_time
                    ? (r.reason ? `${r.exit_time.slice(0,5)} – ${r.reason}` : r.exit_time.slice(0,5))
                    : (r.reason || '✓');
                const k = `${r.student_id}|${r.date}`;
                cellIdx.set(k, cellIdx.has(k) ? `${cellIdx.get(k)} / ${val}` : val);
            }
            const fmtTanggal = (iso) => {
                const [, , d] = iso.split('-');
                return `${Number(d)}/${String(bulan).padStart(2,'0')}`;
            };
            sheetData.push([
                hCell('No'), hCell('Nama Siswa'), hCell('NIS'), hCell('Total'),
                ...tanggalSet.map(d => hCell(fmtTanggal(d))),
            ]);
            siswaList.forEach(({ student_id, full_name, nis }, i) => {
                const total = mRows.filter(r => r.student_id === student_id).length;
                const row = [
                    numCell(i + 1),
                    ecell(full_name, { font: FONT_BOLD, border: BORDER_ALL }),
                    nCell(nis),
                    total >= 3 ? warnCell(total) : numCell(total),
                ];
                for (const d of tanggalSet) {
                    const v = cellIdx.get(`${student_id}|${d}`);
                    row.push(v ? nCell(v) : mCell(''));
                }
                sheetData.push(row);
            });
        }

        const wsSheet = XLSX.utils.aoa_to_sheet(sheetData);
        wsSheet['!cols'] = colWidths;
        wsSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: mergeEndCol } }];
        XLSX.utils.book_append_sheet(wbExit, wsSheet, label);
    }

    const bufExit = XLSX.write(wbExit, { type: 'array', bookType: 'xlsx' });
    const urlExit = URL.createObjectURL(new Blob([bufExit], { type: 'application/octet-stream' }));
    const aExit = document.createElement('a');
    aExit.href = urlExit; aExit.download = filename + '.xlsx'; aExit.click();
    setTimeout(() => URL.revokeObjectURL(urlExit), 10000);
}
