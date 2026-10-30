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
