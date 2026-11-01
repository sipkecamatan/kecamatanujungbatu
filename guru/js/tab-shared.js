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
