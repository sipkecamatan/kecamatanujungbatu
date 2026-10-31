/**
 * @file guru/js/dashboard.js
 * Dashboard utama Portal Guru — 1 login, tab Guru + tab Jabatan.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword, initChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import { initSessionGuard } from '../../shared/session-guard.js';
import {
    supabase, logout, getCurrentUserRow, GURU_ROLES,
    listSchoolAdmins, addSchoolAdmin, removeSchoolAdmin,
    getJabatan, jabatanLabel, getSchoolConfig,
    getMyScheduleForDate, getEnrolledStudents, getMyClasses, getClassesByProgram,
    getAttendanceForSession,
    getMyStudents, searchStudents, insertObservation,
    getWaliKelasInfo, getWaliAttendanceSummary, getWaliCoachingStudents, getWaliAttendanceSessions,
    getProgram, fetchPklStudents, fetchNonPklStudents,
    fetchDudiPartners, fetchPklAttendance, fetchDudiObservations,
    getAttendanceSummaryByStudents, getClassAttendanceByDate,
    fetchAllPklStudents, fetchAllDudiPartners,
    createPlacement, finishPlacement, bulkImportPkl,

    getSchoolStats, getKepsekMonitoring, getKepsekCaseSummary,
    getPendingAttendanceSessions, getPendingSessionsByTeacher, getPendingSessionsDetail,
    getWakaKurStats,
    getAttendanceRecapPerClass, getOpenCases,
    getPrograms, getStudentAttendanceSessions,
    getMyObservations,
    voidObservation,
    getCases, getCasesAll, getCase, getCoachingCaseEvents, createCase, getCoachingCasesCount,
    addCoachingNote, escalateCoachingCase, changeCoachingCaseStatus, closeCoachingCase,
    shareCoachingCaseToStudent, unshareCoachingCaseFromStudent,
    shareCoachingCaseToParent, unshareCoachingCaseFromParent,
    getEscalationCandidates,
    listCaseViewers, getCaseTagCandidates, addCaseViewer, removeCaseViewer, logCaseOversightView, listCaseAccessLog,
    getUnreadNotifCount, getRecentNotifications, markNotificationsRead,
    registerLoginDevice,
    getForumRecipientCandidates, getForumSekolahPosts, getForumSekolahSentPosts,
    getForumSekolahPostById, getForumSekolahSentPostById,
    getForumSekolahComments, createForumSekolahPost, updateForumSekolahPost,
    deleteForumSekolahPost,
    addForumSekolahComment, deleteForumSekolahComment,
    addForumSekolahAcknowledgement, setForumAttachment,
    isOnDutyToday, getTodayLateArrivals, recordLateArrival, deleteLateArrival,
    getLateArrivalsByRange, getLateArrivalsAggregate,
    getWaliLateArrivals, getWaliExits,
    getTodayExits, recordExit, updateReturnTime, deleteExit,
    getClassProgramContext, getCpForSubject, checkElementDuplicate,
    getRegionSharingStatus, setRegionSharing, setRegionSharingLevel,
} from './api.js';
import { pasangNilaiPimpinan } from './nilai-pimpinan-ui.js';
import { pasangNilaiRaporKelas } from './nilai-rapor-kelas-ui.js';
import { pasangKunciPeriode } from './kunci-periode-ui.js';
import { saveAttendanceBatch, flushPending, pendingCount, rejectedCount, listQueuedCases, discardQueuedCase } from './offline.js';
import { initJurnalTab } from './jurnal.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';
import {
    initAckQueue, registerAckHandler, ackWithRetry,
} from '../../shared/ack-queue.js';
import { initPiketTab } from './tab-piket.js';
import { initWakaHumasTab } from './tab-waka-humas.js';
import { initWaliTab } from './tab-wali.js';
import { initBkTab } from './tab-bk.js';
import { initKaprodiTab, kaprodiAllStudents as _kaprodiAllStudents } from './tab-kaprodi.js';
import { initWakaKesiswaanTab, renderWkCount, wkKasusCtx as _wkKasusCtxRef } from './tab-waka-kesiswaan.js';
import { initKepsekTab } from './tab-kepsek.js';
import { initWakaKurTab } from './tab-waka-kurikulum.js';
import { initForumTab } from './tab-forum.js';
import {
    initGuruTab, initObsTab, setGuruContext,
    updateSyncBanner, runFlush, ensureStudentPool,
    myStudents as _myStudents, isBroadObserver as _isBroadObserver,
    setOnSyncCallback,
} from './tab-guru.js';

// ─── Notifikasi lonceng ───────────────────────────────────────
// Menggantikan badge localStorage. Sumber kebenaran = tabel notifications.

let _notifPollTimer = null;

function _setBellBadge(n) {
    const btn = document.getElementById('notif-bell-btn');
    if (!btn) return;
    let badge = btn.querySelector('.notif-badge-count');
    if (n > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notif-badge-count';
            btn.style.position = 'relative';
            btn.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
    } else {
        badge?.remove();
    }
}

async function refreshNotifBadge() {
    if (!currentUser) return;
    try {
        const n = await getUnreadNotifCount();
        _setBellBadge(n);
    } catch { /* tidak kritis */ }
}

function startNotifPolling() {
    clearInterval(_notifPollTimer);
    _notifPollTimer = setInterval(refreshNotifBadge, 60_000); // poll tiap 1 menit
}

async function openNotifDropdown() {
    const panel = document.getElementById('notif-dropdown');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    panel.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Memuat…</p>';
    try {
        const notifs = await getRecentNotifications(15);
        if (!notifs.length) {
            panel.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Tidak ada notifikasi baru.</p>';
            return;
        }
        panel.innerHTML = notifs.map(n => `
            <div class="notif-item" data-id="${n.notification_id}" data-case="${n.case_id ?? ''}"
                 style="padding:10px 14px;border-bottom:1px solid var(--color-border);cursor:pointer;font-size:13px">
                <div style="font-weight:600;margin-bottom:2px">${esc(n.title)}</div>
                <div style="color:var(--color-text-muted);font-size:12px">${esc(n.body)}</div>
                <div style="color:var(--color-text-muted);font-size:11px;margin-top:3px">${fmt(n.created_at)}</div>
            </div>`).join('') +
            `<div style="padding:8px 14px;text-align:center">
                <button id="notif-mark-all-btn" class="btn btn-secondary btn-sm" style="font-size:12px">Tandai semua dibaca</button>
            </div>`;

        panel.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
            el.addEventListener('click', async () => {
                panel.style.display = 'none';
                // NOTIF-01: tidak lagi .catch(() => {}) — kegagalan masuk antrean retry.
                await ackWithRetry('notif_read', [el.dataset.id],
                    `notif_read:${el.dataset.id}`);
                await refreshNotifBadge();
                if (el.dataset.case) openKasusDetail(el.dataset.case);
            });
        });

        document.getElementById('notif-mark-all-btn')?.addEventListener('click', async () => {
            const ids = notifs.map(n => n.notification_id);
            // NOTIF-01: badge tetap di-nol-kan optimistic; retry ditangani antrean.
            await ackWithRetry('notif_read', ids,
                `notif_read:batch:${[...ids].sort().join(',')}`);
            panel.style.display = 'none';
            _setBellBadge(0);
        });
    } catch {
        panel.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-danger)">Gagal memuat notifikasi.</p>';
    }
}

function markKasusAsSeen() {
    // Tidak lagi pakai localStorage — mark read via DB saat buka kasus
    _setBellBadge(0);
}

// ─── State ───────────────────────────────────────────────────
let currentUser  = null;
let config       = null;   // { current_academic_year, current_semester }
let jabatan      = [];
let isTeacher    = false;  // hanya GURU & WALI_KELAS yang mengajar
let _kpKasusCtx   = null;
let _ksDisahkanPage = 0;

// ─── Read cache (LF-2) ───────────────────────────────────────
// Simpan snapshot data server ke localStorage → tampilkan saat halaman
// dibuka (sebelum server merespons), termasuk saat offline.
const LC = {
    set(key, data) {
        try { localStorage.setItem(`smkhr:${key}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
    },
    get(key) {
        try { const r = JSON.parse(localStorage.getItem(`smkhr:${key}`)); return r?.data ?? null; }
        catch { return null; }
    },
    clear(prefix) {
        try { Object.keys(localStorage).filter(k => k.startsWith(`smkhr:${prefix}`)).forEach(k => localStorage.removeItem(k)); }
        catch {}
    },
    remove(key) {
        try { localStorage.removeItem(`smkhr:${key}`); } catch {}
    },
};

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '';
    return el.innerHTML;
}

// -- Animasi keluar overlay (transitions.css) ----------------
// display:none ditunda selama SIP_EXIT_MS supaya @keyframes sipModalOut
// sempat berjalan. Handle timeout disimpan DI elemen, bukan di variabel
// modul, karena beberapa overlay bisa menutup bersamaan.
//
// sipPrepareOpen() wajib dipanggil di SETIAP jalur buka. Tanpa itu ada dua
// kegagalan nyata: (1) timeout basi dari penutupan sebelumnya menyetel
// display:none pada modal yang baru dibuka, dan (2) kelas sip-exit yang
// masih menempel membuat modal terbuka pada opacity 0 dengan
// pointer-events:none - terlihat kosong dan tidak bisa diklik.
const SIP_EXIT_MS = 150;
function sipCloseOverlay(el) {
    if (!el) return;
    clearTimeout(el._exitT);
    el.classList.add('sip-exit');
    el._exitT = setTimeout(() => {
        el.classList.remove('sip-exit');
        el.style.display = 'none';
    }, SIP_EXIT_MS);
}
function sipPrepareOpen(el) {
    if (!el) return;
    clearTimeout(el._exitT);
    el.classList.remove('sip-exit');
}

// CHECK-A: pengganti prompt() — mengembalikan Promise<string|null>
function showInputModal(message, { placeholder = '', defaultValue = '', okClass = 'btn-primary' } = {}) {
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

// CHECK-B: pengganti alert() untuk pesan info/sukses
function _showToast(msg) {
    let toast = document.getElementById('_guru-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_guru-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--color-surface,#fff);border:1px solid var(--color-border,#e5e7eb);padding:10px 18px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:0.875rem;z-index:8000;pointer-events:none;white-space:pre-wrap;max-width:320px;text-align:center';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    // Toast bisa dipanggil beruntun. sipPrepareOpen membatalkan exit yang
    // masih menggantung dan melepas .sip-exit, supaya pesan baru tidak
    // muncul pada opacity 0 milik animasi keluar pesan sebelumnya.
    sipPrepareOpen(toast);
    toast.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { sipCloseOverlay(toast); }, 3500);
}

/** Pesan error ramah pengguna — detail teknis ke console saja. */
function fe(err, ctx = 'muat') {
    console.error('[guru]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) {
        // GRU-06: sesi sudah tidak valid — alihkan ke login, jangan hanya
        // menampilkan pesan. Guard fe._redirecting mencegah banyak request
        // yang gagal berbarengan menjadwalkan redirect berkali-kali.
        if (!fe._redirecting) {
            fe._redirecting = true;
            // Auto-reset setelah 10 detik — jika redirect gagal (mis. diblokir
            // ekstensi browser), error JWT berikutnya tetap bisa memicu redirect
            // alih-alih terjebak selamanya oleh guard ini.
            setTimeout(() => { fe._redirecting = false; }, 10000);
            setTimeout(() => window.location.replace(getLoginUrl()), 1500);
        }
        return 'Sesi habis. Mengalihkan ke halaman login…';
    }
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi. Periksa jaringan.';
    if (m.includes('security policy') || m.includes('permission') || m.includes('forbidden')) return 'Tidak memiliki izin.';
    // Jangan expose kode/pesan raw SQL ke UI — kategorikan berdasarkan kode error
    if (err?.code) {
        const code = String(err.code);
        if (code === 'PGRST116') return 'Data tidak ditemukan.';
        if (code.startsWith('23')) return ctx === 's' ? 'Data duplikat atau tidak valid.' : 'Terjadi kesalahan data.';
    }
    return ctx === 's' ? 'Gagal menyimpan. Silakan coba lagi.'
         : ctx === 'h' ? 'Gagal menghapus. Silakan coba lagi.'
         : 'Gagal memuat data. Silakan coba lagi.';
}

function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(t) { return t ? t.slice(0, 5) : '—'; }

// ─── Boot ────────────────────────────────────────────────────
async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.replace(getLoginUrl()); return; }

    currentUser = await getCurrentUserRow(auth.user);
    if (!currentUser || !GURU_ROLES.includes(currentUser.role_type)
        || currentUser.is_active === false || currentUser.deleted_at) {
        await supabase.auth.signOut();
        window.location.replace(getLoginUrl());
        return;
    }

    await Promise.all([
        applyBrandingById(currentUser.school_id, supabase),
        checkMustChangePassword(supabase, currentUser),
        initLoginGuard(supabase, currentUser),
        getSchoolConfig().then(c => { config = c; }),
    ]);
    if (!config) throw new Error('School config tidak tersedia. Hubungi admin sekolah.');
    jabatan   = getJabatan(currentUser);
    isTeacher = !!currentUser.teacher_code
        || (currentUser.teaching_assignments?.[0]?.count ?? 0) > 0;

    // Header
    document.getElementById('hdr-name').textContent = currentUser.full_name;
    const roleLabel = jabatan.length
        ? (isTeacher ? 'Guru' : '') +
          (isTeacher && jabatan.length ? ' · ' : '') +
          jabatan.map(jabatanLabel).join(' · ')
        : 'Guru';
    document.getElementById('hdr-role').textContent = roleLabel;

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        // A-07: data belum terkirim tetap di perangkat ini; beri tahu sebelum keluar.
        let belum = 0;
        try { belum = await pendingCount(); } catch (_) { belum = 0; }
        if (belum > 0 && !confirm(`Ada ${belum} data yang belum terkirim ke server. Data itu tetap tersimpan di perangkat ini dan akan dikirim saat Anda login lagi dengan akun yang sama. Tetap keluar?`)) return;
        // Salinan data siswa/riwayat di perangkat dibersihkan agar tidak tertinggal di perangkat bersama.
        try { Object.keys(localStorage).filter(k => k.startsWith('smkhr:')).forEach(k => localStorage.removeItem(k)); } catch (_) {}
        await logout();
        window.location.replace(getLoginUrl());
    });

    document.getElementById('notif-bell-btn')?.addEventListener('click', e => { e.stopPropagation(); openNotifDropdown(); });
    document.addEventListener('click', e => {
        if (!e.target.closest('#notif-bell-btn') && !e.target.closest('#notif-dropdown')) {
            const d = document.getElementById('notif-dropdown');
            if (d) d.style.display = 'none';
        }
    });
    refreshNotifBadge();
    startNotifPolling();

    await buildTabs();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';

    const defaultTab = isTeacher ? 'guru' : (jabatan[0] ?? 'kasus');
    const savedTab   = localStorage.getItem('sip_active_tab_guru');
    const tabExists  = savedTab && !!document.querySelector(`[data-tab="${savedTab}"]`);
    const hashTab    = location.hash.slice(1);
    const hashExists = hashTab && !!document.querySelector(`[data-tab="${hashTab}"]`);
    const startTab   = hashExists ? hashTab : (tabExists ? savedTab : null) || defaultTab;
    await activateTab(startTab, { replace: true });
    await loadTabContent(startTab);

    window.addEventListener('popstate', async e => {
        const key = e.state?.tab ?? location.hash.slice(1);
        if (key && document.querySelector(`[data-tab="${key}"]`)) {
            await activateTab(key, { noHistory: true });
            await loadTabContent(key);
        }
    });

    // Offline sync: tampilkan status + kirim absensi tertunda.
    await updateSyncBanner();
    window.addEventListener('online',  runFlush);
    window.addEventListener('offline', updateSyncBanner);
    runFlush();

    // Peringatan login dari perangkat baru: daftarkan perangkat ini.
    // Jika belum pernah dipakai (bukan yg pertama), server menaruh notif
    // di lonceng. Non-blocking; kegagalan tak mengganggu dashboard.
    registerLoginDevice();

    // Notifikasi: cek unread count lalu poll tiap 1 menit.
    refreshNotifBadge();
    startNotifPolling();

    // NOTIF-01: ack yang gagal (jaringan/timeout) masuk antrean persisten
    // dan dicoba ulang saat online / tab aktif / halaman dimuat ulang.
    // Badge di-refresh setiap flush supaya rollback (ack yang habis jatah
    // percobaan) langsung terlihat sebagai unread lagi.
    registerAckHandler('notif_read', ids => markNotificationsRead(ids));
    registerAckHandler('forum_ack',  p =>
        addForumSekolahAcknowledgement(p.postId, p.userId, p.schoolId));
    window.addEventListener('sip:ack-flushed', () => { refreshNotifBadge(); });
    initAckQueue({ userId: currentUser.user_id });

    initPWAInstallBanner();
    showPwaBanner({ hasBottomNav: true });
    initSessionGuard(supabase, getLoginUrl());
}

function initPWAInstallBanner() {
    if (!sessionStorage.getItem('pwa_show_install_banner')) return;
    sessionStorage.removeItem('pwa_show_install_banner');

    if (localStorage.getItem('pwa_install_dismissed')) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isStandalone) return;

    const banner = document.getElementById('pwa-install-banner');
    if (!banner) return;
    banner.style.display = 'flex';

    const autoHide = setTimeout(() => { banner.style.display = 'none'; }, 10000);

    document.getElementById('pwa-install-btn')?.addEventListener('click', () => {
        clearTimeout(autoHide);
        banner.style.display = 'none';
        localStorage.setItem('pwa_install_dismissed', '1');
        showPWAInstallInstructions();
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
        clearTimeout(autoHide);
        banner.style.display = 'none';
    });
}

function showPWAInstallInstructions() {
    const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    let steps = '';
    if (isIOS) {
        steps = `<li>Tap tombol <strong>Bagikan</strong> (□↑) di Safari</li>
                 <li>Scroll ke bawah, tap <strong>"Tambahkan ke Layar Utama"</strong></li>
                 <li>Tap <strong>Tambahkan</strong></li>`;
    } else if (isAndroid) {
        steps = `<li>Tap menu <strong>⋮</strong> di Chrome</li>
                 <li>Tap <strong>"Tambahkan ke layar utama"</strong></li>
                 <li>Tap <strong>Tambahkan</strong></li>`;
    } else {
        steps = `<li>Klik ikon <strong>Install</strong> (⊕) di address bar browser</li>
                 <li>Klik <strong>Install</strong></li>`;
    }

    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);
                  z-index:9999;display:flex;align-items:center;
                  justify-content:center;padding:16px">
        <div style="background:var(--color-surface,#1e293b);border-radius:16px;
                    padding:24px;max-width:360px;width:100%;color:var(--color-text,#fff)">
          <h3 style="margin:0 0 16px;font-size:18px">📱 Pasang Aplikasi SIP</h3>
          <ol style="margin:0;padding-left:20px;line-height:1.8">${steps}</ol>
          <button onclick="this.closest('div[style]').remove()"
                  style="margin-top:16px;width:100%;padding:10px;
                         background:var(--color-primary,#1d4ed8);color:white;
                         border:none;border-radius:8px;cursor:pointer;font-size:14px">
            Mengerti
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
}

// ─── Tab navigation ──────────────────────────────────────────
const TAB_SHORT = {
    guru: 'Beranda', wali_kelas: 'Wali', bk: 'BK', kaprodi: 'Prodi',
    waka_kesiswaan: 'Kesiswaan', waka_kurikulum: 'Kurikulum', wakasek: 'Wakasek', waka_humas: 'Humas',
    kepsek: 'Kepsek',
    kasus: 'Pembinaan', jurnal: 'Jurnal', observasi: 'Catatan', forum: 'Forum',
    perangkat_ajar: 'Perangkat', piket: 'Piket',
};
const TAB_ICON = {
    guru: 'ti-home', wali_kelas: 'ti-users', bk: 'ti-heart-handshake', kaprodi: 'ti-building',
    waka_kesiswaan: 'ti-school', waka_kurikulum: 'ti-book', wakasek: 'ti-school', waka_humas: 'ti-briefcase',
    kepsek: 'ti-chart-line',
    kasus: 'ti-alert-triangle', jurnal: 'ti-notebook', observasi: 'ti-notes', forum: 'ti-messages',
    perangkat_ajar: 'ti-book-2', piket: 'ti-clipboard-list',
};

async function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const tabs = [];
    if (isTeacher) tabs.push({ key: 'guru', label: 'Dashboard Guru' });
    jabatan.forEach(j => tabs.push({ key: j, label: jabatanLabel(j) }));
    // Kepala Sekolah dikeluarkan dari Pembinaan Siswa (keputusan Romo 18 Okt 2026): hanya angka agregat di tab Kepala Sekolah.
    if (!jabatan.includes('kepsek')) tabs.push({ key: 'kasus', label: 'Pembinaan Siswa' });

    const onDuty = await isOnDutyToday();
    // Saat status piket gagal dibaca, tampilkan tab agar kegagalan terlihat
    // sebagai error tab, bukan seolah-olah guru tidak bertugas.
    if (onDuty !== false) tabs.push({ key: 'piket', label: 'Piket' });
    if (isTeacher) tabs.push({ key: 'observasi', label: 'Catatan Siswa' });
    if (isTeacher) tabs.push({ key: 'jurnal', label: 'Jurnal Mengajar' });
    tabs.push({ key: 'forum', label: 'Forum' });

    nav.innerHTML = tabs.map(t =>
        `<button class="tab-btn" data-tab="${t.key}">${esc(t.label)}</button>`
    ).join('');

    botNav.innerHTML = `<div class="bottom-nav-inner">${
        tabs.map(t => {
            const icon = TAB_ICON[t.key] ?? 'ti-circle';
            return `<button class="tab-btn" data-tab="${t.key}"><i class="ti ${icon} nav-icon" aria-hidden="true"></i>${esc(TAB_SHORT[t.key] ?? t.label)}</button>`;
        }).join('')
    }</div>`;

    const handler = async (e) => {
        const key = e.target.closest('[data-tab]')?.dataset?.tab;
        if (!key) return;
        await activateTab(key);
        await loadTabContent(key);
    };
    nav.addEventListener('click', handler);
    botNav.addEventListener('click', handler);
}

// Sekuensial, bukan tumpang tindih: panel lama diberi .sip-exit dan tetap
// terender selama SIP_EXIT_MS (dijaga display:block !important di
// transitions.css), baru sesudah itu .active berpindah ke panel baru.
// Kalau keduanya aktif bersamaan, dua elemen block ikut alur normal dan
// halaman melompat memanjang selama animasi berlangsung.
//
// Mengembalikan Promise supaya loadTabContent() menunggu - penanganan
// errornya menyeleksi '.tab-panel.active .page-body', yang selama jeda
// masih menunjuk panel lama.
function activateTab(key, { replace = false, noHistory = false } = {}) {
    localStorage.setItem('sip_active_tab_guru', key);
    if (!noHistory) {
        if (replace) history.replaceState({ tab: key }, '', '#' + key);
        else         history.pushState({ tab: key }, '', '#' + key);
    }
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === key));

    const panels   = document.querySelectorAll('.tab-panel');
    const incoming = document.getElementById(`tab-${key}`);
    const outgoing = [...panels].find(p => p.classList.contains('active') && p !== incoming);

    // Batalkan exit yang masih menggantung dari klik sebelumnya. Tanpa ini,
    // klik tab cepat berturut-turut membuat timeout basi melepas .active
    // dari panel yang baru saja dipasang.
    panels.forEach(p => { clearTimeout(p._exitT); p.classList.remove('sip-exit'); });

    const show = () => panels.forEach(p => p.classList.toggle('active', p === incoming));

    if (!outgoing) { show(); return Promise.resolve(); }

    outgoing.classList.add('sip-exit');
    return new Promise(resolve => {
        outgoing._exitT = setTimeout(() => {
            outgoing.classList.remove('sip-exit');
            show();
            resolve();
        }, SIP_EXIT_MS);
    });
}

async function loadTabContent(key) {
    try {
        switch (key) {
            case 'guru':        await initGuruTab({ currentUser, config, jabatan, LC }); break;
            case 'wali_kelas':  await initWaliTab({ currentUser, config, kasusEngine: { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList, showKasusLoadError } }); break;
            case 'bk':          await initBkTab({ config, kasusEngine: { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } }); break;
            case 'kaprodi':     await initKaprodiTab({ currentUser, config, kasusEngine: { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } }); break;
            case 'waka_kesiswaan': await initWakaKesiswaanTab({ config, kasusEngine: { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } }); break;
            case 'waka_kurikulum': await initWakaKurTab({ config }); break;
            case 'wakasek': {
                // Pindahkan konten dari tab-waka_kesiswaan dan tab-waka_kurikulum
                // ke tab-wakasek (sekali saja — idempoten via pengecekan children.length).
                const dest = document.querySelector('#tab-wakasek .page-body');
                if (!dest.children.length) {
                    const src1 = document.querySelector('#tab-waka_kesiswaan .page-body');
                    const src2 = document.querySelector('#tab-waka_kurikulum .page-body');
                    while (src1.firstChild) dest.appendChild(src1.firstChild);
                    const hr = document.createElement('hr');
                    hr.style.cssText = 'border:none;border-top:1px solid var(--color-border);margin:8px 0 16px';
                    dest.appendChild(hr);
                    while (src2.firstChild) dest.appendChild(src2.firstChild);
                }
                await initWakaKesiswaanTab({ config, kasusEngine: { makeKasusCtx, showKasusList, wireKasusDownloadButtons, loadKasusList } });
                await initWakaKurTab({ config });
                break;
            }
            case 'waka_humas':  await initWakaHumasTab({ currentUser }); break;
            case 'kepsek':      await initKepsekTab({ currentUser, config }); break;

            case 'kasus':       setGuruContext({ currentUser, config, jabatan, LC }); await initKasusTab(); break;
            case 'piket':       await initPiketTab({ currentUser }); break;
            case 'jurnal':      await initJurnalTab(); break;
            case 'observasi':   setGuruContext({ currentUser, config, jabatan, LC }); await initObsTab({ currentUser, config, jabatan, LC }); break;
            case 'forum':       await initForumTab({ currentUser, config }); break;
        }
    } catch (err) {
        console.error('[loadTabContent]', key, err);
        const activePanel = document.querySelector('.tab-panel.active .page-body');
        if (activePanel) {
            activePanel.innerHTML = '<p style="padding:1.5rem; color:red">Gagal memuat tab ini. Silakan coba lagi atau refresh halaman.</p>';
        }
    }
}

// ─── TAB KASUS ───────────────────────────────────────────────

const CASE_STATUS_LABEL = {
    OPEN:         'Buka',
    UNDER_REVIEW: 'Ditinjau',
    INTERVENTION: 'Intervensi',
    MONITORING:   'Monitoring',
    CLOSED:       'Tutup',
};
const CASE_STATUS_BADGE = {
    OPEN:         'badge-open',
    UNDER_REVIEW: 'badge-review',
    INTERVENTION: 'badge-intervention',
    MONITORING:   'badge-monitoring',
    CLOSED:       'badge-closed',
};
const CASE_TRACK_LABEL = { SEKOLAH: 'Sekolah', PKL: 'PKL' };
// Rantai = PENUNTUN saja (referensi untuk peringatan), BUKAN batasan.
// Eskalasi antar-internal bebas; server hanya mengunci: target wajib peran
// internal kasus, & DUDI hanya → KAPRODI (mig 20260703250000).
const ESCALATION_CHAIN = {
    SEKOLAH: ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKASEK'],
    PKL:     ['DUDI','KAPRODI','WAKA_KESISWAAN','WAKASEK'],
};
// Satu langkah mundur yang diizinkan (server menegakkan aturan yang sama).
const STATUS_BACK_ONE = { UNDER_REVIEW: 'OPEN', INTERVENTION: 'UNDER_REVIEW', MONITORING: 'INTERVENTION' };
const STATUS_AFTER_CURRENT = {
    OPEN:         ['UNDER_REVIEW','INTERVENTION','MONITORING'],
    UNDER_REVIEW: ['INTERVENTION','MONITORING'],
    INTERVENTION: ['MONITORING'],
    MONITORING:   [],
};
const EVENT_TYPE_LABEL = {
    OPENED:               'Kasus Dibuka',
    NOTE_ADDED:           'Catatan',
    CASE_EDITED:          'Kasus Diedit',
    ESCALATED:            'Eskalasi',
    STATUS_CHANGED:       'Status Berubah',
    SHARED_TO_STUDENT:    'Dibagikan ke Siswa',
    UNSHARED_FROM_STUDENT:'Akses Siswa Dicabut',
    SHARED_TO_PARENT:     'Dibagikan ke Orang Tua',
    UNSHARED_FROM_PARENT: 'Akses Orang Tua Dicabut',
    CLOSED:               'Kasus Ditutup',
};

const KASUS_PAGE    = 50;
let _kasusTabInit   = false;
let _kasusTabBusy   = false;
const _kasusSiswaDiketahui = new Map();
let _kasusSearchSeq = 0;

/**
 * Konteks render kasus — satu objek per tab yang menampilkan daftar & detail kasus.
 *
 * `prefix`     menentukan id elemen HTML yang dipakai: `${prefix}-list-content`,
 *              `${prefix}-detail-header`, dst. Tab "Pembinaan Siswa" memakai 'kasus'.
 * `extraQuery` di-spread ke getCases() untuk filter khusus tab — mis. `studentIds`
 *              (wali kelas / kaprodi) atau `statusNotClosed` (kepsek).
 *
 * State paginasi & seleksi ikut di dalam konteks, bukan variabel modul, supaya
 * beberapa tab bisa menampilkan daftar kasus sekaligus tanpa saling menimpa.
 */
function makeKasusCtx(prefix, extraQuery = {}) {
    return { prefix, extraQuery, allCases: [], offset: 0, hasMore: false, currentId: null, listSeq: 0, detailSeq: 0 };
}

// Konteks tab-kasus — dipakai sebagai default oleh seluruh fungsi di bawah,
// sehingga pemanggil lama yang tidak mengirim ctx berperilaku persis seperti semula.
const kasusCtxDefault = makeKasusCtx('kasus');

/** getElementById ber-prefix konteks. */
function kEl(ctx, suffix) { return document.getElementById(`${ctx.prefix}-${suffix}`); }

async function initKasusTab() {
    markKasusAsSeen();
    if (_kasusTabInit) { await loadKasusList(); return; }
    if (_kasusTabBusy) return;
    _kasusTabBusy = true;
    try {
        await ensureStudentPool();
    } catch (err) {
        showKasusLoadError(err, kasusCtxDefault, () => initKasusTab());
        return;
    } finally {
        _kasusTabBusy = false;
    }

    // Filters
    document.getElementById('kasus-filter-status').addEventListener('change', () => loadKasusList());
    document.getElementById('kasus-filter-track').addEventListener('change',  () => loadKasusList());
    wireKasusDownloadButtons(kasusCtxDefault);

    // Sembunyikan tombol buat kasus untuk role ADMINISTRATIVE (bukan penanganan siswa)
    if (currentUser.role_type === 'ADMINISTRATIVE') {
        document.getElementById('kasus-new-btn').style.display = 'none';
    }

    // Offline guard — disable tombol + banner saat tidak ada koneksi
    function syncKasusOnlineState() {
        const online = navigator.onLine;
        const btn    = document.getElementById('kasus-new-btn');
        const banner = document.getElementById('kasus-offline-banner');
        if (btn) btn.disabled         = !online;
        banner.style.display  = online ? 'none' : 'block';
    }
    syncKasusOnlineState();
    window.addEventListener('online',  syncKasusOnlineState);
    window.addEventListener('offline', syncKasusOnlineState);

    // New case button
    document.getElementById('kasus-new-btn').addEventListener('click', openKasusModal);
    document.getElementById('kasus-create-cancel-btn').addEventListener('click', closeKasusModal);
    // Bungkus arrow — showKasusList sekarang menerima ctx, sedangkan handler DOM
    // akan mengoper objek Event sebagai argumen pertama.
    document.getElementById('kasus-back-btn').addEventListener('click', () => showKasusList());

    // Create form
    const createForm  = document.getElementById('kasus-create-form');
    const searchEl    = document.getElementById('kasus-c-student-search');
    const studentIdEl = document.getElementById('kasus-c-student-id');
    const listEl      = document.getElementById('kasus-c-student-list');
    const trackField  = document.getElementById('kasus-c-track-field');
    const trackEl     = document.getElementById('kasus-c-track');

    // Kaprodi bisa pilih jalur; DUDI selalu PKL; semua lain selalu Sekolah
    const isKaprodi = jabatan.includes('kaprodi');
    const isDudi    = jabatan.includes('dudi');
    if (isKaprodi) {
        trackField.style.display = '';
    } else if (isDudi) {
        trackField.style.display = 'none';
        trackEl.value = 'PKL';
    } else {
        trackField.style.display = 'none';
        trackEl.value = 'SEKOLAH';
    }

    searchEl.addEventListener('input', async () => {
        const seq = ++_kasusSearchSeq;
        studentIdEl.value = '';
        listEl.style.display = 'none';
        const raw = searchEl.value.trim();
        const q   = raw.toLowerCase();
        if (q.length < 2) { listEl.style.display = 'none'; return; }

        let localPool = _myStudents;
        if (jabatan.includes('kaprodi') && _kaprodiAllStudents.length) {
            const seen = new Set(_myStudents.map(s => s.student_id));
            localPool = [..._myStudents, ..._kaprodiAllStudents.filter(s => !seen.has(s.student_id))];
        }
        const local = localPool.filter(s =>
            s.full_name.toLowerCase().includes(q) || s.nis?.includes(q)
        );

        let hits = local;
        if (_isBroadObserver) {
            try {
                const remote = await searchStudents(raw, currentUser.school_id);
                remote.forEach(s => _kasusSiswaDiketahui.set(s.student_id, s));
                const seen = new Set(local.map(s => s.student_id));
                hits = [...local, ...remote.filter(s => !seen.has(s.student_id))];
            } catch {
                // Luring: pakai siswa yang pernah muncul di pencarian sesi ini
                const seen = new Set(local.map(s => s.student_id));
                const lama = [..._kasusSiswaDiketahui.values()].filter(s => !seen.has(s.student_id) &&
                    (s.full_name.toLowerCase().includes(q) || s.nis?.includes(q)));
                hits = [...local, ...lama];
                if (!hits.length && !navigator.onLine) showCreateMsg('Sedang luring: pencarian siswa lain butuh koneksi. Hubungkan kembali, atau pilih siswa yang Anda ajar.', true);
            }
        }
        const modal = document.getElementById('kasus-create-modal');
        if (seq !== _kasusSearchSeq || modal.style.display !== 'flex' || modal.classList.contains('sip-exit')) return;

        hits = hits.slice(0, 12);
        if (!hits.length) { listEl.style.display = 'none'; return; }
        listEl.innerHTML = hits.map(r =>
            `<div style="padding:8px 12px; cursor:pointer; font-size:13px" data-id="${r.student_id}" data-name="${esc(r.full_name)}">${esc(r.full_name)} — ${esc(r.nis ?? '')}${r.class_name ? ' · ' + esc(r.class_name) : ''}</div>`
        ).join('');
        listEl.style.display = 'block';
        listEl.querySelectorAll('div').forEach(el => {
            el.addEventListener('click', () => {
                ++_kasusSearchSeq;
                searchEl.value = el.dataset.name;
                studentIdEl.value = el.dataset.id;
                listEl.style.display = 'none';
            });
            el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
        });
    });

    createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl  = document.getElementById('kasus-create-msg');
        const btnEl  = document.getElementById('kasus-create-submit-btn');
        const sId    = studentIdEl.value;
        const title  = document.getElementById('kasus-c-title').value.trim();
        const desc   = document.getElementById('kasus-c-desc').value.trim();
        const track  = document.getElementById('kasus-c-track').value;

        msgEl.style.display = 'none';
        if (!sId)             { showCreateMsg('Pilih siswa dari daftar.', true); return; }
        if (title.length < 5) { showCreateMsg('Judul minimal 5 karakter.', true); return; }
        if (desc.length < 20) { showCreateMsg('Deskripsi minimal 20 karakter.', true); return; }

        btnEl.disabled = true; btnEl.textContent = 'Menyimpan…';
        try {
            const r = await createCase({
                studentId:   sId,
                studentName: (document.getElementById('kasus-c-student-search').value || '').trim() || null,
                title,
                description: desc,
                track,
                audience: 'PRIVATE',
                authorUserId: currentUser.user_id,
                authorRole:   currentUser.role_type,
            });
            closeKasusModal();
            if (r._queued) {
                showCreateMsg('Kasus disimpan lokal. Akan dikirim saat koneksi kembali.', false);
                await loadKasusList();
            } else {
                await openKasusDetail(r.case_id);   // panel "Pembaca Kasus" tersedia langsung untuk menandai siapa yang boleh membaca
            }
        } catch (err) {
            showCreateMsg(fe(err, 's'), true);
        } finally {
            btnEl.disabled = false; btnEl.textContent = 'Simpan';
        }
    });

    _kasusTabInit = true;
    await loadKasusList();
}

function showCreateMsg(msg, isErr = false) {
    const el = document.getElementById('kasus-create-msg');
    el.style.display = 'block';
    el.style.color   = isErr ? 'var(--color-danger)' : 'var(--color-success)';
    el.textContent   = msg;
}

function openKasusModal() {
    if (!navigator.onLine) return;
    ++_kasusSearchSeq;
    const modal = document.getElementById('kasus-create-modal');
    document.getElementById('kasus-create-form').reset();
    document.getElementById('kasus-c-student-id').value = '';
    document.getElementById('kasus-create-msg').style.display = 'none';
    document.getElementById('kasus-c-student-list').style.display = 'none';
    sipPrepareOpen(modal);
    modal.style.display = 'flex';
}
function closeKasusModal() {
    ++_kasusSearchSeq;
    sipCloseOverlay(document.getElementById('kasus-create-modal'));
}

function showKasusLoadError(err, ctx, retry, append = false) {
    kEl(ctx, 'list-error')?.remove();
    const errorEl = document.createElement('div');
    errorEl.id = `${ctx.prefix}-list-error`;
    errorEl.className = 'status-err';
    errorEl.setAttribute('role', 'alert');
    errorEl.innerHTML = `${esc(fe(err))} <button class="btn btn-secondary btn-sm">Coba Lagi</button>`;
    const contentEl = kEl(ctx, 'list-content');
    if (append) contentEl.appendChild(errorEl);
    else contentEl.replaceChildren(errorEl);
    errorEl.querySelector('button').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        await retry();
    });
}

/**
 * Kasus yang masih mengantre di perangkat (dibuat saat luring atau server gagal sementara): tampil di atas daftar, dengan tombol
 * "Hapus dari perangkat". Hanya untuk tab Pembinaan Siswa, tempat kasus dibuat.
 */
/** Memuat ulang daftar kasus (yang juga menggambar ulang panel antrean) setelah ada kiriman dari antrean; aman dipanggil bila tab kasus belum dibuka. */
async function segarkanKasusSetelahKirim() {
    const ctx = kasusCtxDefault;
    if (!kEl(ctx, 'list-content')) return;
    await loadKasusList(false, ctx);
}
setOnSyncCallback(segarkanKasusSetelahKirim);

async function renderKasusAntrean(ctx = kasusCtxDefault) {
    if (ctx !== kasusCtxDefault) return;
    const contentEl = kEl(ctx, 'list-content');
    if (!contentEl) return;
    let box = kEl(ctx, 'antrean');
    if (!box) {
        box = document.createElement('div');
        box.id = `${ctx.prefix}-antrean`;
        contentEl.parentNode.insertBefore(box, contentEl);
    }
    let items = [];
    try { items = await listQueuedCases(); } catch (_) { items = []; }
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
        <div class="section-card" style="margin-bottom:12px;border-left:3px solid var(--color-warning)">
            <h4 style="margin:0 0 6px">Menunggu dikirim (${items.length})</h4>
            <p class="hint" style="margin:0 0 8px;font-size:12px">Kasus ini baru tersimpan di perangkat ini dan belum ada di server. Kasus akan dikirim otomatis saat koneksi kembali.</p>
            ${items.map(i => `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:0.5px solid var(--color-border)">
                <div style="flex:1;min-width:180px">
                    <strong style="font-size:13px">${esc(i.title ?? '—')}</strong>
                    <div style="font-size:12px;color:var(--color-text-muted)">${esc(i.studentName ?? 'Siswa')} · ${esc(CASE_TRACK_LABEL[i.track] ?? i.track ?? '')}
                        · ${i.ditolak ? `<span style="color:var(--color-danger)">Ditolak server${i.pesan ? ': ' + esc(i.pesan) : ''}</span>` : 'Menunggu koneksi'}</div>
                </div>
                <button type="button" class="btn btn-sm btn-danger-outline" data-buang-antrean="${esc(i.key)}">Hapus dari perangkat</button>
            </div>`).join('')}
            <div style="margin-top:8px"><button type="button" class="btn btn-sm btn-secondary" id="${ctx.prefix}-antrean-kirim">Coba kirim sekarang</button>
                <span id="${ctx.prefix}-antrean-msg" style="font-size:12px;margin-left:8px"></span></div>
        </div>`;
    box.querySelectorAll('[data-buang-antrean]').forEach(btn => btn.addEventListener('click', async () => {
        if (!window.confirm('Hapus kasus ini dari perangkat? Kasus yang belum terkirim akan hilang dan tidak dapat dikembalikan.')) return;
        btn.disabled = true;
        try { await discardQueuedCase(btn.dataset.buangAntrean); } catch (_) { /* tampilan dimuat ulang di bawah */ }
        await renderKasusAntrean(ctx);
        if (typeof updateSyncBanner === 'function') updateSyncBanner().catch?.(() => {});
    }));
    kEl(ctx, 'antrean-kirim')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const msg = kEl(ctx, 'antrean-msg');
        try {
            const sebelum = items.length;
            const r = await flushPending();
            // Pengiriman otomatis (peristiwa online) bisa sudah mengosongkan antrean sebelum tombol ini ditekan, sehingga r.synced = 0:
            // bandingkan sisa antrean, bukan hanya r.synced.
            const sisa = (await listQueuedCases().catch(() => items)).length;
            const terkirim = r.synced > 0 || sisa < sebelum;
            if (msg) msg.textContent = r.sessionExpired ? 'Sesi habis, login ulang.' : (terkirim ? 'Terkirim.' : 'Belum terkirim (masih luring atau server sibuk).');
            if (terkirim) await loadKasusList(false, ctx);
        } catch (err) { if (msg) msg.textContent = fe(err, 's'); }
        e.target.disabled = false;
    });
}

async function loadKasusList(append = false, ctx = kasusCtxDefault) {
    const seq = ++ctx.listSeq;
    const contentEl = kEl(ctx, 'list-content');
    if (!append) renderKasusAntrean(ctx);   // tidak ditunggu: antrean tampil walau pemuatan daftar gagal (luring)
    kEl(ctx, 'list-error')?.remove();
    if (!append) {
        ctx.allCases = [];
        ctx.offset   = 0;
        ctx.hasMore  = false;
        contentEl.innerHTML = '<p class="hint">Memuat kasus…</p>';
    }
    // Tab jabatan boleh tidak menyediakan kontrol filter — anggap "tanpa filter".
    const status = kEl(ctx, 'filter-status')?.value ?? '';
    const track  = kEl(ctx, 'filter-track')?.value  ?? '';
    try {
        const rows = await getCases({
            ...ctx.extraQuery,
            status, track, offset: ctx.offset, limit: KASUS_PAGE + 1,
        });
        if (seq !== ctx.listSeq) return;
        ctx.hasMore  = rows.length > KASUS_PAGE;
        const page   = ctx.hasMore ? rows.slice(0, KASUS_PAGE) : rows;
        ctx.allCases = append ? [...ctx.allCases, ...page] : page;
        ctx.offset   = ctx.allCases.length;
        renderKasusList(ctx);
    } catch (err) {
        if (seq !== ctx.listSeq) return;
        showKasusLoadError(err, ctx, () => loadKasusList(append, ctx), append);
    }
}

function renderKasusList(ctx = kasusCtxDefault) {
    const contentEl = kEl(ctx, 'list-content');

    if (!ctx.allCases.length) {
        contentEl.innerHTML = '<p class="hint">Tidak ada kasus yang sesuai filter.</p>';
        return;
    }

    // Badge "Pembaca": kasus yang terlihat hanya karena Anda ditandai (bukan pembuat, penangan, Kepsek, atau Waka Kesiswaan).
    const pengawas = currentUser.role_type === 'WAKA_KESISWAAN' || currentUser.role_type === 'WAKASEK';   // Kepala Sekolah dikeluarkan dari Pembinaan Siswa (18 Okt 2026)
    const sebagaiPembaca = r => !pengawas && r.created_by_user_id !== currentUser.user_id && r.current_handler_user_id !== currentUser.user_id;

    contentEl.innerHTML = ctx.allCases.map(r => `
        <div class="kasus-row" data-id="${r.case_id}">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap">
                <strong style="font-size:14px; flex:1">${esc(r.title)}</strong>
                ${sebagaiPembaca(r) ? '<span class="badge" style="background:var(--color-bg-alt)" title="Anda ditandai sebagai pembaca kasus ini">👁️ Pembaca</span>' : ''}
                <span class="badge kasus-badge-${(r.status||'').toLowerCase()}">${esc(CASE_STATUS_LABEL[r.status] ?? r.status)}</span>
            </div>
            <div style="font-size:12px; color:var(--color-text-muted); margin-top:4px">
                ${esc(r.student?.full_name ?? 'Siswa tidak dapat ditampilkan')}${r.student?.nis ? ' (' + esc(r.student.nis) + ')' : ''}
                &middot; ${esc(CASE_TRACK_LABEL[r.track] ?? r.track)}
                &middot; Handler: ${esc(r.handler?.full_name ?? '—')}
                &middot; ${fmt(r.created_at)}
            </div>
        </div>
    `).join('') + (ctx.hasMore
        ? `<div style="text-align:center;padding:12px">
               <button class="btn btn-secondary btn-sm" id="${ctx.prefix}-load-more-btn">Muat lebih…</button>
           </div>`
        : '');

    contentEl.querySelectorAll('.kasus-row').forEach(el => {
        el.addEventListener('click', () => openKasusDetail(el.dataset.id, ctx));
    });
    const moreBtn = kEl(ctx, 'load-more-btn');
    if (moreBtn) moreBtn.addEventListener('click', async () => {
        moreBtn.disabled = true;
        moreBtn.textContent = 'Memuat…';
        try {
            await loadKasusList(true, ctx);
        } finally {
            moreBtn.disabled = false;
            moreBtn.textContent = 'Muat lebih…';
        }
    });
}

function showKasusList(ctx = kasusCtxDefault) {
    kEl(ctx, 'list-view').style.display   = 'block';
    kEl(ctx, 'detail-view').style.display = 'none';
    ctx.currentId = null;
    ++ctx.detailSeq;
}

function resetKasusActionForm(ctx) {
    for (const suffix of ['comment-text', 'escalate-note', 'status-note']) {
        const el = kEl(ctx, suffix);
        if (el) el.value = '';
    }
    for (const suffix of ['comment-msg', 'escalate-msg', 'status-msg']) {
        const el = kEl(ctx, suffix);
        if (el) el.textContent = '';
    }
    const visible = kEl(ctx, 'comment-visible');
    if (visible) visible.checked = false;
    const close = kEl(ctx, 'close-btn');
    if (close) close.dataset.confirming = '';
}

function showKasusDetailError(err, ctx) {
    kEl(ctx, 'actions').style.display = 'none';
    kEl(ctx, 'events-list').innerHTML = '';
    kEl(ctx, 'detail-header').innerHTML = `<div class="status-err" role="alert">${esc(fe(err))}
        <button class="btn btn-secondary btn-sm">Coba Lagi</button></div>`;
    kEl(ctx, 'detail-header').querySelector('button').addEventListener('click', () => openKasusDetail(ctx.currentId, ctx));
}

async function openKasusDetail(caseId, ctx = kasusCtxDefault) {
    if (ctx.currentId !== caseId) resetKasusActionForm(ctx);
    ctx.currentId = caseId;
    const seq = ++ctx.detailSeq;
    kEl(ctx, 'list-view').style.display   = 'none';
    kEl(ctx, 'detail-view').style.display = 'block';
    kEl(ctx, 'detail-header').innerHTML = '<p class="hint">Memuat…</p>';
    kEl(ctx, 'events-list').innerHTML   = '<p class="hint">Memuat…</p>';
    kEl(ctx, 'actions').style.display   = 'none';

    try {
        const [kasus, events] = await Promise.all([getCase(caseId), getCoachingCaseEvents(caseId)]);
        if (ctx.currentId !== caseId || ctx.detailSeq !== seq) return;
        renderKasusDetail(kasus, ctx);
        renderKasusEvents(events, ctx);
        renderKasusViewers(kasus, ctx, seq);   // tidak ditunggu: kegagalan panel tidak boleh menghalangi aksi
        await renderKasusActions(kasus, ctx, seq);
    } catch (err) {
        if (ctx.currentId !== caseId || ctx.detailSeq !== seq) return;
        showKasusDetailError(err, ctx);
    }
}

function renderKasusDetail(k, ctx = kasusCtxDefault) {
    const el = kEl(ctx, 'detail-header');
    el.innerHTML = `
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:12px">
            <h3 style="margin:0; flex:1">${esc(k.title)}</h3>
            <span class="badge kasus-badge-${(k.status||'').toLowerCase()}">${esc(CASE_STATUS_LABEL[k.status] ?? k.status)}</span>
        </div>
        <div style="font-size:13px; color:var(--color-text-muted); margin-bottom:12px">
            Siswa: <strong>${esc(k.student?.full_name ?? '—')}</strong> (${esc(k.student?.nis ?? '—')})
            &middot; Track: <strong>${esc(CASE_TRACK_LABEL[k.track] ?? k.track)}</strong>
            &middot; Handler saat ini: <strong>${esc(k.handler?.full_name ?? '—')}</strong>
        </div>
        <p style="font-size:14px; color:var(--color-text); margin:0">${esc(k.description)}</p>
    `;
}

function renderKasusEvents(events, ctx = kasusCtxDefault) {
    const el = kEl(ctx, 'events-list');
    if (!events.length) {
        el.innerHTML = '<p class="hint">Belum ada event.</p>';
        return;
    }
    el.innerHTML = events.map(ev => {
        const label = EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type;
        const text  = ev.payload?.note ?? ev.payload?.text ?? ev.payload?.summary ?? '';
        let detail  = '';
        if (ev.event_type === 'ESCALATED' && ev.payload?.note)
            detail = esc(ev.payload.note);
        // Status lama/baru hidup di payload JSONB — coaching_case_events tidak punya
        // kolom previous_status/new_status (mig 20260802020000).
        if (ev.event_type === 'STATUS_CHANGED' || ev.event_type === 'CLOSED')
            detail = `${esc(CASE_STATUS_LABEL[ev.payload?.old_status] ?? ev.payload?.old_status ?? '?')} → ${esc(CASE_STATUS_LABEL[ev.payload?.new_status] ?? ev.payload?.new_status ?? '?')}`;
        return `
            <div class="case-event-item">
                <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:4px">
                    <strong>${esc(label)}</strong>
                    ${detail ? `<span style="margin-left:6px">${detail}</span>` : ''}
                    &middot; ${esc(ev.author?.full_name ?? '—')}
                    &middot; ${fmt(ev.created_at)}
                </div>
                ${text ? `<p style="font-size:13px; margin:0; color:var(--color-text)">${esc(text)}</p>` : ''}
            </div>`;
    }).join('');
}

const _labelHubunganKasus = new Map();
const VIEWER_ROLE_LABEL = { WALI_KELAS: 'Wali Kelas', BK: 'Guru BK', GURU: 'Guru', KAPRODI: 'Kaprodi', ORTU: 'Orang tua', SISWA: 'Siswa', TU: 'Tata Usaha',
    WAKA_KESISWAAN: 'Waka Kesiswaan', WAKA_KURIKULUM: 'Waka Kurikulum', WAKA_HUMAS: 'Waka Humas', WAKASEK: 'Wakil Kepala Sekolah', KEPSEK: 'Kepala Sekolah' };

/**
 * Panel "Pembaca Kasus": siapa yang boleh membaca kasus ini selain pembuat, penangan, dan Waka Kesiswaan.
 * Pembuat/penangan saat ini boleh menandai; hanya pembuat boleh mencabut. Server (RLS + fungsi) tetap penentu akhir.
 */
async function renderKasusViewers(kasus, ctx, seq) {
    const isCurrent = () => ctx.currentId === kasus.case_id && ctx.detailSeq === seq;
    const me        = currentUser.user_id;
    const isCreator = kasus.created_by_user_id === me;
    const isHandler = kasus.current_handler_user_id === me;
    const isOversight = (currentUser.role_type === 'WAKA_KESISWAAN' || currentUser.role_type === 'WAKASEK') && !isCreator && !isHandler;
    const isReaderOnly = !isCreator && !isHandler && !isOversight;
    const header = kEl(ctx, 'detail-header');
    let box = kEl(ctx, 'viewers-block');
    if (!box) {
        box = document.createElement('div');
        box.id = `${ctx.prefix}-viewers-block`;
        box.className = 'section-card';
        box.style.marginTop = '12px';
        header.parentNode.insertBefore(box, header.nextSibling);
    }
    box.style.display = 'none';

    // Pengawas (Waka Kesiswaan/Kepsek) yang membuka kasus orang lain: dicatat server (maks. 1x/jam), pembuat dapat melihatnya.
    // Ditunggu dulu agar pembukaan ini sendiri sudah ikut tampil pada log di bawah.
    if (isOversight) await logCaseOversightView(kasus.case_id).catch(() => {});

    if (isReaderOnly) {
        box.innerHTML = `<p style="margin:0;font-size:13px">👁️ Anda membaca kasus ini karena <strong>ditandai</strong> oleh pembuat atau penanganinya. Anda hanya dapat membaca.</p>`;
        box.style.display = 'block';
        return;
    }

    const bisaTandai = isCreator || isHandler;
    let viewers = [], log = [], kandSemua = [];
    try {
        if (bisaTandai) [viewers, kandSemua] = await Promise.all([listCaseViewers(kasus.case_id), getCaseTagCandidates(kasus.case_id).catch(() => [])]);
        if (bisaTandai || isOversight) log = await listCaseAccessLog(kasus.case_id).catch(() => []);
    } catch (err) {
        if (!isCurrent()) return;
        box.innerHTML = `<p class="status-err" style="margin:0">Gagal memuat daftar pembaca. ${esc(fe(err))}</p>`;
        box.style.display = 'block';
        return;
    }
    if (!isCurrent()) return;

    // Server tidak mengembalikan penonton yang sudah ditandai sebagai kandidat, jadi label hubungan diingat selama sesi.
    kandSemua.forEach(c => _labelHubunganKasus.set(`${kasus.case_id}:${c.user_id}`, c.relation_label));
    // Label hubungan berasal dari server (fn_case_list_viewers.relation_label); ingatan sesi dan peran akun hanya cadangan.
    const labelPembaca = v => v.relation_label ?? _labelHubunganKasus.get(`${kasus.case_id}:${v.user_id}`) ?? (v.role_type === 'GURU' ? 'Guru' : (VIEWER_ROLE_LABEL[v.role_type] ?? v.role_type));
    const baris = viewers.map(v => `
        <li style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0">
            <span>${esc(v.full_name)} <span style="color:var(--color-text-muted)">(${esc(labelPembaca(v))})</span></span>
            ${isCreator ? `<button type="button" class="btn btn-sm btn-danger-outline" data-cabut="${v.user_id}">Cabut</button>` : ''}
        </li>`).join('');
    const logHtml = log.length ? `
        <details style="margin-top:10px;font-size:12px"><summary>Dibuka oleh pengawas (${log.length})</summary>
            <ul style="margin:6px 0 0;padding-left:18px">${log.map(l => `<li>${esc(l.full_name)} (${esc(VIEWER_ROLE_LABEL[l.role_type] ?? l.role_type)}) — ${fmt(l.viewed_at)}</li>`).join('')}</ul>
        </details>` : '';

    box.innerHTML = `
        <h4 style="margin:0 0 6px">Pembaca Kasus</h4>
        ${isOversight ? `<p class="hint" style="margin:0;font-size:12px">Anda membaca kasus ini sebagai Waka Kesiswaan.
            Pembukaan ini dicatat dan dapat dilihat oleh pembuat dan penangan kasus.</p>` : `
        <p class="hint" style="margin:0 0 8px;font-size:12px">Selain pembuat, penangan, dan Waka Kesiswaan, kasus ini hanya dapat dibaca oleh orang yang Anda tandai.
            Orang yang ditandai hanya membaca. Orang tua dan siswa hanya melihat status kasus, nama penangan, dan komentar yang ditandai terlihat; judul dan deskripsi kasus tidak.</p>`}
        ${bisaTandai ? `${viewers.length ? `<ul style="list-style:none;margin:0 0 8px;padding:0;font-size:13px">${baris}</ul>` : '<p class="hint" style="margin:0 0 8px">Belum ada yang ditandai.</p>'}` : ''}
        ${bisaTandai ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="${ctx.prefix}-tag-select" class="input" style="flex:1;min-width:180px"><option value="">Memuat kandidat…</option></select>
            <button type="button" class="btn btn-primary btn-sm" id="${ctx.prefix}-tag-btn" disabled>Tandai</button>
        </div>` : ''}
        <p id="${ctx.prefix}-tag-msg" style="font-size:12px;margin:6px 0 0;min-height:16px"></p>
        ${logHtml}`;
    box.style.display = 'block';
    if (!bisaTandai) return;

    const sel = kEl(ctx, 'tag-select'), btn = kEl(ctx, 'tag-btn'), msg = kEl(ctx, 'tag-msg');
    const tampil = (teks, galat) => { msg.style.color = galat ? 'var(--color-danger)' : 'var(--color-success)'; msg.textContent = teks; };
    const sudah = new Set(viewers.map(v => v.user_id));
    try {
        const kand = kandSemua.filter(c => !sudah.has(c.user_id));
        if (!isCurrent()) return;
        // Dikelompokkan per hubungan dengan kasus (Wali Kelas, Guru Wali, … Staf lain) agar daftar panjang tetap mudah dipindai.
        const kelompok = new Map();
        for (const c of kand) { if (!kelompok.has(c.relation_label)) kelompok.set(c.relation_label, []); kelompok.get(c.relation_label).push(c); }
        sel.innerHTML = kand.length
            ? '<option value="">Pilih orang yang ditandai…</option>' + [...kelompok].map(([lbl, arr]) =>
                `<optgroup label="${esc(lbl)}">${arr.map(c => `<option value="${c.user_id}">${esc(c.full_name)}</option>`).join('')}</optgroup>`).join('')
            : '<option value="">Tidak ada kandidat lagi</option>';
    } catch (err) {
        if (!isCurrent()) return;
        sel.innerHTML = '<option value="">Gagal memuat kandidat</option>';
        tampil(fe(err), true);
    }
    sel.addEventListener('change', () => { btn.disabled = !sel.value; });
    btn.addEventListener('click', async () => {
        if (!sel.value) return;
        btn.disabled = true; sel.disabled = true;
        try {
            await addCaseViewer(kasus.case_id, sel.value);
            if (!isCurrent()) return;
            await renderKasusViewers(kasus, ctx, seq);
            tampil('Ditandai. Yang bersangkutan menerima pemberitahuan singkat tanpa isi kasus.', false);
        } catch (err) {
            if (!isCurrent()) return;
            sel.disabled = false; btn.disabled = false;
            tampil(fe(err, 's'), true);
        }
    });
    box.querySelectorAll('[data-cabut]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
            await removeCaseViewer(kasus.case_id, b.dataset.cabut);
            if (!isCurrent()) return;
            await renderKasusViewers(kasus, ctx, seq);
        } catch (err) {
            if (!isCurrent()) return;
            b.disabled = false;
            tampil(fe(err, 's'), true);
        }
    }));
}

// Selaras dengan fn_validate_escalation; DUDI bukan penerima eskalasi internal.
const INTERNAL_CASE_ROLES = ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS','WAKASEK'];   // Kepsek dikeluarkan (18 Okt 2026)

async function renderKasusActions(kasus, ctx = kasusCtxDefault, seq = ctx.detailSeq) {
    const isCurrent = () => ctx.currentId === kasus.case_id && ctx.detailSeq === seq;
    if (!isCurrent()) return;
    const actionsEl     = kEl(ctx, 'actions');
    const escalateBlock = kEl(ctx, 'escalate-block');
    const statusBlock   = kEl(ctx, 'status-block');
    const audienceBlock = kEl(ctx, 'audience-block');
    const closeBtn      = kEl(ctx, 'close-btn');
    const escalateTo    = kEl(ctx, 'escalate-to');
    const statusSel     = kEl(ctx, 'new-status');

    const isHandler = kasus.current_handler_user_id === currentUser.user_id;
    // Kasus CLOSED hanya dapat dibuka kembali oleh Waka Kesiswaan (ke Pemantauan, bercatatan); Kepala Sekolah dikeluarkan dari Pembinaan Siswa.
    const bisaBukaKembali = kasus.status === 'CLOSED' && (currentUser.role_type === 'WAKA_KESISWAAN' || currentUser.role_type === 'WAKASEK');
    const commentBlock = kEl(ctx, 'comment-block');
    if (kasus.status === 'CLOSED' && !bisaBukaKembali) {
        actionsEl.style.display = 'none';
        return;
    }
    if (!isHandler && !bisaBukaKembali) {
        actionsEl.style.display = 'none';
        return;
    }
    if (commentBlock) commentBlock.style.display = bisaBukaKembali ? 'none' : '';

    actionsEl.style.display = 'none';

    // ── Eskalasi: kandidat dari fn_get_escalation_candidates ──
    const isInternal = INTERNAL_CASE_ROLES.includes(currentUser.role_type);
    if (isInternal && !bisaBukaKembali) {
        escalateTo.innerHTML = '<option value="">Memuat…</option>';
        escalateBlock.style.display = 'block';
        const warnEl = kEl(ctx, 'escalate-warn');
        if (warnEl) warnEl.style.display = 'none';
        try {
            const candidates = (await getEscalationCandidates(kasus.case_id))
                .filter(c => INTERNAL_CASE_ROLES.includes(c.role_type));
            if (!isCurrent()) return;
            if (!candidates.length) {
                escalateTo.innerHTML = '<option value="">Tidak ada kandidat tersedia</option>';
            } else {
                escalateTo.innerHTML = candidates.map(c =>
                    `<option value="${c.user_id}">${esc(c.full_name)} — ${esc(c.relation_label)}</option>`
                ).join('');
            }
        } catch {
            if (!isCurrent()) return;
            escalateTo.innerHTML = '<option value="">Gagal memuat kandidat</option>';
        }
    } else {
        escalateBlock.style.display = 'none';
    }

    // ── Status change ──
    const statusControls = kEl(ctx, 'status-change-controls') ?? statusBlock;
    // Maju bebas; mundur hanya satu langkah (wajib catatan); kasus CLOSED dibuka kembali ke Pemantauan (wajib catatan).
    const nextStatuses = bisaBukaKembali ? [] : (STATUS_AFTER_CURRENT[kasus.status] ?? []);
    const mundurKe = STATUS_BACK_ONE[kasus.status];
    const opsiStatus = bisaBukaKembali
        ? [`<option value="MONITORING" data-wajib-catatan="1">Buka kembali (ke ${esc(CASE_STATUS_LABEL.MONITORING)}) — catatan wajib</option>`]
        : [...nextStatuses.map(s => `<option value="${s}">${esc(CASE_STATUS_LABEL[s])}</option>`),
           ...(mundurKe ? [`<option value="${mundurKe}" data-wajib-catatan="1">↩ Mundur ke ${esc(CASE_STATUS_LABEL[mundurKe])} — catatan wajib</option>`] : [])];
    if ((isHandler || bisaBukaKembali) && opsiStatus.length) {
        statusSel.innerHTML = opsiStatus.join('');
        statusControls.style.display = 'block';
    } else {
        statusControls.style.display = 'none';
    }
    if (statusControls !== statusBlock) statusBlock.style.display = 'block';

    // Close: hanya penangan
    const canClose = !bisaBukaKembali && isHandler;
    closeBtn.style.display = canClose ? 'inline-flex' : 'none';

    // ── Bagikan Kasus (hanya internal) ──
    if (isInternal && !bisaBukaKembali) {
        audienceBlock.innerHTML = `
            <h4 style="margin:0 0 8px">Bagikan Kasus</h4>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                <button id="${ctx.prefix}-share-student-btn" class="btn btn-sm ${kasus.is_shared_to_student ? 'btn-danger-outline' : 'btn-primary'}">
                    ${kasus.is_shared_to_student ? 'Tarik dari Siswa' : 'Bagikan ke Siswa'}
                </button>
                ${kasus.is_shared_to_student ? '<span style="font-size:12px;color:var(--color-success)">✓ Sudah dibagikan ke siswa</span>' : ''}
                <button id="${ctx.prefix}-share-parent-btn" class="btn btn-sm ${kasus.is_shared_to_parent ? 'btn-danger-outline' : 'btn-primary'}">
                    ${kasus.is_shared_to_parent ? 'Tarik dari Orang Tua' : 'Bagikan ke Orang Tua'}
                </button>
                ${kasus.is_shared_to_parent ? '<span style="font-size:12px;color:var(--color-success)">✓ Sudah dibagikan ke orang tua</span>' : ''}
            </div>
            <p id="${ctx.prefix}-audience-msg" style="font-size:12px;margin:6px 0 0;min-height:16px"></p>
        `;
        audienceBlock.style.display = 'block';

        const shareStudentBtn = kEl(ctx, 'share-student-btn');
        const shareParentBtn  = kEl(ctx, 'share-parent-btn');
        const audienceMsgEl   = kEl(ctx, 'audience-msg');

        shareStudentBtn.addEventListener('click', async () => {
            shareStudentBtn.disabled = true;
            try {
                if (kasus.is_shared_to_student) {
                    await unshareCoachingCaseFromStudent(kasus.case_id, currentUser.user_id, currentUser.school_id);
                    audienceMsgEl.style.color = 'var(--color-success)'; audienceMsgEl.textContent = 'Akses siswa dicabut.';
                } else {
                    await shareCoachingCaseToStudent(kasus.case_id, currentUser.user_id, currentUser.school_id);
                    audienceMsgEl.style.color = 'var(--color-success)'; audienceMsgEl.textContent = 'Dibagikan ke siswa.';
                }
                if (!isCurrent()) return;
                await refreshKasusDetail(ctx);
            } catch (err) {
                if (!isCurrent()) return;
                audienceMsgEl.style.color = 'var(--color-danger)'; audienceMsgEl.textContent = fe(err, 's');
                shareStudentBtn.disabled = false;
            }
        });

        shareParentBtn.addEventListener('click', async () => {
            shareParentBtn.disabled = true;
            try {
                if (kasus.is_shared_to_parent) {
                    await unshareCoachingCaseFromParent(kasus.case_id, currentUser.user_id, currentUser.school_id);
                    audienceMsgEl.style.color = 'var(--color-success)'; audienceMsgEl.textContent = 'Akses orang tua dicabut.';
                } else {
                    await shareCoachingCaseToParent(kasus.case_id, currentUser.user_id, currentUser.school_id);
                    audienceMsgEl.style.color = 'var(--color-success)'; audienceMsgEl.textContent = 'Dibagikan ke orang tua.';
                }
                if (!isCurrent()) return;
                await refreshKasusDetail(ctx);
            } catch (err) {
                if (!isCurrent()) return;
                audienceMsgEl.style.color = 'var(--color-danger)'; audienceMsgEl.textContent = fe(err, 's');
                shareParentBtn.disabled = false;
            }
        });
    } else {
        audienceBlock.style.display = 'none';
    }

    // ── Wire buttons (replace listeners by cloning) ──
    const newCommentBtn = replaceEl(`${ctx.prefix}-comment-submit-btn`);
    const newEscBtn     = replaceEl(`${ctx.prefix}-escalate-btn`);
    const newStatusBtn  = replaceEl(`${ctx.prefix}-status-btn`);
    const newCloseBtn   = replaceEl(`${ctx.prefix}-close-btn`);
    for (const [button, label] of [[newCommentBtn, 'Kirim Komentar'], [newEscBtn, 'Teruskan'],
        [newStatusBtn, 'Ubah Status'], [newCloseBtn, 'Tutup Kasus']]) {
        button.disabled = false;
        button.textContent = label;
    }
    newCloseBtn.dataset.confirming = '';

    if (!kEl(ctx, 'comment-visible-wrap')) {
        const wrap = document.createElement('div');
        wrap.id = `${ctx.prefix}-comment-visible-wrap`;
        wrap.style.cssText = 'margin:6px 0;font-size:13px';
        wrap.innerHTML = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="${ctx.prefix}-comment-visible"> Tampilkan ke siswa &amp; orang tua</label>`;
        newCommentBtn.parentNode.insertBefore(wrap, newCommentBtn);
    }
    newCommentBtn.addEventListener('click', async () => {
        const text  = kEl(ctx, 'comment-text').value.trim();
        const msgEl = kEl(ctx, 'comment-msg');
        const isVisibleToStudent = kEl(ctx, 'comment-visible')?.checked ?? false;
        if (!text) { msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = 'Catatan tidak boleh kosong.'; return; }
        newCommentBtn.disabled = true; newCommentBtn.textContent = 'Mengirim…';
        try {
            await addCoachingNote({ caseId: kasus.case_id, text, authorUserId: currentUser.user_id, schoolId: currentUser.school_id, isVisibleToStudent });
            if (!isCurrent()) return;
            kEl(ctx, 'comment-text').value = '';
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Catatan dikirim.';
            newCommentBtn.disabled = false; newCommentBtn.textContent = 'Kirim Komentar';
            await refreshKasusDetail(ctx);
        } catch (err) {
            if (!isCurrent()) return;
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
            newCommentBtn.disabled = false; newCommentBtn.textContent = 'Kirim Komentar';
        }
    });

    newEscBtn.addEventListener('click', async () => {
        const selEl = kEl(ctx, 'escalate-to');
        const to    = selEl.value;
        const note  = kEl(ctx, 'escalate-note').value.trim();
        const msgEl = kEl(ctx, 'escalate-msg');
        if (!to) { msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = 'Pilih penerima eskalasi.'; return; }
        newEscBtn.disabled = true; newEscBtn.textContent = 'Meneruskan…';
        try {
            await escalateCoachingCase({
                caseId:           kasus.case_id,
                newHandlerUserId: to,
                note,
                authorUserId:     currentUser.user_id,
                schoolId:         currentUser.school_id,
            });
            if (!isCurrent()) return;
            const recipName = selEl.options[selEl.selectedIndex]?.text ?? to;
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = `Diteruskan ke ${esc(recipName)}.`;
            newEscBtn.disabled = false; newEscBtn.textContent = 'Teruskan';
            await refreshKasusDetail(ctx);
        } catch (err) {
            if (!isCurrent()) return;
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
            newEscBtn.disabled = false; newEscBtn.textContent = 'Teruskan';
        }
    });

    newStatusBtn.addEventListener('click', async () => {
        const newSt = kEl(ctx, 'new-status').value;
        const note  = kEl(ctx, 'status-note').value.trim();
        const msgEl = kEl(ctx, 'status-msg');
        const wajibCatatan = kEl(ctx, 'new-status').selectedOptions[0]?.dataset.wajibCatatan === '1';
        if (wajibCatatan && note.length < 5) {
            msgEl.style.color = 'var(--color-danger)';
            msgEl.textContent = 'Mundur atau membuka kembali kasus wajib disertai catatan (minimal 5 karakter).';
            return;
        }
        newStatusBtn.disabled = true; newStatusBtn.textContent = 'Menyimpan…';
        try {
            await changeCoachingCaseStatus({ caseId: kasus.case_id, previousStatus: kasus.status, newStatus: newSt, note, authorUserId: currentUser.user_id, schoolId: currentUser.school_id });
            if (!isCurrent()) return;
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = `Status diubah ke ${CASE_STATUS_LABEL[newSt]}.`;
            await refreshKasusDetail(ctx);
        } catch (err) {
            if (!isCurrent()) return;
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newStatusBtn.disabled = false; newStatusBtn.textContent = 'Ubah Status';
        }
    });

    newCloseBtn.addEventListener('click', async () => {
        const note  = kEl(ctx, 'status-note').value.trim();
        const msgEl = kEl(ctx, 'status-msg');
        if (newCloseBtn.dataset.confirming !== 'yes') {
            newCloseBtn.dataset.confirming = 'yes';
            msgEl.style.color   = 'var(--color-warning)';
            msgEl.textContent   = 'Kasus yang ditutup hanya dapat dibuka kembali oleh Waka Kesiswaan atau Kepala Sekolah. Klik "Tutup Kasus" sekali lagi untuk konfirmasi.';
            newCloseBtn.textContent = 'Konfirmasi Tutup';
            setTimeout(() => {
                if (isCurrent() && newCloseBtn.dataset.confirming === 'yes') {
                    newCloseBtn.dataset.confirming = '';
                    newCloseBtn.textContent = 'Tutup Kasus';
                    msgEl.textContent = '';
                }
            }, 6000);
            return;
        }
        newCloseBtn.dataset.confirming = '';
        newCloseBtn.disabled = true; newCloseBtn.textContent = 'Menutup…';
        try {
            await closeCoachingCase({ caseId: kasus.case_id, note, authorUserId: currentUser.user_id, previousStatus: kasus.status, schoolId: currentUser.school_id });
            if (!isCurrent()) return;
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Kasus berhasil ditutup.';
            await refreshKasusDetail(ctx);
        } catch (err) {
            if (!isCurrent()) return;
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newCloseBtn.disabled = false; newCloseBtn.textContent = 'Tutup Kasus';
        }
    });
    actionsEl.style.display = 'block';
}

function replaceEl(id) {
    const old = document.getElementById(id);
    if (!old) return { addEventListener: () => {}, style: {}, dataset: {}, disabled: false };
    const neu = old.cloneNode(true);
    old.parentNode.replaceChild(neu, old);
    return neu;
}

async function refreshKasusDetail(ctx = kasusCtxDefault) {
    const caseId = ctx.currentId;
    if (!caseId) return;
    const seq = ++ctx.detailSeq;
    kEl(ctx, 'actions').style.display = 'none';
    try {
        const [kasus, events] = await Promise.all([getCase(caseId), getCoachingCaseEvents(caseId)]);
        if (ctx.currentId !== caseId || ctx.detailSeq !== seq) return;
        renderKasusDetail(kasus, ctx);
        renderKasusEvents(events, ctx);
        // Panel pembaca ikut digambar ulang dengan nomor urut baru (seperti openKasusDetail); tanpa ini tombol Tandai/Cabut memegang nomor lama
        // setelah komentar, eskalasi, atau ubah status, sehingga daftar tidak diperbarui lagi (temuan uji nyata 18 Okt 2026).
        renderKasusViewers(kasus, ctx, seq);
        await renderKasusActions(kasus, ctx, seq);
        if (ctx.currentId !== caseId || ctx.detailSeq !== seq) return;
        const idx = ctx.allCases.findIndex(c => c.case_id === caseId);
        if (idx >= 0) ctx.allCases[idx] = {
            ...ctx.allCases[idx],
            status:                  kasus.status,
            current_handler_user_id: kasus.current_handler_user_id,
            handler:                 kasus.handler,
        };
        if (ctx === _wkKasusCtxRef) await renderWkCount();
    } catch (err) {
        if (ctx.currentId !== caseId || ctx.detailSeq !== seq) return;
        console.error('[kasus] refresh error', err);
        showKasusDetailError(err, ctx);
    }
}

// ─── Download: Template & Rekap Pembinaan ────────────────────
function wireKasusDownloadButtons(ctx) {
    const prefix     = ctx.prefix;
    const templateBtn = document.getElementById(`${prefix}-template-btn`);
    const templateMenu = document.getElementById(`${prefix}-template-menu`);
    const rekapBtn   = document.getElementById(`${prefix}-rekap-btn`);

    if (templateBtn && templateMenu) {
        templateBtn.addEventListener('click', e => {
            e.stopPropagation();
            const open = templateMenu.style.display !== 'none';
            document.querySelectorAll('[id$="-template-menu"]').forEach(m => { m.style.display = 'none'; });
            if (!open) templateMenu.style.display = 'block';
        });
    }

    if (rekapBtn) {
        rekapBtn.addEventListener('click', async () => {
            const origText = rekapBtn.textContent;
            rekapBtn.disabled    = true;
            rekapBtn.textContent = 'Memuat…';
            try {
                const status = document.getElementById(`${prefix}-filter-status`)?.value ?? '';
                const track  = document.getElementById(`${prefix}-filter-track`)?.value  ?? '';
                const cases  = await getCasesAll({
                    ...ctx.extraQuery,
                    status, track,
                });
                const parts = [];
                if (status) parts.push(CASE_STATUS_LABEL[status] ?? status);
                if (track)  parts.push(CASE_TRACK_LABEL[track]  ?? track);
                const filterDesc = parts.length ? parts.join(', ') : 'Semua Kasus';
                generateRekapPembinaan(cases, filterDesc);
            } catch (err) {
                alert('Gagal mengunduh rekap: ' + (err?.message ?? err));
            } finally {
                rekapBtn.disabled    = false;
                rekapBtn.textContent = origText;
            }
        });
    }
}

function generateRekapPembinaan(cases, filterDesc) {
    function escH(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    const schoolName = document.querySelector('[data-brand="school-name"]')?.textContent?.trim() || 'Sekolah';
    const tgl = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const rows = cases.map((c, i) => `
        <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${escH(c.student?.full_name ?? '—')}</td>
            <td>${escH(c.student?.nis ?? '—')}</td>
            <td>${escH(c.title)}</td>
            <td>${escH(CASE_TRACK_LABEL[c.track] ?? c.track)}</td>
            <td>${escH(CASE_STATUS_LABEL[c.status] ?? c.status)}</td>
            <td>${escH(c.handler?.full_name ?? '—')}</td>
            <td>${fmt(c.created_at)}</td>
        </tr>`).join('');

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
         xmlns:w="urn:schemas-microsoft-com:office:word"
         xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 2cm; }
  h1   { font-size: 14pt; text-align: center; margin-bottom: 4px; }
  p    { margin: 2px 0; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #000; padding: 4px 6px; font-size: 9pt; vertical-align: top; }
  th { background: #e0e0e0; font-weight: bold; text-align: center; }
  .footer { margin-top: 16px; font-size: 10pt; }
</style>
</head>
<body>
<h1>${escH(schoolName)}</h1>
<h1>REKAP PEMBINAAN SISWA</h1>
<p style="text-align:center">Filter: ${escH(filterDesc)}</p>
<p style="text-align:center">Dicetak: ${escH(tgl)}</p>
<table>
  <thead><tr>
    <th>No</th><th>Nama Siswa</th><th>NIS</th><th>Judul Kasus</th>
    <th>Track</th><th>Status</th><th>Handler Saat Ini</th><th>Tgl Dibuat</th>
  </tr></thead>
  <tbody>${rows || '<tr><td colspan="8" style="text-align:center">Tidak ada data</td></tr>'}</tbody>
</table>
<p class="footer">Jumlah kasus: <strong>${cases.length}</strong></p>
</body></html>`;

    const blob = new Blob([html], { type: 'application/msword' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rekap-pembinaan-${new Date().toISOString().slice(0, 10)}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Tutup semua dropdown template saat klik di luar
document.addEventListener('click', () => {
    document.querySelectorAll('[id$="-template-menu"]').forEach(m => { m.style.display = 'none'; });
});

// ─── Start ───────────────────────────────────────────────────
init().catch(err => {
    console.error('[init]', err);
    const el = document.getElementById('loading');
    if (el) {
        el.textContent = 'Gagal memuat. Silakan refresh halaman.';
        el.style.color = 'red';
    }
});
