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
// DG-04 / DG-08: nomor urut pemuatan modal absensi dan rekap. Hasil pemuatan lama yang selesai terlambat diabaikan
// (dideklarasikan di sini agar sudah ada sebelum fungsi apa pun dijalankan).
let _attModalSeq = 0;
let _attModalFokusAsal = null;
let _guruRecapSeq = 0;
let jabatan      = [];
let isTeacher    = false;  // hanya GURU & WALI_KELAS yang mengajar
let myStudents         = [];     // for observation selector
let isBroadObserver    = false;  // BK/Waka/Kepsek — bisa cari siswa seluruh sekolah
let _waliKasusCtx = null;
let _bkKasusCtx   = null;
let _kpKasusCtx   = null;
let _wkKasusCtx   = null;
let _ksDisahkanPage = 0;

let kaprodiAllStudents = [];     // PKL + aktif di prodi Kaprodi, untuk batas pencarian
let _studentPoolInit   = false;  // guard: ensureStudentPool hanya load sekali
let kpStudents      = [];  // kaprodi PKL students
let kpAktifStudents = [];  // kaprodi siswa AKTIF (kelas)
let kpProgramId     = null;
let kpDudiList      = [];
let kpTabInitialized = false;
let kpTabLoading      = false;
let kpRecapSeq        = 0;
let kpClsRecapSeq     = 0;

const DIMENSION_LABELS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };

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
// B-06 (keputusan Romo 18 Okt 2026): forum hanya dapat dipakai saat tersambung ke internet; saat luring pesan galat harus jelas dan meyakinkan bahwa isian tidak hilang.
function galatJaringanForum(err) {
    const m = String(err?.message ?? '').toLowerCase();
    const luring = (typeof navigator !== 'undefined' && navigator.onLine === false) || m.includes('failed to fetch') || m.includes('network') || m.includes('load failed');
    return luring ? 'Tidak ada koneksi internet. Tulisan Anda tidak hilang; coba kirim lagi setelah tersambung.' : null;
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
    waka_kesiswaan: 'Kesiswaan', waka_kurikulum: 'Kurikulum', waka_humas: 'Humas',
    kepsek: 'Kepsek',
    kasus: 'Pembinaan', jurnal: 'Jurnal', observasi: 'Catatan', forum: 'Forum',
    perangkat_ajar: 'Perangkat', piket: 'Piket',
};
const TAB_ICON = {
    guru: 'ti-home', wali_kelas: 'ti-users', bk: 'ti-heart-handshake', kaprodi: 'ti-building',
    waka_kesiswaan: 'ti-school', waka_kurikulum: 'ti-book', waka_humas: 'ti-briefcase',
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
            case 'guru':        await initGuruTab(); break;
            case 'wali_kelas':  await initWaliTab(); break;
            case 'bk':          await initBkTab(); break;
            case 'kaprodi':     await initKaprodiTab(); break;
            case 'waka_kesiswaan': await initWakaKesiswaanTab(); break;
            case 'waka_kurikulum': await initWakaKurTab(); break;
            case 'waka_humas':  await initWakaHumasTab(); break;
            case 'kepsek':      await initKepsekTab(); break;

            case 'kasus':       await initKasusTab(); break;
            case 'piket':       await initPiketTab(); break;
            case 'jurnal':      await initJurnalTab(); break;
            case 'observasi':   await initObsTab(); break;
            case 'forum':       await initForumTab(); break;
        }
    } catch (err) {
        console.error('[loadTabContent]', key, err);
        const activePanel = document.querySelector('.tab-panel.active .page-body');
        if (activePanel) {
            activePanel.innerHTML = '<p style="padding:1.5rem; color:red">Gagal memuat tab ini. Silakan coba lagi atau refresh halaman.</p>';
        }
    }
}

// ─── TAB GURU ────────────────────────────────────────────────

let _guruTabInit     = false;
let _guruRekapRows      = [];
let _guruRekapPage      = 0;
let _guruRekapDateStart = null;
let _guruRekapDateEnd   = null;
let _guruRekapClassName = null;
async function initGuruTab() {
    const dateEl = document.getElementById('sched-date');
    if (!dateEl.value) dateEl.value = localDateStr();

    if (!_guruTabInit) {
        _guruTabInit = true;
        const recapBtn = document.getElementById('guru-recap-btn');
        recapBtn.addEventListener('click', async () => {
            const content = document.getElementById('guru-recap-content');
            if (recapBtn.textContent.trim() === 'Sembunyikan') {
                content.style.display = 'none';
                recapBtn.textContent = 'Tampilkan';
                return;
            }
            content.style.display = '';
            await loadGuruRecap();
        });
        // Default rentang: awal bulan ini s/d hari ini
        const today = localDateStr();
        const firstOfMonth = today.slice(0, 8) + '01';
        document.getElementById('guru-recap-start').value = firstOfMonth;
        document.getElementById('guru-recap-end').value   = today;
        await initGuruRekapDropdown();

        // Toggle hari / minggu — auto-load saat switch
        document.querySelectorAll('.sched-view-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const isWeek = btn.dataset.view === 'minggu';
                document.getElementById('sched-view-hari-panel').style.display  = isWeek ? 'none' : 'block';
                document.getElementById('sched-view-minggu-panel').style.display = isWeek ? 'block' : 'none';
                if (isWeek) await loadWeekSchedule();
                else await loadSchedule();
            });
        });
    }

    await loadSchedule();
    await initObsForm();
}

async function initGuruRekapDropdown() {
    const sel = document.getElementById('guru-recap-class');
    try {
        const classes = await getMyClasses(currentUser.user_id, config.current_academic_year, config.current_semester);

        if (classes.length === 0) {
            sel.innerHTML = '<option value="">Tidak ada kelas</option>';
            return;
        }
        sel.innerHTML = '<option value="">— Pilih Kelas —</option>' +
            classes.map(c => `<option value="${c.class_id}">${esc(c.name)}</option>`).join('');
    } catch {
        sel.innerHTML = '<option value="">Gagal memuat kelas</option>';
    }
}

function renderGuruRekapPage() {
    const container = document.getElementById('guru-rekap-accordion');
    if (!container) return;

    container.innerHTML = [..._guruRekapRows]
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
        .map((s, idx) => {
            const tot   = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
            const pct   = tot > 0 ? Math.round(s.HADIR / tot * 100) : null;
            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--color-border,#e5e7eb)">
                <span style="min-width:24px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
                <span style="flex:1;font-size:13px">${esc(s.full_name)}</span>
                <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500;flex-shrink:0">
                    <span style="color:var(--color-success)">${s.HADIR}H</span>
                    <span style="color:var(--color-warning,#f59e0b)">${s.IZIN}I</span>
                    <span style="color:var(--color-primary)">${s.SAKIT}S</span>
                    <span style="color:var(--color-danger)">${s.ALPA}A</span>
                    <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                </span>
            </div>`;
        }).join('');
}

async function loadGuruRecap() {
    const seq       = ++_guruRecapSeq;
    const classId   = document.getElementById('guru-recap-class').value;
    const dateStart = document.getElementById('guru-recap-start').value;
    const dateEnd   = document.getElementById('guru-recap-end').value;
    const content   = document.getElementById('guru-recap-content');
    const className = document.getElementById('guru-recap-class').selectedOptions[0]?.text ?? '';

    if (!classId) { content.innerHTML = '<p class="hint">Pilih kelas terlebih dahulu.</p>'; return; }

    content.innerHTML = '<p class="hint">Memuat rekap…</p>';
    try {
        const enrolled = await getEnrolledStudents(classId, config.current_academic_year, config.current_semester);
        if (seq !== _guruRecapSeq) return;
        if (enrolled.length === 0) {
            content.innerHTML = '<p class="hint">Belum ada siswa aktif di kelas ini untuk tahun ajaran ini.</p>';
            return;
        }
        const rows = await getAttendanceSummaryByStudents(classId, config.current_academic_year, dateStart || null, dateEnd || null, currentUser.user_id);
        if (seq !== _guruRecapSeq) return;

        _guruRekapRows      = rows;
        _guruRekapPage      = 0;
        _guruRekapDateStart = dateStart || null;
        _guruRekapDateEnd   = dateEnd   || null;
        _guruRekapClassName = className;

        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0">
                    ${esc(className)} · ${rows.length} siswa · akumulasi ${dateStart || '—'} s/d ${dateEnd || '—'}
                </p>
                <button class="btn btn-secondary btn-sm" id="guru-recap-export">Unduh Excel</button>
            </div>
            <div id="guru-rekap-accordion"></div>`;

        document.getElementById('guru-recap-export').addEventListener('click', async () => {
            const btn   = document.getElementById('guru-recap-export');
            const start = document.getElementById('guru-recap-start').value;
            const end   = document.getElementById('guru-recap-end').value;
            btn.disabled = true;
            btn.textContent = 'Menyiapkan…';

            try {
                const PRIO        = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };
                const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };

                const classes = await getMyClasses(currentUser.user_id, config.current_academic_year, config.current_semester);
                if (!classes.length) return;

                const wb = XLSX.utils.book_new();
                const usedNames = new Set();

                await Promise.all(classes.map(async (cls) => {
                    const [summary, detail] = await Promise.all([
                        getAttendanceSummaryByStudents(cls.class_id, config.current_academic_year, null, null, currentUser.user_id),
                        getClassAttendanceByDate(cls.class_id, config.current_academic_year, null, null, currentUser.user_id),
                    ]);

                    const dateSet = new Set(detail.map(r => r.session_date));
                    const dates   = [...dateSet].sort();

                    const pivot = {};
                    for (const r of detail) {
                        if (!pivot[r.student_id]) pivot[r.student_id] = {};
                        const prev = pivot[r.student_id][r.session_date];
                        if (prev === undefined || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
                            pivot[r.student_id][r.session_date] = r.status;
                    }

                    const roster   = [...summary].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
                    const header   = ['No', 'Nama', ...dates, 'Persentase'];
                    const dataRows = roster.map((s, idx) => {
                        const tot = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                        const pct = tot > 0 ? Math.round(s.HADIR / tot * 100) + '%' : '—';
                        return [idx + 1, s.full_name, ...dates.map(d => STATUS_HURUF[pivot[s.student_id]?.[d]] ?? ''), pct];
                    });

                    // Nama sheet = nama kelas, maks 31 karakter, unik
                    let sheetName = (cls.name ?? cls.class_id).slice(0, 31);
                    for (let n = 2; usedNames.has(sheetName.toLowerCase()); n++) {
                        const suffix = ` (${n})`;
                        sheetName = (cls.name ?? cls.class_id).slice(0, 31 - suffix.length) + suffix;
                    }
                    usedNames.add(sheetName.toLowerCase());

                    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...dataRows]), sheetName);
                }));

                XLSX.writeFile(wb, `kehadiran_semua_kelas_${start || 'awal'}_${end || 'akhir'}.xlsx`);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Unduh Excel';
            }
        });

        renderGuruRekapPage();
        document.getElementById('guru-recap-btn').textContent = 'Sembunyikan';
    } catch (err) {
        if (seq !== _guruRecapSeq) return;
        content.innerHTML = `<div class="status-err">Gagal memuat rekap. ${esc(fe(err))}</div>`;
    }
}

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDayLabel(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function isConsecutive(endTime, startTime) {
    const toMin = t => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m; };
    return toMin(startTime) - toMin(endTime) <= 40;
}

function mergeConsecutiveSessions(sessions) {
    const sorted = [...sessions].sort((a, b) => a.session_start.localeCompare(b.session_start));
    const merged = [];
    for (const s of sorted) {
        const last = merged[merged.length - 1];
        const lastSubject = (last?.subject_label ?? '').trim().toLocaleLowerCase();
        const currentSubject = (s.subject_label ?? '').trim().toLocaleLowerCase();
        const sameBlock = last
            && last.class?.class_id === s.class?.class_id
            && lastSubject === currentSubject
            && isConsecutive(last.merged_end, s.session_start);
        if (sameBlock) {
            last.merged_end = s.session_end;
            last.schedule_ids.push(s.schedule_id);
        } else {
            merged.push({
                ...s,
                merged_start: s.session_start,
                merged_end:   s.session_end,
                schedule_ids: [s.schedule_id],
            });
        }
    }
    return merged;
}

function renderScheduleRows(rows, contentEl, date) {
    const today     = localDateStr();
    const isToday   = date === today;
    const label     = fmtDayLabel(date);
    const sesiCount = rows.length;
    const now       = new Date();
    const nowTime   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    const mergedRows = mergeConsecutiveSessions(rows);
    const tableHtml = sesiCount === 0
        ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal mengajar pada tanggal ini.</p>'
        : `<div class="table-wrapper">
           <table class="table">
               <thead><tr><th>Jam</th><th>Mapel</th><th>Kelas</th><th>Kehadiran</th></tr></thead>
               <tbody>
               ${mergedRows.map(r => {
                   const ended = date < today || (isToday && nowTime > r.merged_end);
                   return `
                   <tr>
                       <td>${fmtTime(r.merged_start)} – ${fmtTime(r.merged_end)}</td>
                       <td>${esc(r.subject_label ?? '—')}</td>
                       <td>${esc(r.class?.name ?? '—')}</td>
                       <td>
                           <button class="btn btn-secondary btn-xs att-open-btn"
                               data-schedule="${r.schedule_ids[0]}"
                               data-schedule-ids='${JSON.stringify(r.schedule_ids)}'
                               data-class="${r.class?.class_id}"
                               data-classname="${esc(r.class?.name ?? '')}"
                               data-ispast="${ended}"
                               ${ended ? 'disabled title="Sesi sudah berakhir — tidak dapat diubah"' : 'style="background:var(--color-primary);color:#fff;border-color:var(--color-primary)"'}>
                               ${ended ? 'Sesi Berakhir' : 'Input Kehadiran'}
                           </button>
                       </td>
                   </tr>`;
               }).join('')}
               </tbody>
           </table>
           </div>`;

    contentEl.innerHTML = `
        <details class="att-accordion" ${isToday || sesiCount > 0 ? 'open' : ''}>
            <summary class="att-accordion-summary">
                <span class="att-acc-name">${esc(label)}</span>
                <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
            </summary>
            <div style="padding:0 12px 8px">${tableHtml}</div>
        </details>`;

    contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
        btn.addEventListener('click', () => openAttModal(btn));
    });
    document.getElementById('att-modal-close').onclick = closeAttModal;
    document.getElementById('att-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeAttModal();
    });
    const attModalEl = document.getElementById('att-modal');
    if (!attModalEl._escTerpasang) {
        attModalEl._escTerpasang = true;
        attModalEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeAttModal(); });
    }
}

function openAttModal(btn) {
    const seq      = ++_attModalSeq;
    _attModalFokusAsal = document.activeElement;
    const modal    = document.getElementById('att-modal');
    const isPast   = btn.dataset.ispast === 'true';
    document.getElementById('att-modal-title').textContent =
        isPast ? `Koreksi Kehadiran — ${btn.dataset.classname}` : `Kehadiran — ${btn.dataset.classname}`;
    document.getElementById('att-modal-body').innerHTML =
        (isPast ? '<p class="hint" style="background:var(--color-bg-alt);padding:8px 10px;border-radius:6px;margin-bottom:12px">Data kehadiran sebelumnya sudah ditampilkan. Ubah jika perlu lalu klik Simpan.</p>' : '') +
        '<p class="hint">Memuat daftar siswa…</p>';
    sipPrepareOpen(modal);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('att-modal-close')?.focus();   // DG-13: fokus pindah ke dalam dialog
    loadAttModalContent(btn.dataset.schedule, btn.dataset.class, btn.dataset.classname, seq);
}

let _attSavedFlag = false;

function closeAttModal(saved = false) {
    _attModalSeq++;   // DG-04: batalkan pemuatan yang masih berjalan
    sipCloseOverlay(document.getElementById('att-modal'));
    document.body.style.overflow = '';
    // DG-13: kembalikan fokus ke tombol yang membuka modal
    try { _attModalFokusAsal?.focus?.(); } catch (_) { /* elemen sudah tidak ada */ }
    _attModalFokusAsal = null;
    // Refresh rekap guru jika baru saja menyimpan absensi dan rekap sedang tampil
    if (saved) {
        const content = document.getElementById('guru-recap-content');
        if (content && content.style.display !== 'none' && _guruRekapRows.length) {
            loadGuruRecap().catch(() => {});
        }
    }
}

async function loadSchedule() {
    const date      = document.getElementById('sched-date').value;
    const contentEl = document.getElementById('sched-content');
    const cacheKey  = `sched-${currentUser.user_id}-${date}`;

    // Tampilkan cache dulu — halaman langsung berisi data walau offline
    const cached = LC.get(cacheKey);
    if (cached) {
        renderScheduleRows(cached, contentEl, date);
    } else {
        contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    }

    try {
        const rows = await getMyScheduleForDate(currentUser.user_id, date);
        LC.set(cacheKey, rows);
        renderScheduleRows(rows, contentEl, date);
    } catch (err) {
        if (!cached) {
            contentEl.innerHTML = `<div class="status-err">Gagal memuat data. ${esc(fe(err))}</div>`;
        }
        // Jika ada cache, biarkan data lama tetap tampil — jangan overwrite dengan error
    }
}

async function loadWeekSchedule() {
    const contentEl = document.getElementById('sched-week-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal minggu ini…</p>';

    // Hitung Senin s/d Sabtu minggu ini (Sabtu hanya tampil bila guru punya jadwal hari itu)
    const today = new Date();
    const dow   = today.getDay(); // 0=Min,1=Sen,...,6=Sab
    const diff  = dow === 0 ? -6 : 1 - dow; // hari ke Senin
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);

    const days = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return localDateStr(d);
    });

    try {
        const results = await Promise.all(
            days.map(d => getMyScheduleForDate(currentUser.user_id, d)
                .then(rows => ({ date: d, rows, error: null }))
                .catch(error => ({ date: d, rows: [], error }))
            )
        );

        if (results.every(r => r.error)) {
            contentEl.innerHTML = `<div class="status-err">Gagal memuat jadwal minggu ini. ${esc(fe(results[0].error))}</div>`;
            return;
        }

        const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const todayStr  = localDateStr();
        contentEl.innerHTML = results.map((r, idx) => {
            // Sabtu opsional: tampil hanya bila ada jadwal (sekolah 5 hari tidak melihat baris kosong).
            if (idx === 5 && !r.error && r.rows.length === 0) return '';
            const dayLabel  = `${DAY_NAMES[idx]}, ${fmtDayLabel(r.date).split(',')[1]?.trim() ?? r.date}`;
            const isToday   = r.date === todayStr;
            const mergedSessions = r.error ? [] : mergeConsecutiveSessions(r.rows);
            const sesiCount = mergedSessions.length;
            const tableHtml = r.error
                ? `<div class="status-err">Gagal memuat jadwal hari ini. ${esc(fe(r.error))}</div>`
                : sesiCount === 0
                ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal</p>'
                : `<div class="table-wrapper">
                   <table class="table">
                       <thead><tr><th>Jam</th><th>Kelas</th></tr></thead>
                       <tbody>${mergedSessions.map(s => `
                           <tr>
                               <td>${fmtTime(s.merged_start)} – ${fmtTime(s.merged_end)}</td>
                               <td>${esc(s.class?.name ?? '—')}</td>
                           </tr>`).join('')}
                       </tbody>
                   </table>
                   </div>`;

            return `
                <details class="att-accordion">
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">${esc(dayLabel)}</span>
                        <span class="att-acc-names">${r.error ? 'gagal memuat' : sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
                    </summary>
                    <div style="padding:0 12px 8px">${tableHtml}</div>
                </details>`;
        }).join('');

        // Single-expand: tutup semua accordion lain saat satu dibuka
        contentEl.querySelectorAll('details.att-accordion').forEach(det => {
            det.addEventListener('toggle', () => {
                if (det.open) {
                    contentEl.querySelectorAll('details.att-accordion').forEach(other => {
                        if (other !== det) other.removeAttribute('open');
                    });
                }
            });
        });

        contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
            btn.addEventListener('click', () => openAttModal(btn));
        });
    } catch (err) {
        contentEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
    }
}

async function loadAttModalContent(scheduleId, classId, className, seq) {
    const panel = document.getElementById('att-modal-body');

    try {
        const [students, existing] = await Promise.all([
            getEnrolledStudents(classId, config.current_academic_year, config.current_semester),
            getAttendanceForSession(scheduleId),
        ]);
        if (seq !== _attModalSeq) return;   // DG-04: modal sudah ditutup atau diganti sesi lain

        if (students.length === 0) {
            panel.innerHTML = '<p class="hint">Tidak ada siswa terdaftar di kelas ini.</p>';
            return;
        }

        const statuses = ['HADIR','IZIN','SAKIT','ALPA'];
        const statusLabel = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa' };

        function renderStudentRow(s) {
            const cur      = existing.get(s.student_id)?.status ?? 'HADIR';
            const curNotes = existing.get(s.student_id)?.notes  ?? '';
            const radios   = statuses.map(st => `
                <label class="att-radio-label">
                    <input type="radio" name="att_${scheduleId}_${s.student_id}"
                           value="${st}" ${cur === st ? 'checked' : ''}
                           onchange="document.getElementById('notes_${scheduleId}_${s.student_id}').style.display=this.value==='IZIN'?'block':'none'">
                    ${statusLabel[st]}
                </label>`).join('');
            return `
                <div class="att-row">
                    <div class="att-name">
                        ${esc(s.full_name)}
                    </div>
                    <div class="att-radio-group">${radios}</div>
                    <input type="text" id="notes_${scheduleId}_${s.student_id}"
                           class="input att-notes-input"
                           placeholder="Alasan izin (opsional)…"
                           value="${esc(curNotes)}"
                           style="display:${cur === 'IZIN' ? 'block' : 'none'}; margin-top:4px; width:100%; font-size:0.85em">
                </div>`;
        }

        // Carousel per-5-siswa
        const CHUNK = 5;
        const chunks = [];
        for (let i = 0; i < students.length; i += CHUNK)
            chunks.push(students.slice(i, i + CHUNK));

        const slidesHtml = chunks.map(group => `
            <div class="att-carousel-slide">${group.map(renderStudentRow).join('')}</div>`).join('');

        const lastChunkEnd = students.length;
        panel.innerHTML = `
            <div class="att-carousel-nav">
                <button class="att-prev" aria-label="Sebelumnya">&#8592;</button>
                <div class="att-carousel-counter">
                    Siswa <span class="att-cur-range">1–${Math.min(CHUNK, students.length)}</span> / ${students.length}
                </div>
                <button class="att-next" aria-label="Berikutnya">&#8594;</button>
            </div>
            <div class="att-carousel-track-wrap">
                <div class="att-carousel-track">${slidesHtml}</div>
            </div>
            <div class="att-save-btn">
                <button class="btn btn-success btn-sm att-save" data-schedule="${scheduleId}" data-count="${students.length}">
                    Simpan Kehadiran (${students.length} siswa)
                </button>
                <span class="status-msg" id="att-status-${scheduleId}" style="display:none; margin-left:8px"></span>
            </div>`;

        // Carousel logic
        let cur = 0;
        const track    = panel.querySelector('.att-carousel-track');
        const curRange = panel.querySelector('.att-cur-range');
        const prevBtn  = panel.querySelector('.att-prev');
        const nextBtn  = panel.querySelector('.att-next');

        function goTo(idx) {
            cur = Math.max(0, Math.min(chunks.length - 1, idx));
            track.style.transform = `translateX(-${cur * 100}%)`;
            const start = cur * CHUNK + 1;
            const end   = Math.min(start + CHUNK - 1, students.length);
            curRange.textContent = `${start}–${end}`;
            prevBtn.disabled = cur === 0;
            nextBtn.disabled = cur === chunks.length - 1;
        }
        goTo(0);
        prevBtn.addEventListener('click', () => goTo(cur - 1));
        nextBtn.addEventListener('click', () => goTo(cur + 1));

        // Touch swipe
        let tx0 = null;
        track.parentElement.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; }, { passive: true });
        track.parentElement.addEventListener('touchend', e => {
            if (tx0 === null) return;
            const dx = e.changedTouches[0].clientX - tx0;
            if (Math.abs(dx) > 40) goTo(dx < 0 ? cur + 1 : cur - 1);
            tx0 = null;
        }, { passive: true });

        const scheduleIds = (() => { try { return JSON.parse(document.querySelector(`.att-open-btn[data-schedule="${scheduleId}"]`)?.dataset?.scheduleIds ?? 'null'); } catch { return null; } })() ?? [scheduleId];
        panel.querySelector('.att-save').addEventListener('click', () => saveAttendance(scheduleIds, students));
    } catch (err) {
        if (seq !== _attModalSeq) return;
        panel.innerHTML = `<div class="status-err">Gagal memuat data. ${esc(fe(err))}</div>`;
    }
}

async function saveAttendance(scheduleIds, students) {
    const scheduleId = Array.isArray(scheduleIds) ? scheduleIds[0] : scheduleIds;
    const allIds     = Array.isArray(scheduleIds) ? scheduleIds : [scheduleIds];
    const saveBtn  = document.querySelector(`.att-save[data-schedule="${scheduleId}"]`);
    const statusEl = document.getElementById(`att-status-${scheduleId}`);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan…';
    statusEl.style.display = 'none';

    try {
        const records = students.map(s => {
            const checked = document.querySelector(`input[name="att_${scheduleId}_${s.student_id}"]:checked`);
            const status  = checked?.value ?? 'HADIR';
            const notesEl = document.getElementById(`notes_${scheduleId}_${s.student_id}`);
            const notes   = status === 'IZIN' ? (notesEl?.value.trim() || null) : null;
            return { student_id: s.student_id, status, source: 'TEACHER_DECLARED', notes };
        });

        const sessionDate = document.getElementById('sched-date').value;
        const results = await Promise.all(allIds.map(sid => saveAttendanceBatch({
            idempotency_key: crypto.randomUUID(),
            schedule_id:     sid,
            submitted_by:    currentUser.user_id,
            session_date:    sessionDate,
            records,
        })));

        const anyQueued = results.some(r => r.status === 'queued');
        const anyFailed = results.find(r => r.status !== 'synced' && r.status !== 'queued');
        if (anyFailed) {
            statusEl.textContent = `✗ ${anyFailed.error}`;
            statusEl.className   = 'status-msg status-err';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
        } else if (anyQueued) {
            statusEl.textContent = `⏳ Tersimpan di perangkat — menunggu sinkron (${records.length} siswa × ${allIds.length} sesi)`;
            statusEl.className   = 'status-msg status-warn';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
            setTimeout(() => closeAttModal(true), 1800);
        } else {
            statusEl.textContent = `✓ Tersimpan — ${records.length} siswa × ${allIds.length} sesi`;
            statusEl.className   = 'status-msg status-ok';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
            setTimeout(() => closeAttModal(true), 1200);
        }
    } catch (err) {
        statusEl.textContent = `✗ ${fe(err, 's')}`;
        statusEl.className   = 'status-msg status-err';
        statusEl.style.display = 'inline-block';
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = `Simpan Kehadiran (${students.length} siswa)`;
    }
}

// ── Sinkronisasi offline: indikator + flush ───────────────────

async function updateSyncBanner() {
    let el = document.getElementById('sync-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sync-banner';
        el.className = 'sync-banner';
        document.body.appendChild(el);
    }
    let n = 0, ditolak = 0;
    try { n = await pendingCount(); } catch (_) { n = 0; }
    try { ditolak = await rejectedCount(); } catch (_) { ditolak = 0; }
    if (n > 0) {
        el.textContent = navigator.onLine
            ? `⏳ ${n} item menunggu sinkron — menyinkronkan…`
            : `⏳ ${n} item tersimpan di perangkat — akan terkirim saat online`;
        el.style.display = 'block';
    } else if (ditolak > 0) {
        el.textContent = `⚠️ ${ditolak} item ditolak server dan ditahan di perangkat ini. Hubungi admin sekolah; data belum terkirim.`;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function showSessionExpiredBanner() {
    let el = document.getElementById('sync-banner');
    if (!el) return;
    el.style.background  = 'var(--color-danger-bg,#fef2f2)';
    el.style.color       = 'var(--color-danger,#dc2626)';
    el.style.borderColor = 'var(--color-danger,#dc2626)';
    el.textContent       = '⚠️ Sesi habis — antrian offline ditahan. Login ulang untuk melanjutkan sinkronisasi.';
    el.style.display     = 'block';
}

async function runFlush() {
    try {
        const { synced, remaining, sessionExpired } = await flushPending();
        if (synced > 0) console.log(`[offline] ${synced} item tersinkron`);
        if (sessionExpired) { showSessionExpiredBanner(); return remaining; }
        await updateSyncBanner();
        // Pengiriman otomatis (jaringan pulih) juga harus menyegarkan panel antrean dan daftar kasus; tanpa ini "Menunggu dikirim" bertahan
        // sampai halaman dimuat ulang walau kasusnya sudah ada di server (temuan uji nyata 18 Okt 2026).
        if (synced > 0) segarkanKasusSetelahKirim().catch(() => {});
        return remaining;
    } catch (e) { console.warn('[offline] flush gagal:', e); }
}

// ── Student pool (dipakai Observasi & Kasus) ─────────────────

async function ensureStudentPool() {
    if (_studentPoolInit) return;
    isBroadObserver = jabatan.some(j => ['bk', 'waka_kesiswaan', 'kepsek'].includes(j));
    const stuCacheKey = `mystudents-${currentUser.user_id}`;
    myStudents = LC.get(stuCacheKey) ?? [];
    try {
        const fresh = await getMyStudents(
            currentUser.user_id,
            config.current_academic_year,
            config.current_semester
        );
        myStudents = fresh;
        LC.set(stuCacheKey, fresh);
        _studentPoolInit = true;
    } catch (err) {
        _studentPoolInit = false;
        throw err;
    }
}

// ── Observasi ─────────────────────────────────────────────────

let _obsFormInit = false;
const OBS_HISTORY_PAGE_SIZE = 100;
let _obsHistoryRows  = [];
let _obsHistoryTotal = 0;
let _obsHistoryBusy  = false;

async function initObsForm() {
    if (_obsFormInit) return;
    try {
        await ensureStudentPool();
    } catch (err) {
        const statusEl = document.getElementById('obs-status');
        const submitBtn = document.getElementById('obs-submit');
        const studentSelEl = document.getElementById('obs-student-select');
        if (studentSelEl) studentSelEl.disabled = true;
        if (submitBtn) submitBtn.disabled = true;
        if (statusEl) {
            statusEl.textContent = `Gagal memuat daftar siswa. ${fe(err)} Buka ulang tab untuk mencoba lagi.`;
            statusEl.className = 'status-msg status-err';
            statusEl.style.display = 'block';
        }
        return;
    }
    _obsFormInit = true;

    const hiddenEl      = document.getElementById('obs-student-id');
    const studentSelEl  = document.getElementById('obs-student-select');
    const form          = document.getElementById('obs-form');
    const submitBtn     = document.getElementById('obs-submit');
    const statusEl      = document.getElementById('obs-status');
    const obsContentEl  = document.getElementById('obs-content');
    const obsCharCountEl= document.getElementById('obs-char-count');
    const visSelect     = document.getElementById('obs-visibility');
    studentSelEl.disabled = false;
    submitBtn.disabled = false;

    // --- Class filter → student dropdown ---
    const classFilterEl = document.getElementById('obs-class-filter');

    const classNames = [...new Set(
        myStudents.map(s => s.class_name).filter(Boolean)
    )].sort();
    classNames.forEach(cn => {
        const opt = document.createElement('option');
        opt.value = cn;
        opt.textContent = cn;
        classFilterEl.appendChild(opt);
    });

    function populateStudentSelect(className) {
        studentSelEl.innerHTML = '<option value="">— Pilih siswa —</option>';
        hiddenEl.value = '';
        // A-10: "Semua Kelas" (nilai kosong) menampilkan seluruh siswa yang diajar.
        myStudents
            .filter(s => !className || s.class_name === className)
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.student_id;
                opt.textContent = `${s.full_name}${s.nis ? '  (' + s.nis + ')' : ''}`;
                studentSelEl.appendChild(opt);
            });
    }

    classFilterEl.addEventListener('change', () => populateStudentSelect(classFilterEl.value));
    populateStudentSelect(classFilterEl.value);   // A-10: daftar siswa langsung terisi (Semua Kelas)

    studentSelEl.addEventListener('change', () => {
        hiddenEl.value = studentSelEl.value;
    });

    obsContentEl.addEventListener('input', () => {
        obsCharCountEl.textContent = obsContentEl.value.length;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!hiddenEl.value) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--color-danger)';
            statusEl.textContent = 'Pilih siswa terlebih dahulu.';
            return;
        }
        if (obsContentEl.value.trim().length < 10) {   // A-12: sama dengan aturan server
            statusEl.className = 'status-msg status-err';
            statusEl.style.display = 'block';
            statusEl.textContent = '✗ Catatan minimal 10 karakter.';
            return;
        }
        const visibility = visSelect.value;
        statusEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            const r = await insertObservation({
                authorId:   currentUser.user_id,
                studentId:  hiddenEl.value,
                dimension:  document.getElementById('obs-dimension').value,
                sentiment:  document.getElementById('obs-sentiment').value,
                visibility,
                content:    document.getElementById('obs-content').value,
            });
            if (r.status === 'error') throw new Error(r.error);
            statusEl.textContent = r.status === 'queued'
                ? '⏳ Catatan disimpan lokal — akan dikirim saat online.'
                : '✓ Catatan berhasil disimpan.';
            statusEl.className = 'status-msg status-ok';
            statusEl.style.display = 'block';
            form.reset();
            obsCharCountEl.textContent = '0';   // A-11
            hiddenEl.value = '';
            studentSelEl.value = '';
            if (r.status === 'synced') await loadObsHistory();
        } catch (err) {
            statusEl.textContent   = `✗ ${fe(err, 's')}`;
            statusEl.className     = 'status-msg status-err';
            statusEl.style.display = 'block';
        } finally {
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Simpan Catatan';
        }
    });
}

async function initObsTab() {
    await initObsForm();
    const moreBtn = document.getElementById('obs-history-more');
    if (moreBtn && moreBtn.dataset.wired !== '1') {
        moreBtn.dataset.wired = '1';
        moreBtn.addEventListener('click', loadMoreObsHistory);
    }
    await loadObsHistory();
}

function setObsHistoryNotice(listEl, message, className = 'status-warn') {
    listEl.querySelector('.obs-history-notice')?.remove();
    if (!message) return;
    const notice = document.createElement('div');
    notice.className = `obs-history-notice ${className}`;
    notice.style.cssText = 'margin-bottom:10px;padding:8px 10px';
    notice.textContent = message;
    listEl.prepend(notice);
}

function updateObsHistoryMore() {
    const btn = document.getElementById('obs-history-more');
    if (!btn) return;
    const hasMore = _obsHistoryRows.length < _obsHistoryTotal;
    btn.style.display = hasMore ? 'inline-block' : 'none';
    btn.disabled = _obsHistoryBusy;
}

async function loadObsHistory() {
    const listEl   = document.getElementById('obs-history-list');
    const cacheKey = `obs-history-${currentUser.user_id}`;
    const cached   = LC.get(cacheKey);
    const cachedState = Array.isArray(cached) ? { rows: cached, total: cached.length } : cached;
    if (cachedState) {
        _obsHistoryRows  = cachedState.rows ?? [];
        _obsHistoryTotal = Number(cachedState.total ?? _obsHistoryRows.length);
        renderObsHistory(_obsHistoryRows, listEl);
        setObsHistoryNotice(listEl, 'Menampilkan cache lokal. Memeriksa pembaruan…');
        updateObsHistoryMore();
    }
    else listEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const result = await getMyObservations(currentUser.user_id, {
            limit: OBS_HISTORY_PAGE_SIZE,
            offset: 0,
        });
        _obsHistoryRows  = result.rows;
        _obsHistoryTotal = result.total;
        LC.set(cacheKey, result);
        renderObsHistory(_obsHistoryRows, listEl);
        setObsHistoryNotice(listEl, '');
        updateObsHistoryMore();
    } catch (err) {
        if (!cachedState) {
            listEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
        } else {
            setObsHistoryNotice(listEl, `Gagal memperbarui riwayat. Data yang tampil mungkin belum terbaru. ${fe(err)}`);
        }
        updateObsHistoryMore();
    }
}

async function loadMoreObsHistory() {
    if (_obsHistoryBusy || _obsHistoryRows.length >= _obsHistoryTotal) return;
    const listEl = document.getElementById('obs-history-list');
    const btn = document.getElementById('obs-history-more');
    _obsHistoryBusy = true;
    if (btn) btn.textContent = 'Memuat…';
    updateObsHistoryMore();
    try {
        const result = await getMyObservations(currentUser.user_id, {
            limit: OBS_HISTORY_PAGE_SIZE,
            offset: _obsHistoryRows.length,
        });
        _obsHistoryRows  = [..._obsHistoryRows, ...result.rows];
        _obsHistoryTotal = result.total;
        LC.set(`obs-history-${currentUser.user_id}`, {
            rows: _obsHistoryRows,
            total: _obsHistoryTotal,
        });
        renderObsHistory(_obsHistoryRows, listEl);
        updateObsHistoryMore();
    } catch (err) {
        setObsHistoryNotice(listEl, `Gagal memuat catatan berikutnya. ${fe(err)}`, 'status-err');
    } finally {
        _obsHistoryBusy = false;
        if (btn) btn.textContent = 'Muat lebih banyak';
        updateObsHistoryMore();
    }
}

const DIMENSION_LABELS_OBS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };
const SENTIMENT_LABELS = { POSITIF:'Positif', NETRAL:'Netral', NEGATIF:'Perlu Perhatian' };
const SENTIMENT_COLOR  = { POSITIF:'var(--color-success)', NETRAL:'var(--color-text-muted)', NEGATIF:'var(--color-danger)' };

const OBS_VIS_LABEL = {
    SISWA_SAJA:    '🎓 Siswa saja',
    ORTU_SAJA:     '👨‍👩‍👧 Orang Tua saja',
    SISWA_DAN_ORTU:'👨‍👩‍👦 Siswa & Orang Tua',
    PRIVATE:       '🔒 Catatan pribadi',
};

function renderObsHistory(rows, listEl) {
    if (!rows.length) {
        listEl.innerHTML = '<p class="hint">Belum ada catatan yang ditulis.</p>';
        return;
    }
    listEl.innerHTML = rows.map(r => {
        const nama      = r.student?.full_name ?? '—';
        const nis       = r.student?.nis ? ` · ${r.student.nis}` : '';
        const dim       = DIMENSION_LABELS_OBS[r.dimension] ?? r.dimension;
        const sent      = SENTIMENT_LABELS[r.sentiment]  ?? r.sentiment;
        const sentColor = SENTIMENT_COLOR[r.sentiment] ?? 'inherit';
        const vis      = r.visibility ?? 'SISWA_DAN_ORTU';
        const visLabel = OBS_VIS_LABEL[vis] ?? vis;
        const visColor  = 'var(--color-primary)';
        const isVoid    = !!r.is_void;
        const voidStyle = isVoid ? 'opacity:0.55;' : '';
        return `
        <div data-obs-id="${esc(r.observation_id)}" data-obs-vis="${esc(vis)}"
             data-student-id="${esc(r.student_id ?? '')}"
             data-author-id="${esc(r.author_user_id ?? '')}"
             data-student-name="${esc(r.student?.full_name ?? '')}"
             style="border-bottom:0.5px solid var(--color-border);padding:10px 0;font-size:13px;${voidStyle}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">
                <strong>${esc(nama)}<span style="font-weight:400;color:var(--color-text-muted)">${esc(nis)}</span></strong>
                <span style="font-size:11px;color:var(--color-text-muted)">${fmt(r.observed_at)}</span>
            </div>
            ${isVoid ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;color:var(--color-danger)">
                <span>⊘ ${r.voided_by && r.voided_by === r.author_user_id ? 'Dibatalkan oleh Anda' : 'Disembunyikan'}</span>
                ${r.void_reason ? `<span style="color:var(--color-text-muted)">— ${esc(r.void_reason)}</span>` : ''}
            </div>` : ''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center">
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--color-bg-alt)">${esc(dim)}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;color:${sentColor};background:var(--color-bg-alt)">${esc(sent)}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;color:${visColor};background:var(--color-bg-alt)">${visLabel}</span>
            </div>
            <p style="margin:0 0 6px;white-space:pre-wrap;color:var(--color-text)">${esc(r.content)}</p>
            ${isVoid ? '' : `<button type="button" class="btn btn-sm btn-danger-outline" data-void-obs="${esc(r.observation_id)}">Batalkan catatan</button>`}
        </div>`;
    }).join('');

    // B-04: penulis dapat membatalkan catatannya (disembunyikan dari siswa/orang tua, tidak dihapus). Dipasang sekali.
    if (!listEl._voidTerpasang) {
        listEl._voidTerpasang = true;
        listEl.addEventListener('click', async (e) => {
            // Alasan diisi di dalam halaman (bukan window.prompt yang memblokir tab dan sering ditutup peramban ponsel).
            const btn = e.target.closest('[data-void-obs]');
            if (btn) {
                const kartu = btn.closest('[data-obs-id]');
                if (!kartu || kartu.querySelector('.obs-void-form')) return;
                const f = document.createElement('div');
                f.className = 'obs-void-form';
                f.style.cssText = 'margin-top:8px';
                f.innerHTML = `<label style="font-size:12px;display:block;margin-bottom:4px">Alasan membatalkan (minimal 5 karakter). Catatan akan disembunyikan dari siswa dan orang tua.</label>
                    <input type="text" class="input obs-void-reason" maxlength="500" style="width:100%;max-width:420px">
                    <div style="margin-top:6px;display:flex;gap:6px"><button type="button" class="btn btn-sm btn-danger" data-void-confirm="${esc(btn.dataset.voidObs)}">Batalkan Catatan</button><button type="button" class="btn btn-sm btn-secondary" data-void-close>Tutup</button></div>
                    <div class="obs-void-msg" style="font-size:12px;margin-top:4px"></div>`;
                btn.after(f);
                btn.style.display = 'none';
                f.querySelector('input').focus();
                return;
            }
            const tutup = e.target.closest('[data-void-close]');
            if (tutup) {
                const kartu = tutup.closest('[data-obs-id]');
                kartu?.querySelector('.obs-void-form')?.remove();
                const awal = kartu?.querySelector('[data-void-obs]'); if (awal) awal.style.display = '';
                return;
            }
            const ok = e.target.closest('[data-void-confirm]');
            if (!ok) return;
            const form  = ok.closest('.obs-void-form');
            const msgEl = form.querySelector('.obs-void-msg');
            const alasan = form.querySelector('.obs-void-reason').value.trim();
            if (alasan.length < 5) { msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = 'Alasan minimal 5 karakter.'; return; }
            ok.disabled = true; msgEl.style.color = 'var(--color-text-muted)'; msgEl.textContent = 'Membatalkan…';
            try {
                // Batas waktu: permintaan yang macet tidak boleh mengunci tombol selamanya.
                await Promise.race([
                    voidObservation(ok.dataset.voidConfirm, alasan),
                    new Promise((_, tolak) => setTimeout(() => tolak(new Error('Permintaan terlalu lama. Periksa koneksi, lalu coba lagi.')), 20000)),
                ]);
                await loadObsHistory();
            } catch (err) {
                ok.disabled = false;
                msgEl.style.color = 'var(--color-danger)';
                msgEl.textContent = `Gagal membatalkan catatan. ${fe(err, 's')}`;
            }
        });
    }
}

// ─── TAB WALI KELAS ──────────────────────────────────────────

let _waliSummarySeq = 0;
let _waliRosterSeq = 0;

async function initWaliTab() {
    wireSimpleAccordion('wali-att-card');
    const classId = currentUser.wali_kelas_class_id;
    if (!classId) {
        document.getElementById('wali-kasus-list-content').innerHTML =
            '<p class="hint">Anda belum ditugaskan sebagai wali kelas.</p>';
        return;
    }

    const info = await getWaliKelasInfo(classId);
    document.getElementById('wali-class-title').textContent =
        `Kelas Walian — ${info?.name ?? ''}`;
    pasangNilaiRaporKelas(document.getElementById('tab-wali_kelas'), { esc, mode: 'wali', classId, className: info?.name ?? '', tahun: config?.current_academic_year, semester: config?.current_semester });

    const today    = localDateStr();
    const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
    document.getElementById('wali-date-start').value = monthAgo;
    document.getElementById('wali-date-end').value   = today;

    document.getElementById('wali-filter-btn').onclick = loadWaliSummary;

    document.getElementById('wali-recap-export').onclick = async () => {
        const btn = document.getElementById('wali-recap-export');
        btn.disabled = true;
        btn.textContent = 'Menyiapkan…';

        try {
            const classId      = currentUser.wali_kelas_class_id;
            const dateStart    = document.getElementById('wali-date-start').value || null;
            const dateEnd      = document.getElementById('wali-date-end').value || null;
            const academicYear = config.current_academic_year;

            const [students, detail] = await Promise.all([
                getWaliAttendanceSummary(classId, academicYear, dateStart, dateEnd, config.current_semester),
                getClassAttendanceByDate(classId, academicYear, dateStart, dateEnd, null),
            ]);

            // Tanggal unik urut asc
            const dateSet = new Set(detail.map(r => r.session_date));
            const dates   = [...dateSet].sort();

            // Pivot: student_id → tanggal → status (prioritas A>S>I>H)
            const PRIO = { ALPA: 0, SAKIT: 1, IZIN: 2, HADIR: 3 };
            const STATUS_HURUF = { HADIR: 'H', SAKIT: 'S', IZIN: 'I', ALPA: 'A' };
            const pivot = {};
            for (const r of detail) {
                if (!pivot[r.student_id]) pivot[r.student_id] = {};
                const prev = pivot[r.student_id][r.session_date];
                if (prev === undefined || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
                    pivot[r.student_id][r.session_date] = r.status;
            }

            // Siswa urut A-Z
            const roster = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

            const header   = ['No', 'Nama', ...dates, 'Persentase'];
            const dataRows = roster.map((s, idx) => {
                const tot = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                const pct = tot > 0 ? Math.round(s.HADIR / tot * 100) + '%' : '—';
                const dateCells = dates.map(d => STATUS_HURUF[pivot[s.student_id]?.[d]] ?? '');
                return [idx + 1, s.full_name, ...dateCells, pct];
            });

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...dataRows]), 'Rekap Kehadiran');

            const className = document.getElementById('wali-class-title')
                .textContent.replace('Kelas Walian — ', '').trim();
            XLSX.writeFile(wb, `rekap_wali_${className}_${dateStart ?? 'awal'}_${dateEnd ?? 'akhir'}.xlsx`);

        } catch (err) {
            alert('Gagal mengunduh: ' + fe(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Unduh Excel';
        }
    };

    await loadWaliSummary();
    await initWaliKasusSection();

    // Keterlambatan & izin keluar — default 30 hari terakhir
    document.getElementById('wali-late-date-start').value = monthAgo;
    document.getElementById('wali-late-date-end').value   = today;
    document.getElementById('wali-exit-date-start').value = monthAgo;
    document.getElementById('wali-exit-date-end').value   = today;

    document.getElementById('wali-late-filter-btn').onclick = loadWaliLate;
    document.getElementById('wali-exit-filter-btn').onclick = loadWaliExit;

    await Promise.all([loadWaliLate(), loadWaliExit()]);
}

async function loadWaliLate() {
    const classId   = currentUser.wali_kelas_class_id;
    const dateStart = document.getElementById('wali-late-date-start').value;
    const dateEnd   = document.getElementById('wali-late-date-end').value;
    const el        = document.getElementById('wali-late-content');
    if (!dateStart || !dateEnd) { el.innerHTML = '<p class="hint">Pilih rentang tanggal lalu klik Filter.</p>'; return; }
    el.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getWaliLateArrivals(classId, dateStart, dateEnd);
        if (!rows.length) { el.innerHTML = '<p class="hint">Tidak ada catatan keterlambatan pada rentang ini.</p>'; return; }
        el.innerHTML = `
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Jam Masuk</th><th>Keterangan</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => `<tr>
                    <td>${r.date}</td>
                    <td>${r.student_name}</td>
                    <td>${r.nis}</td>
                    <td>${r.arrival_time ?? '—'}</td>
                    <td>${r.reason || '—'}</td>
                </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        el.innerHTML = `<p class="hint error">Gagal memuat: ${fe(err)}</p>`;
    }
}

async function loadWaliExit() {
    const classId   = currentUser.wali_kelas_class_id;
    const dateStart = document.getElementById('wali-exit-date-start').value;
    const dateEnd   = document.getElementById('wali-exit-date-end').value;
    const el        = document.getElementById('wali-exit-content');
    if (!dateStart || !dateEnd) { el.innerHTML = '<p class="hint">Pilih rentang tanggal lalu klik Filter.</p>'; return; }
    el.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getWaliExits(classId, dateStart, dateEnd);
        if (!rows.length) { el.innerHTML = '<p class="hint">Tidak ada catatan izin keluar pada rentang ini.</p>'; return; }
        el.innerHTML = `
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Jam Keluar</th><th>Jam Kembali</th><th>Keterangan</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => `<tr>
                    <td>${r.date}</td>
                    <td>${r.student_name}</td>
                    <td>${r.nis}</td>
                    <td>${r.exit_time ?? '—'}</td>
                    <td>${r.return_time}</td>
                    <td>${r.reason || '—'}</td>
                </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        el.innerHTML = `<p class="hint error">Gagal memuat: ${fe(err)}</p>`;
    }
}

async function initWaliKasusSection() {
    const classId = currentUser.wali_kelas_class_id;
    const msgEl   = document.getElementById('wali-kasus-list-content');
    const seq = ++_waliRosterSeq;
    if (!_waliKasusCtx) {
        _waliKasusCtx = makeKasusCtx('wali-kasus', { studentIds: [] });
        document.getElementById('wali-kasus-back-btn')
            .addEventListener('click', () => showKasusList(_waliKasusCtx));
        wireKasusDownloadButtons(_waliKasusCtx);
        document.getElementById('wali-kasus-filter-btn')
            ?.addEventListener('click', () => initWaliKasusSection());
    }
    const ctx = _waliKasusCtx;
    ++ctx.listSeq;
    ctx.extraQuery.studentIds = [];
    ctx.allCases = [];
    ctx.offset = 0;
    ctx.hasMore = false;
    showKasusList(ctx);
    msgEl.innerHTML = '<p class="hint">Memuat siswa dan kasus…</p>';
    try {
        const enrolled   = await getWaliCoachingStudents(classId, config.current_academic_year);
        if (seq !== _waliRosterSeq) return;
        const studentIds = enrolled.map(s => s.student_id);
        ctx.extraQuery.studentIds = studentIds;
        if (!studentIds.length) {
            msgEl.innerHTML = '<p class="hint">Tidak ada siswa terdaftar di kelas ini.</p>';
            return;
        }
        await loadKasusList(false, ctx);
    } catch (err) {
        if (seq !== _waliRosterSeq) return;
        showKasusLoadError(err, ctx, () => initWaliKasusSection());
    }
}

async function loadWaliSummary() {
    const seq = ++_waliSummarySeq;
    const classId   = currentUser.wali_kelas_class_id;
    const academicYear = config.current_academic_year;
    const dateStart = document.getElementById('wali-date-start').value || null;
    const dateEnd   = document.getElementById('wali-date-end').value   || null;
    const container = document.getElementById('wali-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';

    try {
        const students = await getWaliAttendanceSummary(
            classId, academicYear, dateStart, dateEnd, config.current_semester
        );
        if (seq !== _waliSummarySeq) return;
        if (!students.length) {
            container.innerHTML = '<p class="hint">Belum ada siswa di kelas ini.</p>';
            return;
        }

        container.innerHTML = buildAttStatCards(students) + [...students]
            .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
            .map((s, idx) => {
                const tot   = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                const pct   = tot > 0 ? Math.round(s.HADIR / tot * 100) : null;
                const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--color-border,#e5e7eb)">
                    <span style="min-width:24px;font-size:11px;color:var(--color-text-muted);text-align:right;flex-shrink:0">${idx + 1}</span>
                    <span style="flex:1;font-size:13px">${esc(s.full_name)}</span>
                    <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500;flex-shrink:0">
                        <span style="color:var(--color-success)">${s.HADIR}H</span>
                        <span style="color:var(--color-warning,#f59e0b)">${s.IZIN}I</span>
                        <span style="color:var(--color-primary)">${s.SAKIT}S</span>
                        <span style="color:var(--color-danger)">${s.ALPA}A</span>
                        <span style="color:${color};font-weight:700;min-width:36px;text-align:right">${pct !== null ? pct + '%' : '—'}</span>
                    </span>
                </div>`;
            }).join('');

        document.getElementById('wali-recap-export').style.display = '';

    } catch (err) {
        if (seq !== _waliSummarySeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ─── TAB BK ──────────────────────────────────────────────────

async function initBkTab() {
    wireSimpleAccordion('bk-att-card');
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('bk-att-start').value = firstOfMonth;
    document.getElementById('bk-att-end').value   = today;
    document.getElementById('bk-att-filter-btn').onclick = loadBkAttendanceRecap;
    await loadBkAttendanceRecap();
    await initBkKasusSection();
}

async function initBkKasusSection() {
    if (!_bkKasusCtx) {
        _bkKasusCtx = makeKasusCtx('bk-kasus', {});
        document.getElementById('bk-kasus-back-btn')
            .addEventListener('click', () => showKasusList(_bkKasusCtx));
        wireKasusDownloadButtons(_bkKasusCtx);
        document.getElementById('bk-kasus-filter-btn')
            ?.addEventListener('click', () => loadKasusList(false, _bkKasusCtx));
    }
    await loadKasusList(false, _bkKasusCtx);
}

async function loadBkAttendanceRecap() {
    const dateStart = document.getElementById('bk-att-start').value || null;
    const dateEnd   = document.getElementById('bk-att-end').value   || null;
    const container = document.getElementById('bk-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const [programs, rows] = await Promise.all([
            getPrograms(),
            getAttendanceRecapPerClass(dateStart, dateEnd),
        ]);

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada data kehadiran.</p>';
            return;
        }

        const classMap = new Map(rows.map(r => [r.class_id, r]));
        const progMap  = new Map();
        for (const prog of programs) progMap.set(prog.program_id, { ...prog, classes: [] });

        const { data: classProgData, error: cpErr } = await supabase
            .from('classes')
            .select('class_id, program_id')
            .in('class_id', rows.map(r => r.class_id));
        if (cpErr) throw cpErr;

        for (const cp of classProgData ?? []) {
            const prog = progMap.get(cp.program_id);
            const cls  = classMap.get(cp.class_id);
            if (prog && cls) prog.classes.push(cls);
        }

        const activeProgs = [...progMap.values()].filter(p => p.classes.length > 0);

        const html = activeProgs.map(prog => {
            const classAccordions = prog.classes
                .sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(r => {
                    const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                    const pctH = tot > 0 ? Math.round(r.HADIR       / tot * 100) : 0;
                    const pctI = tot > 0 ? Math.round(r.IZIN        / tot * 100) : 0;
                    const pctS = tot > 0 ? Math.round(r.SAKIT       / tot * 100) : 0;
                    const pctA = tot > 0 ? Math.round(r.ALPA / tot * 100) : 0;
                    const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                    return `
                    <details class="att-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                        <summary class="att-accordion-summary">
                            <span class="att-acc-name">${esc(r.name)}</span>
                            <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                                <span style="color:${colH}">${pctH}%H</span>
                                <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                                <span style="color:var(--color-primary)">${pctS}%S</span>
                                <span style="color:var(--color-danger)">${pctA}%A</span>
                            </span>
                        </summary>
                        <div data-class-id="${esc(r.class_id)}"
                             data-date-start="${esc(dateStart ?? '')}"
                             data-date-end="${esc(dateEnd ?? '')}"
                             style="padding:4px 0">
                            <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                        </div>
                    </details>`;
                }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px">
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">${esc(prog.name)}</span>
                    <span class="att-acc-names">${prog.classes.length} kelas</span>
                </summary>
                <div style="padding:4px 0">${classAccordions}</div>
            </details>`;
        }).join('');

        container.innerHTML = html;

        container.querySelectorAll('details.wz-accordion-inner').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';
                const classId = body.dataset.classId;
                const dStart  = body.dataset.dateStart || null;
                const dEnd    = body.dataset.dateEnd   || null;
                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span class="att-acc-name">
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('div');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid = stuDet.dataset.studentId;
                            const ds  = stuDet.dataset.dateStart || null;
                            const de  = stuDet.dataset.dateEnd   || null;
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                                return;
                            }
                            try {
                                 const sessions = await getStudentAttendanceSessions(sid, ds, de, null, config.current_academic_year);
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA:  'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                const grouped = [];
                                const seen = new Map();
                                for (const s of sessions) {
                                    const key = `${s.schedule.session_date}|${s.schedule.subject_label ?? ''}|${s.schedule.teacher?.full_name ?? ''}`;
                                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                                }
                                const hadirCount    = grouped.filter(s => s.status === 'HADIR').length;
                                const absenSessions = grouped.filter(s => s.status !== 'HADIR');
                                const hadirInfo = hadirCount > 0
                                    ? `<div style="padding:6px 24px;font-size:12px;color:var(--color-text-muted);
                                          border-top:0.5px solid var(--color-border)">✓ ${hadirCount} sesi hadir</div>`
                                    : '';
                                const absenHtml = absenSessions.length
                                    ? absenSessions.map(s => `
                                        <div style="display:flex;align-items:center;gap:8px;
                                            padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                            <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                                ${esc(s.schedule.session_date)}
                                            </span>
                                            <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                                ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                            </span>
                                            <span style="font-size:11px;font-weight:600;
                                                color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                                ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                            </span>
                                        </div>`).join('')
                                    : `<div style="padding:6px 24px;font-size:12px;color:var(--color-text-muted);
                                          border-top:0.5px solid var(--color-border)">Tidak ada ketidakhadiran.</div>`;
                                sBody.innerHTML = absenHtml + hadirInfo;
                            } catch(err) {
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });
                } catch (err) {
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ─── TAB WAKA KESISWAAN ──────────────────────────────────────

async function initWakaKesiswaanTab() {
    wireSimpleAccordion('wk-att-card');
    wireSimpleAccordion('wk-late-card');
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('wk-att-start').value = firstOfMonth;
    document.getElementById('wk-att-end').value   = today;
    document.getElementById('wk-att-filter-btn').onclick = loadWkAttendanceRecap;

    document.getElementById('wk-late-start').value = firstOfMonth;
    document.getElementById('wk-late-end').value   = today;
    document.getElementById('wk-late-filter-btn').onclick = loadWkLateRecap;

    await loadWkAttendanceRecap();
    await loadWkLateRecap();
    await initWakaKesiswaanKasusSection();
}

async function renderWkCount() {
    const rekapEl = document.getElementById('wk-kasus-count-rekap');
    if (!rekapEl) return;
    try {
        const counts = await getCoachingCasesCount();
        const lbl    = 'font-size:11px;color:var(--color-text-muted);margin-top:2px';
        rekapEl.style.display = '';
        rekapEl.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-primary)">${counts.OPEN ?? 0}</div>
                    <div style="${lbl}">Terbuka</div>
                </div>
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-warning,#f59e0b)">${counts.UNDER_REVIEW ?? 0}</div>
                    <div style="${lbl}">Ditinjau</div>
                </div>
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-danger)">${counts.INTERVENTION ?? 0}</div>
                    <div style="${lbl}">Intervensi</div>
                </div>
                <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
                    <div style="font-size:20px;font-weight:500;color:var(--color-success)">${counts.MONITORING ?? 0}</div>
                    <div style="${lbl}">Monitoring</div>
                </div>
            </div>`;
    } catch (err) {
        console.error('[renderWkCount]', err);
        rekapEl.style.display = '';
        rekapEl.innerHTML = `<div class="alert alert-danger">Gagal memuat rekap kasus: ${esc(fe(err))}</div>`;
    }
}

async function initWakaKesiswaanKasusSection() {
    if (!_wkKasusCtx) {
        _wkKasusCtx = makeKasusCtx('wk-kasus', {});
        document.getElementById('wk-kasus-back-btn')
            .addEventListener('click', () => showKasusList(_wkKasusCtx));
        wireKasusDownloadButtons(_wkKasusCtx);
        document.getElementById('wk-kasus-filter-btn')
            ?.addEventListener('click', () => loadKasusList(false, _wkKasusCtx));
    }
    await loadKasusList(false, _wkKasusCtx);
    await renderWkCount();
}

let _wkAttendanceRequestSeq = 0;
let _wkLateRequestSeq = 0;

function buildAttStatCards(rows, getTot = r => r.HADIR + r.IZIN + r.SAKIT + r.ALPA) {
    const tot  = rows.reduce((s,r) => s + getTot(r), 0);
    const h    = rows.reduce((s,r) => s + r.HADIR,       0);
    const i    = rows.reduce((s,r) => s + r.IZIN,        0);
    const sk   = rows.reduce((s,r) => s + r.SAKIT,       0);
    const a    = rows.reduce((s,r) => s + r.ALPA, 0);
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
            <div style="font-size:20px;font-weight:500;color:${colI}">${pctI}%</div>
            <div style="${lbl}">Izin</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colS}">${pctS}%</div>
            <div style="${lbl}">Sakit</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colA}">${pctA}%</div>
            <div style="${lbl}">Alpa</div>
        </div>
    </div>`;
}

async function loadWkAttendanceRecap() {
    const requestSeq = ++_wkAttendanceRequestSeq;
    const dateStart = document.getElementById('wk-att-start').value || null;
    const dateEnd   = document.getElementById('wk-att-end').value   || null;
    const container = document.getElementById('wk-att-recap');
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const [programs, rows] = await Promise.all([
            getPrograms(),
            getAttendanceRecapPerClass(dateStart, dateEnd),
        ]);
        if (requestSeq !== _wkAttendanceRequestSeq) return;

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada data kehadiran.</p>';
            return;
        }

        // Kelompokkan kelas per program
        const classMap = new Map(rows.map(r => [r.class_id, r]));
        const progMap  = new Map();
        for (const prog of programs) {
            progMap.set(prog.program_id, { ...prog, classes: [] });
        }

        // Ambil class → program mapping
        const { data: classProgData, error: cpErr } = await supabase
            .from('classes')
            .select('class_id, program_id')
            .in('class_id', rows.map(r => r.class_id));
        if (cpErr) throw cpErr;

        for (const cp of classProgData ?? []) {
            const prog = progMap.get(cp.program_id);
            const cls  = classMap.get(cp.class_id);
            if (prog && cls) prog.classes.push(cls);
        }

        // Filter program yang punya kelas
        const activeProgs = [...progMap.values()].filter(p => p.classes.length > 0);

        // Render accordion per program
        const html = activeProgs.map(prog => {
            const classAccordions = prog.classes
                .sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(r => {
                    const tot  = r.total;
                    const pctH = tot > 0 ? Math.round(r.HADIR / tot * 100) : 0;
                    const pctI = tot > 0 ? Math.round(r.IZIN  / tot * 100) : 0;
                    const pctS = tot > 0 ? Math.round(r.SAKIT / tot * 100) : 0;
                    const pctA = tot > 0 ? Math.round(r.ALPA  / tot * 100) : 0;
                    const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                    const safeId = r.class_id.replace(/[^a-z0-9]/gi, '_');
                    return `
                    <details class="att-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                        <summary class="att-accordion-summary">
                            <span>${esc(r.name)}</span>
                            <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                                <span style="color:${colH}">${pctH}%H</span>
                                <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                                <span style="color:var(--color-primary)">${pctS}%S</span>
                                <span style="color:var(--color-danger)">${pctA}%A</span>
                            </span>
                        </summary>
                        <div id="wkdet-body-${safeId}"
                             data-class-id="${esc(r.class_id)}"
                             data-date-start="${esc(dateStart ?? '')}"
                             data-date-end="${esc(dateEnd ?? '')}"
                             style="padding:4px 0">
                            <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                        </div>
                    </details>`;
                }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px">
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">${esc(prog.name)}</span>
                    <span class="att-acc-names">${prog.classes.length} kelas</span>
                </summary>
                <div style="padding:4px 0">${classAccordions}</div>
            </details>`;
        }).join('');

        container.innerHTML = html;

        // Lazy load siswa saat accordion kelas dibuka
        container.querySelectorAll('details.wz-accordion-inner').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';

                const classId  = body.dataset.classId;
                const dStart   = body.dataset.dateStart || null;
                const dEnd     = body.dataset.dateEnd   || null;

                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (requestSeq !== _wkAttendanceRequestSeq) return;
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            const safeId = s.student_id.replace(/[^a-z0-9]/gi, '_');
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span class="att-acc-name">
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div id="wkstu-body-${safeId}" style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    // Lazy load sesi per siswa
                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('[id^="wkstu-body-"]');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid    = stuDet.dataset.studentId;
                            const ds     = stuDet.dataset.dateStart || null;
                            const de     = stuDet.dataset.dateEnd   || null;
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                                return;
                            }
                            try {
                                const sessions = await getStudentAttendanceSessions(
                                    sid, ds, de, null, config.current_academic_year
                                );
                                if (requestSeq !== _wkAttendanceRequestSeq) return;
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA: 'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                const grouped = [];
                                const seen = new Map();
                                for (const s of sessions) {
                                    const key = s.schedule.schedule_id ?? s.attendance_id;
                                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                                }
                                sBody.innerHTML = grouped.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)}${s.schedule.session_start ? ` · ${esc(s.schedule.session_start.slice(0, 5))}` : ''}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                        </span>
                                        <span style="font-size:11px;font-weight:600;
                                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                        </span>
                                    </div>`).join('');
                            } catch(err) {
                                if (requestSeq !== _wkAttendanceRequestSeq) return;
                                delete sBody.dataset.loaded;
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });

                } catch (err) {
                    if (requestSeq !== _wkAttendanceRequestSeq) return;
                    delete body.dataset.loaded;
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        if (requestSeq !== _wkAttendanceRequestSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

async function loadWkLateRecap() {
    const requestSeq = ++_wkLateRequestSeq;
    const start     = document.getElementById('wk-late-start').value;
    const end       = document.getElementById('wk-late-end').value;
    const container = document.getElementById('wk-late-recap');
    if (!start || !end || start > end) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getLateArrivalsByRange(start, end, config?.current_academic_year ?? null);
        if (requestSeq !== _wkLateRequestSeq) return;
        if (!rows.length) {
            container.innerHTML = '<p class="hint">Tidak ada catatan keterlambatan pada rentang ini.</p>';
            return;
        }
        const fmtDisp = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
        container.innerHTML = `
            <p class="hint" style="margin-bottom:8px">${rows.length} catatan ditemukan</p>
            <div style="overflow-x:auto">
            <table class="table" style="width:100%">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Kelas</th><th>Jam Datang</th><th>Alasan</th><th>Dicatat Oleh</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td style="white-space:nowrap">${fmtDisp(r.date)}</td>
                        <td>${esc(r.student_name)}</td>
                        <td>${esc(r.nis)}</td>
                        <td>${esc(r.class_name)}</td>
                        <td style="white-space:nowrap">${r.arrival_time.slice(0,5)}</td>
                        <td>${esc(r.reason || '—')}</td>
                        <td>${esc(r.recorder)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        if (requestSeq !== _wkLateRequestSeq) return;
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

const HANDLER_ROLE_LABELS = {
    GURU: 'Guru', WALI_KELAS: 'Wali Kelas', BK: 'BK', KAPRODI: 'Kaprodi',
    KEPSEK: 'Kepala Sekolah', WAKA_KESISWAAN: 'Waka Kesiswaan',
    WAKA_KURIKULUM: 'Waka Kurikulum', DUDI: 'DUDI',
};


// ─── TAB KAPRODI ─────────────────────────────────────────────

function handleKpStudentsClick(e) {
    const btn = e.target.closest('.kp-finish-btn');
    if (btn) handleFinishPkl(btn);
}

async function initKaprodiTab() {
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
        kpStudents = students;
        kpDudiList = dudi;
        kpAktifStudents = aktifStudents;

        // Gabung PKL + aktif untuk pool pencarian siswa (Observasi & Buat Kasus)
        const seen = new Set(kpStudents.map(s => s.student_id));
        kaprodiAllStudents = [...kpStudents, ...kpAktifStudents.filter(s => !seen.has(s.student_id))];

        renderKpSummary();
        renderKpStudents();
        renderKpDudi();

        const today    = localDateStr();
        const monthAgo = localDateStr(new Date(Date.now() - 30*86400000));

        document.getElementById('kp-date-start').value  = monthAgo;
        document.getElementById('kp-date-end').value    = today;
        document.getElementById('kp-cls-start').value   = monthAgo;
        document.getElementById('kp-cls-end').value     = today;

        document.getElementById('kp-filter-btn').onclick     = loadKpRecap;
        document.getElementById('kp-cls-filter-btn').onclick = loadKpClsRecap;

        const studentsBody = document.getElementById('kp-students-body');
        studentsBody.removeEventListener('click', handleKpStudentsClick);
        studentsBody.addEventListener('click', handleKpStudentsClick);

        await Promise.all([loadKpRecap(), loadKpClsRecap(), loadKpObs(), initKpPlacementForm(programId)]);
        await initKaprodiKasusSection();
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
            errorEl.querySelector('button').addEventListener('click', () => initKaprodiTab());
            panel.prepend(errorEl);
        }
    } finally {
        kpTabLoading = false;
    }
}

async function initKaprodiKasusSection() {
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
    document.getElementById('kp-stat-total').textContent   = kpStudents.length;
    document.getElementById('kp-stat-placed').textContent  = placed;
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

async function handleFinishPkl(btn) {
    const { studentId, placementId, nama } = btn.dataset;
    if (!confirm(`Selesaikan PKL ${nama}? Status akan kembali ke AKTIF.`)) return;
    btn.disabled = true; btn.textContent = 'Memproses…';
    try {
        await finishPlacement(studentId, placementId);
        kpStudents = await fetchPklStudents(kpProgramId);
        kpAktifStudents = await fetchNonPklStudents(kpProgramId);
        const seen = new Set(kpStudents.map(s => s.student_id));
        kaprodiAllStudents = [
            ...kpStudents,
            ...kpAktifStudents.filter(s => !seen.has(s.student_id)),
        ];
        renderKpSummary();
        renderKpStudents();
        // Reload dropdown siswa di form penempatan
        const sel = document.getElementById('kp-pl-student');
        if (sel) {
            const nonPkl = kpAktifStudents;
            sel.innerHTML = '<option value="">-- Pilih siswa --</option>';
            nonPkl.forEach(s => {
                const o = document.createElement('option');
                o.value = s.student_id; o.textContent = `${s.full_name} (${s.nis})`;
                sel.appendChild(o);
            });
        }
        if (_kpKasusCtx) {
            _kpKasusCtx.extraQuery.studentIds = [...new Set(kaprodiAllStudents.map(s => s.student_id))];
            await loadKasusList(false, _kpKasusCtx);
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

async function loadKpRecap() {
    const ids   = kpStudents.map(s => s.student_id);
    const start = document.getElementById('kp-date-start').value || null;
    const end   = document.getElementById('kp-date-end').value || null;
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
                <td style="text-align:center;font-weight:600;color:${color}">${a.total > 0 ? pct+'%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        if (seq !== kpRecapSeq) return;
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadKpClsRecap() {
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
        // Ambil kelas di program Kaprodi
        const classes = await getClassesByProgram(kpProgramId);
        if (!classes.length) {
            container.innerHTML = '<p class="hint">Belum ada kelas di program ini.</p>';
            return;
        }

        // Rekap agregat per kelas
        const allRows = await getAttendanceRecapPerClass(dateStart, dateEnd);
        if (seq !== kpClsRecapSeq) return;
        const classIds = new Set(classes.map(c => c.class_id));
        const rows = allRows.filter(r => classIds.has(r.class_id));

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada kelas di program ini untuk rentang tanggal tersebut.</p>';
            return;
        }

        const html = rows
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
            .map(r => {
                const tot  = r.total;
                const pctH = tot > 0 ? Math.round(r.HADIR / tot * 100) : 0;
                const pctI = tot > 0 ? Math.round(r.IZIN  / tot * 100) : 0;
                const pctS = tot > 0 ? Math.round(r.SAKIT / tot * 100) : 0;
                const pctA = tot > 0 ? Math.round(r.ALPA  / tot * 100) : 0;
                const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <details class="att-accordion" style="margin-bottom:8px">
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">${esc(r.name)}</span>
                        <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                            <span style="color:${colH}">${pctH}%H</span>
                            <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                            <span style="color:var(--color-primary)">${pctS}%S</span>
                            <span style="color:var(--color-danger)">${pctA}%A</span>
                        </span>
                    </summary>
                    <div data-class-id="${esc(r.class_id)}"
                         data-date-start="${esc(dateStart ?? '')}"
                         data-date-end="${esc(dateEnd ?? '')}"
                         style="padding:4px 0">
                        <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                    </div>
                </details>`;
            }).join('');

        container.innerHTML = html;

        // Lazy load siswa saat accordion kelas dibuka
        container.querySelectorAll('details.att-accordion').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';
                const classId = body.dataset.classId;
                const dStart  = body.dataset.dateStart || null;
                const dEnd    = body.dataset.dateEnd   || null;
                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span class="att-acc-name">
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('div');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid = stuDet.dataset.studentId;
                            const ds  = stuDet.dataset.dateStart || null;
                            const de  = stuDet.dataset.dateEnd   || null;
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                                return;
                            }
                            try {
                                const sessions = await getStudentAttendanceSessions(sid, ds, de);
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA: 'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                 const grouped = [];
                                 const seen = new Set();
                                 for (const s of sessions) {
                                     const key = s.schedule.schedule_id ?? s.attendance_id;
                                     if (!seen.has(key)) { seen.add(key); grouped.push(s); }
                                 }
                                sBody.innerHTML = grouped.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                             ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                             ${s.schedule.session_start ? ` · ${esc(s.schedule.session_start.slice(0, 5))}–${esc((s.schedule.session_end ?? '').slice(0, 5))}` : ''}
                                        </span>
                                        <span style="font-size:11px;font-weight:600;
                                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                        </span>
                                    </div>`).join('');
                            } catch(err) {
                                 delete sBody.dataset.loaded;
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });
                } catch (err) {
                    delete body.dataset.loaded;
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

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

async function initKpPlacementForm(programId) {
    // Isi dropdown siswa belum PKL
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
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type:'text/csv' })), download:'template_penempatan_pkl.csv' });
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



// ─── TAB WAKA KURIKULUM ───────────────────────────────────────

let _wkKur1Visible = false;
let _wkKur1Loaded  = false;
let _wkKur1Date    = null;
let _wkKur1Seq     = 0;
let _wkKur2Visible = false;
let _wkKur2Seq     = 0;
let _wkKurTabInit  = false;
const _wkKurStatsSeq = {};

async function initWakaKurTab() {
    pasangNilaiPimpinan(document.getElementById('tab-waka_kurikulum'), { esc, tahun: config?.current_academic_year, semester: config?.current_semester });
    pasangNilaiRaporKelas(document.getElementById('tab-waka_kurikulum'), { esc, mode: 'pimpinan', tahun: config?.current_academic_year, semester: config?.current_semester });
    pasangKunciPeriode(document.getElementById('tab-waka_kurikulum'), { esc, tahun: config?.current_academic_year, semester: config?.current_semester });
    if (!_wkKurTabInit) {
        _wkKurTabInit = true;
        // Default Panel 2: 7 hari terakhir — selaras dengan scope Panel 1 (hari ini)
        const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
        document.getElementById('wk-kur-start').value = weekAgo;
        document.getElementById('wk-kur-end').value   = localDateStr();
        document.getElementById('wk-kur1-refresh').onclick = () => { loadWkKurStats(localDateStr(), localDateStr()); loadWkKur1(localDateStr()); };
        document.getElementById('wk-kur2-refresh').onclick = () => loadWkKur2();
        document.getElementById('wk-kur1-btn').onclick = handleWkKur1Btn;
        document.getElementById('wk-kur2-btn').onclick = handleWkKur2Btn;
    }
    // Refresh an open daily table; invalidate a hidden one for its next opening.
    const today = localDateStr();
    const reloadDaily = _wkKur1Visible;
    ++_wkKur1Seq;
    _wkKur1Loaded = false;
    _wkKur1Date = null;
    _wkKur1Visible = false;
    document.getElementById('wk-kur1-wrap').style.display = 'none';
    document.getElementById('wk-kur1-hint').style.display = 'none';
    const btn = document.getElementById('wk-kur1-btn');
    btn.disabled = false;
    btn.textContent = 'Tampilkan';
    await Promise.all([
        loadWkKurStats(today, today),
        ...(reloadDaily ? [loadWkKur1(today)] : []),
    ]);
}

async function loadWkKurStats(dateStart, dateEnd, prefix = 'wk-kur', emptyMsg = 'Tidak ada sesi hari ini') {
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

async function loadWkKur1(date = localDateStr()) {
    const seq = ++_wkKur1Seq;
    const hintEl = document.getElementById('wk-kur1-hint');
    const wrapEl = document.getElementById('wk-kur1-wrap');
    const tbody  = document.getElementById('wk-kur1-body');
    const btn    = document.getElementById('wk-kur1-btn');

    hintEl.style.display = 'none';
    wrapEl.style.display = 'none';
    btn.style.display    = '';
    btn.disabled         = true;
    btn.textContent      = 'Memuat…';
    _wkKur1Loaded = false;
    _wkKur1Date = null;
    _wkKur1Visible = false;

    try {
        const rows = await getPendingAttendanceSessions(date);
        if (seq !== _wkKur1Seq || date !== localDateStr()) return;

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="hint" style="text-align:center;padding:12px">✓ Tidak ada sesi yang menunggu pengisian absensi hari ini.</td></tr>`;
        } else {
            const groups = {};
            rows.forEach(r => {
                const key = r.teacher_id;
                if (!groups[key]) groups[key] = { name: r.teacher?.full_name ?? '—', sesi: [] };
                groups[key].sesi.push(r);
            });
            const sorted = Object.keys(groups).sort((a, b) =>
                groups[a].name.localeCompare(groups[b].name, 'id'));

            let html = '';
            sorted.forEach((tid, i) => {
                const g = groups[tid];
                html += `<tr data-guru-idx="${i}" style="cursor:pointer">
                    <td style="text-align:center">${i + 1}</td>
                    <td>${esc(g.name)} <span style="font-size:11px;background:var(--color-surface-raised,rgba(0,0,0,.12));border-radius:4px;padding:1px 6px;margin-left:4px">${g.sesi.length} sesi</span></td>
                    <td style="text-align:center;font-size:18px;color:var(--color-text-muted)" class="wk-kur1-arrow">&#8250;</td>
                </tr>
                <tr id="wk-kur1-detail-${i}" style="display:none">
                    <td colspan="3" style="padding:0">
                        <table style="width:100%;border-collapse:collapse;background:var(--color-surface-raised,rgba(0,0,0,.08))">
                            <thead><tr style="font-size:11px;color:var(--color-text-muted)">
                                <th style="padding:5px 12px;text-align:left">Sesi</th>
                                <th style="padding:5px 12px;text-align:left">Mata Pelajaran</th>
                                <th style="padding:5px 12px;text-align:left">Kelas</th>
                            </tr></thead>
                            <tbody>${g.sesi.map(s => `<tr>
                                <td style="padding:5px 12px">${fmtTime(s.session_start)}–${fmtTime(s.session_end)}</td>
                                <td style="padding:5px 12px">${esc(s.subject?.name ?? '—')}</td>
                                <td style="padding:5px 12px">${esc(s.class?.name ?? '—')}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </td>
                </tr>`;
            });
            tbody.innerHTML = html;

            tbody.querySelectorAll('tr[data-guru-idx]').forEach(tr => {
                tr.addEventListener('click', () => {
                    const idx = tr.dataset.guruIdx;
                    const det = document.getElementById(`wk-kur1-detail-${idx}`);
                    const arr = tr.querySelector('.wk-kur1-arrow');
                    const open = det.style.display !== 'none';
                    det.style.display = open ? 'none' : '';
                    if (arr) arr.innerHTML = open ? '&#8250;' : '&#8964;';
                });
            });
        }

        wrapEl.style.display = '';
        btn.style.display    = '';
        btn.textContent      = 'Sembunyikan';
        _wkKur1Visible = true;
        _wkKur1Loaded = true;
        _wkKur1Date = date;
    } catch (err) {
        if (seq !== _wkKur1Seq || date !== localDateStr()) return;
        hintEl.textContent   = `Gagal memuat data. ${fe(err)}`;
        hintEl.style.display = 'block';
    } finally {
        if (seq === _wkKur1Seq) {
            btn.disabled = false;
            if (!_wkKur1Loaded) btn.textContent = 'Tampilkan';
        }
    }
}

function handleWkKur1Btn() {
    if (!_wkKur1Loaded || _wkKur1Date !== localDateStr()) {
        return loadWkKur1(localDateStr());
    }
    const wrapEl = document.getElementById('wk-kur1-wrap');
    const btn    = document.getElementById('wk-kur1-btn');
    _wkKur1Visible = !_wkKur1Visible;
    wrapEl.style.display = _wkKur1Visible ? '' : 'none';
    btn.textContent      = _wkKur1Visible ? 'Sembunyikan' : 'Tampilkan';
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
        statsRow.style.display = 'grid';
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

// ─── TAB WAKA HUMAS ──────────────────────────────────────────

let whStudents = [];
let whDudiList = [];
let _whTabInit = false;

async function initWakaHumasTab() {
    if (_whTabInit) return;
    _whTabInit = true;

    const today    = localDateStr();
    const monthAgo = localDateStr(new Date(Date.now() - 30*86400000));
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
        await Promise.all([loadWhRecap(), loadWhObs(), loadWhCases()]);
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
            return `<tr><td>${esc(a.name)}</td><td>${esc(a.prog)}</td><td>${a.HADIR}</td><td>${a.SAKIT}</td><td>${a.IZIN}</td><td>${a.ALPA}</td><td>${a.total > 0 ? pct+'%' : '—'}</td></tr>`;
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

async function loadWhCases() {
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

// ─── TAB KEPSEK (Monitoring) ─────────────────────────────────

const BULAN_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

function _prevAcademicYear() {
    const y = parseInt(config?.current_academic_year?.split('/')[0] ?? new Date().getFullYear());
    return `${y - 1}/${y}`;
}

function fmtChartLabel(dateStr, byMonth) {
    const d = new Date(dateStr + 'T00:00:00');
    return byMonth
        ? BULAN_ID[d.getMonth()] + ' ' + d.getFullYear()
        : d.getDate() + ' ' + BULAN_ID[d.getMonth()];
}

let _ksTabInit = false;
let _ksChart   = null;
let _ksMonitoringSeq = 0;

function kepsekLocalRange(period) {
    const today = new Date();
    const shift = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    const todayStr = localDateStr(today);

    if (period === 'hari_ini') return { start: todayStr, end: todayStr };
    if (period === '7_hari') return { start: localDateStr(shift(today, -6)), end: todayStr };
    if (period === 'minggu_lalu') {
        const daysSinceMonday = (today.getDay() + 6) % 7;
        const thisMonday = shift(today, -daysSinceMonday);
        return { start: localDateStr(shift(thisMonday, -7)), end: localDateStr(shift(thisMonday, -1)) };
    }
    if (period === 'bulan_lalu') {
        const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: localDateStr(new Date(today.getFullYear(), today.getMonth() - 1, 1)), end: localDateStr(shift(firstThisMonth, -1)) };
    }
    return null;
}

async function initKepsekTab() {
    pasangNilaiPimpinan(document.getElementById('tab-kepsek'), { esc, tahun: config?.current_academic_year, semester: config?.current_semester });
    pasangNilaiRaporKelas(document.getElementById('tab-kepsek'), { esc, mode: 'pimpinan', tahun: config?.current_academic_year, semester: config?.current_semester });
    pasangKunciPeriode(document.getElementById('tab-kepsek'), { esc, tahun: config?.current_academic_year, semester: config?.current_semester });
    if (!_ksTabInit) {
        _ksTabInit = true;
        wireSimpleAccordion('ks-chart-card');
        wireSimpleAccordion('ks-monitoring-card');
        wireSimpleAccordion('ks-admin-card');
        wireSimpleAccordion('ks-region-card');

        // Wire period preset buttons
        document.getElementById('ks-period-toggle').addEventListener('click', e => {
            const btn = e.target.closest('.ks-period-btn');
            if (!btn || btn.disabled) return;
            document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            const ayLalu = period === 'tahun_ajaran_lalu' ? _prevAcademicYear() : null;
            loadKepsekMonitoring(period, ayLalu);
        });

        // Wire date range button
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
            loadKepsekMonitoring('rentang', null, start, end);
        });

        // Default date range: 7 hari terakhir
        document.getElementById('ks-range-start').value = localDateStr(new Date(Date.now() - 6 * 86400000));
        document.getElementById('ks-range-end').value   = localDateStr();

    }
    await loadKepsekMonitoring('7_hari');
    await loadKepsekKasusRingkasan();
    await initKsAdminTab();
    await initKsRegionSharing();
}

/**
 * Keputusan Romo 18 Okt 2026: Kepala Sekolah dikeluarkan dari Pembinaan Siswa dan hanya melihat angka agregat di dashboard-nya.
 * Tidak ada daftar, judul, deskripsi, atau nama siswa; server (fn_kepsek_case_summary) hanya mengembalikan hitungan.
 */
async function loadKepsekKasusRingkasan() {
    const el = document.getElementById('ks-pembinaan-ringkasan');
    if (!el) return;
    const BARIS = [['OPEN', 'Buka'], ['UNDER_REVIEW', 'Ditinjau'], ['INTERVENTION', 'Intervensi'], ['MONITORING', 'Monitoring'], ['CLOSED', 'Tutup']];
    try {
        const d = await getKepsekCaseSummary();
        const aktif = BARIS.slice(0, 4).reduce((j, [k]) => j + (Number(d?.per_status?.[k]) || 0), 0);
        const sel = (label, nilai) => `<div style="padding:8px 12px;border:1px solid var(--color-border);border-radius:var(--radius);min-width:120px"><div style="font-size:12px;color:var(--color-text-muted)">${esc(label)}</div><div style="font-size:20px;font-weight:600">${esc(String(nilai ?? '—'))}</div></div>`;
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

let _ksAdminTabInit = false;

// ── Berbagi ringkasan ke wilayah: persetujuan kepala sekolah per tingkat ──
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
        const adaTingkat = TINGKAT.some((t) => st[t.ada]);
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
                        ? 'Bagikan ringkasan agregat sekolah ke ' + t.label.toLowerCase() + '?\n\nYang terlihat hanya angka ringkas: jumlah siswa aktif, jumlah orang tua aktif, kehadiran, cakupan input, serta jumlah keterlambatan dan izin keluar. Tidak ada nama atau data pribadi siswa maupun orang tua. Anda dapat menghentikannya kapan saja.'
                        : 'Hentikan berbagi ke ' + t.label.toLowerCase() + '? Sekolah ini akan langsung hilang dari dashboard tingkat itu.';
                    if (!window.confirm(tanya)) return;
                    btn.disabled = true;
                    msgEl.style.display = 'none';
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
    } catch (err) {
        statusEl.textContent = 'Gagal memuat status berbagi data.';
        listEl.replaceChildren();
    }
}

async function initKsAdminTab() {
    if (!_ksAdminTabInit) {
        _ksAdminTabInit = true;
        document.getElementById('ks-add-admin-form').addEventListener('submit', handleAddAdmin);
    }
    await loadAdminList();
}

async function loadKepsekMonitoring(period, academicYear = null, dateStart = null, dateEnd = null) {
    const seq       = ++_ksMonitoringSeq;
    const errEl    = document.getElementById('ks-monitoring-error');
    const pctSiswa = document.getElementById('ks-pct-siswa');
    const pctGuru  = document.getElementById('ks-pct-guru');
    const detSiswa = document.getElementById('ks-detail-siswa');
    const rincianAbsensi = document.getElementById('ks-rincian-absensi');
    const rincianAbsensiHint = document.getElementById('ks-rincian-absensi-hint');
    const detGuru  = document.getElementById('ks-detail-guru');
    const hintEl   = document.getElementById('ks-chart-hint');
    const countLate  = document.getElementById('ks-count-late');
    const countExits = document.getElementById('ks-count-exits');

    pctSiswa.textContent = '…';
    pctGuru.textContent  = '…';
    detSiswa.textContent = '';
    rincianAbsensi.textContent = '';
    rincianAbsensiHint.textContent = '';
    detGuru.textContent  = '';
    if (countLate)  countLate.textContent = '…';
    if (countExits) countExits.textContent = '…';
    hintEl.textContent = '';
    errEl.style.display  = 'none';
    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    try {
        // Relative presets use browser-local dates so DB timezone cannot shift a school day.
        let _period    = period;
        let _dateStart = dateStart;
        let _dateEnd   = dateEnd;
        const localRange = kepsekLocalRange(period);
        if (localRange) {
            _period    = 'rentang';
            _dateStart = localRange.start;
            _dateEnd   = localRange.end;
        }
        const d = await getKepsekMonitoring(_period, academicYear, _dateStart, _dateEnd);
        if (seq !== _ksMonitoringSeq) return;
        const s = d.summary ?? {};

        pctSiswa.textContent = (s.pct_siswa != null && !isNaN(s.pct_siswa)) ? s.pct_siswa + '%' : '0%';
        pctGuru.textContent  = (s.pct_guru != null && !isNaN(s.pct_guru)) ? s.pct_guru + '%' : '0%';
        if (countLate)  countLate.textContent  = s.count_late  != null ? s.count_late  + ' siswa' : '—';
        if (countExits) countExits.textContent = s.count_exits != null ? s.count_exits + ' siswa' : '—';
        detSiswa.textContent = `${s.siswa_hadir ?? 0} / ${s.siswa_total ?? 0} siswa hadir`;
        const rincian = s.rincian_absensi ?? {};
        const barisAbsensi = Number(rincian.baris ?? 0);
        if (barisAbsensi > 0) {
            const persenStatus = (key) => `${(100 * Number(rincian[key] ?? 0) / barisAbsensi).toFixed(1)}% (${Number(rincian[key] ?? 0)})`;
            rincianAbsensi.textContent = `Hadir ${persenStatus('hadir')} · Sakit ${persenStatus('sakit')} · Izin ${persenStatus('izin')} · Alpa ${persenStatus('alpa')}`;
            rincianAbsensiHint.textContent = `dari ${barisAbsensi} catatan absensi (siswa x sesi) pada periode ini`;
        } else {
            rincianAbsensi.textContent = 'Belum ada catatan absensi pada periode ini';
            rincianAbsensiHint.textContent = '';
        }
        detGuru.textContent  = `${s.guru_hadir  ?? 0} / ${s.guru_total  ?? 0} guru hadir`;

        const chartData = d.chart ?? [];
        hintEl.textContent = chartData.length === 0
            ? 'Belum ada data pada periode ini'
            : d.by_month ? 'Persentase kehadiran per bulan' : 'Persentase kehadiran per hari';

        renderKepsekChart(chartData, d.by_month);

        // FIX 2: disable tombol Tahun Lalu jika tidak ada data untuk tahun ajaran lalu
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
        if (seq !== _ksMonitoringSeq) return;
        errEl.textContent   = `Gagal memuat data: ${fe(err)}`;
        errEl.style.display = 'block';
        pctSiswa.textContent = '—';
        pctGuru.textContent  = '—';
        rincianAbsensi.textContent = '';
        rincianAbsensiHint.textContent = '';
        if (countLate)  countLate.textContent = '—';
        if (countExits) countExits.textContent = '—';
        hintEl.textContent = '';
        if (_ksChart) { _ksChart.destroy(); _ksChart = null; }
        console.error('[kepsek monitoring]', err);
    }
}

function renderKepsekChart(chartData, byMonth) {
    const canvas = document.getElementById('ks-chart');
    const maxY2  = Math.max(10, ...chartData.map(p => p.count_late ?? 0), ...chartData.map(p => p.count_exits ?? 0));
    const labels     = chartData.map(p => fmtChartLabel(p.date, byMonth));
    const dataSiswa  = chartData.map(p => p.pct_siswa);
    const dataGuru   = chartData.map(p => p.pct_guru);
    const dataLate   = chartData.map(p => p.count_late  ?? null);
    const dataExits  = chartData.map(p => p.count_exits ?? null);

    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    _ksChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Kehadiran Siswa (%)',
                    data: dataSiswa,
                    borderColor: '#1D9E75',
                    backgroundColor: '#1D9E7518',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Kehadiran Guru (%)',
                    data: dataGuru,
                    borderColor: '#185FA5',
                    backgroundColor: '#185FA518',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Keterlambatan',
                    data: dataLate,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    tension: 0.3,
                    yAxisID: 'y2',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Izin Keluar',
                    data: dataExits,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.1)',
                    tension: 0.3,
                    yAxisID: 'y2',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
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
                            if (ctx.dataset.yAxisID === 'y2') {
                                return `${ctx.dataset.label}: ${v != null ? v + ' siswa' : '—'}`;
                            }
                            return `${ctx.dataset.label}: ${v != null ? v + '%' : '0%'}`;
                        },
                    },
                },
            },
            scales: {
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0, max: 100,
                    ticks: { callback: v => v + '%', font: { size: 11 } },
                    grid: { color: '#0001' },
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: maxY2,
                    title: { display: true, text: 'Jumlah Siswa', font: { size: 10 } },
                    ticks: { font: { size: 11 }, precision: 0 },
                    grid: { drawOnChartArea: false },
                },
                x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
            },
        },
    });
}

async function loadAdminList() {
    const el = document.getElementById('ks-admin-list');
    try {
        const admins = await listSchoolAdmins();
        if (!admins.length) {
            el.innerHTML = '<p class="hint">Belum ada data admin.</p>';
            return;
        }
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

async function handleAddAdmin(e) {
    e.preventDefault();
    const btn     = document.getElementById('ks-add-admin-btn');
    const msgEl   = document.getElementById('ks-add-admin-msg');
    const resultEl = document.getElementById('ks-new-admin-result');
    const name    = document.getElementById('ks-admin-name').value.trim();
    const loginId = document.getElementById('ks-admin-loginid').value.trim();
    const idType  = document.getElementById('ks-admin-idtype').value;

    if (loginId.length < 9) {
        msgEl.textContent   = 'NIP/NIK minimal 9 karakter.';
        msgEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    msgEl.style.display = 'none';
    resultEl.style.display = 'none';

    try {
        const result = await addSchoolAdmin({ full_name: name, login_identifier: loginId, identifier_type: idType });

        document.getElementById('ks-result-loginid').textContent   = result.login_identifier;
        document.getElementById('ks-result-password').textContent  = result.temp_password;
        resultEl.style.display = 'block';

        e.target.reset();
        e.target.closest('details').open = false;

        await loadAdminList();
    } catch (err) {
        msgEl.textContent    = fe(err);
        msgEl.style.display  = 'block';
    } finally {
        btn.disabled = false;
    }
}

window.confirmRemoveAdmin = async function(btn) {
    const uid  = btn.dataset.uid;
    const name = btn.dataset.name;
    if (!confirm(`Hapus akun admin "${name}"?\n\nMereka tidak akan bisa login lagi.`)) return;

    btn.disabled = true;
    try {
        await removeSchoolAdmin(uid);
        await loadAdminList();
    } catch (err) {
        alert(`Gagal menghapus: ${fe(err)}`);
        btn.disabled = false;
    }
};

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
    SEKOLAH: ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN'],
    PKL:     ['DUDI','KAPRODI','WAKA_KESISWAAN'],
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

        let localPool = myStudents;
        if (jabatan.includes('kaprodi') && kaprodiAllStudents.length) {
            const seen = new Set(myStudents.map(s => s.student_id));
            localPool = [...myStudents, ...kaprodiAllStudents.filter(s => !seen.has(s.student_id))];
        }
        const local = localPool.filter(s =>
            s.full_name.toLowerCase().includes(q) || s.nis?.includes(q)
        );

        let hits = local;
        if (isBroadObserver) {
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
    const pengawas = currentUser.role_type === 'WAKA_KESISWAAN';   // Kepala Sekolah dikeluarkan dari Pembinaan Siswa (18 Okt 2026)
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
    WAKA_KESISWAAN: 'Waka Kesiswaan', WAKA_KURIKULUM: 'Waka Kurikulum', WAKA_HUMAS: 'Waka Humas', KEPSEK: 'Kepala Sekolah' };

/**
 * Panel "Pembaca Kasus": siapa yang boleh membaca kasus ini selain pembuat, penangan, dan Waka Kesiswaan.
 * Pembuat/penangan saat ini boleh menandai; hanya pembuat boleh mencabut. Server (RLS + fungsi) tetap penentu akhir.
 */
async function renderKasusViewers(kasus, ctx, seq) {
    const isCurrent = () => ctx.currentId === kasus.case_id && ctx.detailSeq === seq;
    const me        = currentUser.user_id;
    const isCreator = kasus.created_by_user_id === me;
    const isHandler = kasus.current_handler_user_id === me;
    const isOversight = currentUser.role_type === 'WAKA_KESISWAAN' && !isCreator && !isHandler;
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
const INTERNAL_CASE_ROLES = ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS'];   // Kepsek dikeluarkan (18 Okt 2026)

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
    const bisaBukaKembali = kasus.status === 'CLOSED' && currentUser.role_type === 'WAKA_KESISWAAN';
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
        if (ctx === _wkKasusCtx) await renderWkCount();
    } catch (err) {
        if (ctx.currentId !== caseId || ctx.detailSeq !== seq) return;
        console.error('[kasus] refresh error', err);
        showKasusDetailError(err, ctx);
    }
}

// ─── TAB PIKET ───────────────────────────────────────────────

const PIKET_OPEN_HOUR  = 7;
const PIKET_OPEN_MIN   = 0;
const PIKET_CLOSE_HOUR = 16;
const PIKET_CLOSE_MIN  = 0;
const PIKET_LATE_LIMIT = '07:15';

function _piketFormActive() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const mins = Number(values.hour) * 60 + Number(values.minute);
    const open  = PIKET_OPEN_HOUR  * 60 + PIKET_OPEN_MIN;
    const close = PIKET_CLOSE_HOUR * 60 + PIKET_CLOSE_MIN;
    return mins >= open && mins < close;
}

function _piketJakartaTimeStr() {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date());
}

let _piketTabInit = false;
let _piketDebounceTimer = null;
let _piketSelectedStudent = null;

async function initPiketTab() {
    const panel = document.querySelector('#tab-piket .page-body');
    if (!panel) return;

    panel.innerHTML = `
        <div class="section-card" id="piket-ringkasan-card">
            <h3>Ringkasan Hari Ini</h3>
            <div id="piket-ringkasan-content"><p style="color:var(--color-text-muted);font-size:13px">Memuat…</p></div>
        </div>
        <div class="section-card" id="piket-form-card">
            <h3>Catat Keterlambatan</h3>
            <div id="piket-form-wrap"></div>
        </div>
        <div class="section-card" id="piket-rekap-card">
            <h3>Rekap Hari Ini</h3>
            <div id="piket-rekap-content"><p style="color:var(--color-text-muted);font-size:13px">Memuat…</p></div>
        </div>
        <div class="section-card" id="piket-exit-form-card">
            <h3>Catat Izin Keluar</h3>
            <div id="piket-exit-form-wrap">
                <p class="hint">Form tidak tersedia di luar jam 07:00–16:00.</p>
            </div>
        </div>
        <div class="section-card" id="piket-exits-card">
            <h3>Izin Keluar Hari Ini</h3>
            <div id="piket-exits-content"><p class="hint">Memuat…</p></div>
        </div>`;

    _piketTabInit = true;
    await _piketRenderAll();
}

async function _piketRenderAll() {
    await Promise.all([_piketRenderRingkasan(), _piketRenderForm(), _piketRenderRekap(), _piketRenderExitForm(), _piketRenderExits()]);
}

async function _piketRenderRingkasan() {
    const el = document.getElementById('piket-ringkasan-content');
    if (!el) return;
    const arrivals = await getTodayLateArrivals();
    const active   = _piketFormActive();
    el.innerHTML = `
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-start;font-size:14px">
            <div style="background:var(--color-bg);border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
                <div style="font-size:2rem;font-weight:700;color:var(--color-primary)">${arrivals.length}</div>
                <div style="color:var(--color-text-muted);font-size:12px">Siswa terlambat</div>
            </div>
            <div style="padding-top:4px">
                <p style="margin:0 0 4px"><strong>Batas masuk:</strong> ${PIKET_LATE_LIMIT}</p>
                <p style="margin:0"><strong>Form pencatatan:</strong>
                    <span style="color:${active ? 'var(--color-success,#16a34a)' : 'var(--color-danger,#dc2626)'}">
                        ${active ? '✓ Aktif (07:00–16:00)' : '✗ Di luar jam operasional'}
                    </span>
                </p>
            </div>
        </div>`;
}

async function _piketRenderForm() {
    const wrap = document.getElementById('piket-form-wrap');
    if (!wrap) return;
    const active = _piketFormActive();
    const nowTime = _piketJakartaTimeStr();

    wrap.innerHTML = `
        ${!active ? `<p style="color:var(--color-text-muted);font-size:13px;font-style:italic">Form tidak tersedia di luar jam 07:00–16:00.</p>` : ''}
        <div style="${active ? '' : 'opacity:0.5;pointer-events:none'}">
            <div class="field" style="position:relative;margin-bottom:12px">
                <label for="piket-search-input" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Cari Siswa</label>
                <input type="text" id="piket-search-input" placeholder="Ketik nama atau NIS…"
                       class="input" autocomplete="off" ${active ? '' : 'disabled'}>
                <div id="piket-search-results" style="position:absolute;top:100%;left:0;right:0;
                     background:var(--color-surface);border:1px solid var(--color-border);
                     border-radius:6px;z-index:100;display:none;max-height:200px;overflow-y:auto"></div>
            </div>
            <div id="piket-selected-student" style="display:none;margin-bottom:12px;padding:8px 12px;
                 background:var(--color-bg);border-radius:6px;font-size:13px"></div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
                <div class="field" style="flex:1;min-width:120px">
                    <label for="piket-arrival-time" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Jam Datang</label>
                    <input type="time" id="piket-arrival-time" class="input"
                           value="${nowTime}" min="07:00" max="16:00" ${active ? '' : 'disabled'}>
                </div>
            </div>
            <div class="field" style="margin-bottom:12px">
                <label for="piket-reason" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Alasan <span style="color:var(--color-text-muted)">(opsional)</span></label>
                <textarea id="piket-reason" class="input" rows="2"
                          placeholder="Misal: macet, bangun kesiangan…" ${active ? '' : 'disabled'}></textarea>
            </div>
            <button id="piket-submit-btn" class="btn btn-primary" ${active ? '' : 'disabled'}>Catat Keterlambatan</button>
            <div id="piket-form-msg" style="margin-top:8px;font-size:13px"></div>
        </div>`;

    if (!active) return;

    const searchInput = document.getElementById('piket-search-input');
    const resultsEl   = document.getElementById('piket-search-results');
    const selectedEl  = document.getElementById('piket-selected-student');
    const submitBtn   = document.getElementById('piket-submit-btn');
    const msgEl       = document.getElementById('piket-form-msg');
    _piketSelectedStudent = null;

    searchInput.addEventListener('input', () => {
        clearTimeout(_piketDebounceTimer);
        _piketDebounceTimer = setTimeout(async () => {
            const q = searchInput.value.trim();
            if (q.length < 2) { resultsEl.style.display = 'none'; return; }
            try {
                const results = await searchStudents(q, currentUser.school_id);
                if (!results.length) {
                    resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--color-text-muted)">Siswa tidak ditemukan.</div>';
                } else {
                    resultsEl.innerHTML = results.map(s => `
                        <div data-id="${esc(s.student_id)}" data-name="${esc(s.full_name)}" data-class="${esc(s.class_name)}"
                             style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--color-border)"
                             class="piket-result-item">
                            <strong>${esc(s.full_name)}</strong>
                            <span style="color:var(--color-text-muted)"> — ${esc(s.class_name || '—')} · ${esc(s.nis || '')}</span>
                        </div>`).join('');
                    resultsEl.querySelectorAll('.piket-result-item').forEach(item => {
                        item.addEventListener('mouseenter', () => { item.style.background = 'var(--color-bg)'; });
                        item.addEventListener('mouseleave', () => { item.style.background = ''; });
                        item.addEventListener('click', () => {
                            _piketSelectedStudent = { student_id: item.dataset.id, full_name: item.dataset.name, class_name: item.dataset.class };
                            searchInput.value = item.dataset.name;
                            resultsEl.style.display = 'none';
                            selectedEl.style.display = 'block';
                            selectedEl.innerHTML = `<i class="ti ti-user-check" style="color:var(--color-success,#16a34a)"></i>
                                <strong>${esc(item.dataset.name)}</strong> — ${esc(item.dataset.class)}`;
                        });
                    });
                }
                resultsEl.style.display = 'block';
            } catch { resultsEl.style.display = 'none'; }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsEl.contains(e.target)) {
            resultsEl.style.display = 'none';
        }
    }, { once: false });

    submitBtn.addEventListener('click', async () => {
        msgEl.textContent = '';
        if (!_piketSelectedStudent) { msgEl.style.color = 'var(--color-danger,#dc2626)'; msgEl.textContent = 'Pilih siswa dulu dari hasil pencarian.'; return; }
        const arrivalTime = document.getElementById('piket-arrival-time').value;
        if (!arrivalTime) { msgEl.style.color = 'var(--color-danger,#dc2626)'; msgEl.textContent = 'Isi jam datang.'; return; }
        const reason = document.getElementById('piket-reason').value.trim();

        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            await recordLateArrival(_piketSelectedStudent.student_id, arrivalTime, reason || null, currentUser.school_id);
            msgEl.style.color = 'var(--color-success,#16a34a)';
            msgEl.textContent = `✓ Keterlambatan ${_piketSelectedStudent.full_name} berhasil dicatat.`;
            _piketSelectedStudent = null;
            searchInput.value = '';
            selectedEl.style.display = 'none';
            selectedEl.innerHTML = '';
            document.getElementById('piket-reason').value = '';
            await Promise.all([_piketRenderRingkasan(), _piketRenderRekap()]);
        } catch (err) {
            msgEl.style.color = 'var(--color-danger,#dc2626)';
            msgEl.textContent = fe(err, 's');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Catat Keterlambatan';
        }
    });
}

async function _piketRenderRekap() {
    const el = document.getElementById('piket-rekap-content');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px">Memuat…</p>';
    const arrivals = await getTodayLateArrivals();
    if (!arrivals.length) {
        el.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px;font-style:italic">Belum ada keterlambatan hari ini.</p>';
        return;
    }
    el.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:2px solid var(--color-border);text-align:left">
                        <th style="padding:8px 10px;white-space:nowrap">Nama Siswa</th>
                        <th style="padding:8px 10px;white-space:nowrap">Kelas</th>
                        <th style="padding:8px 10px;white-space:nowrap">Jam Datang</th>
                        <th style="padding:8px 10px">Alasan</th>
                        <th style="padding:8px 10px;white-space:nowrap">Dicatat Oleh</th>
                        <th style="padding:8px 10px">Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    ${arrivals.map(r => `
                        <tr style="border-bottom:1px solid var(--color-border)" data-late-id="${esc(r.late_id)}">
                            <td style="padding:8px 10px">${esc(r.student_name)}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${esc(r.class_name)}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${fmtTime(r.arrival_time)}</td>
                            <td style="padding:8px 10px">${r.reason ? esc(r.reason) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${esc(r.recorder_name)}</td>
                            <td style="padding:8px 10px">
                                ${r.recorded_by === currentUser.user_id
                                    ? `<button class="btn btn-sm btn-danger piket-delete-btn" data-id="${esc(r.late_id)}">Hapus</button>`
                                    : ''}
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    el.querySelectorAll('.piket-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus catatan keterlambatan ini?')) return;
            btn.disabled = true;
            try {
                await deleteLateArrival(btn.dataset.id);
                await Promise.all([_piketRenderRingkasan(), _piketRenderRekap()]);
            } catch (err) {
                alert(fe(err, 'h'));
                btn.disabled = false;
            }
        });
    });
}

async function _piketRenderExitForm() {
    const wrap = document.getElementById('piket-exit-form-wrap');
    if (!wrap) return;
    if (!_piketFormActive()) {
        wrap.innerHTML = '<p class="hint">Form tidak tersedia di luar jam 07:00–16:00.</p>';
        return;
    }
    const now = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    wrap.innerHTML = `
        <div class="field">
            <label for="piket-exit-search">Cari Siswa</label>
            <input type="text" id="piket-exit-search" class="input" placeholder="Ketik nama atau NIS…" autocomplete="off" />
            <div id="piket-exit-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);max-height:200px;overflow-y:auto"></div>
        </div>
        <div id="piket-exit-selected" style="display:none;margin-bottom:8px"></div>
        <div class="field">
            <label for="piket-exit-time">Jam Keluar</label>
            <input type="time" id="piket-exit-time" class="input" value="${now}" min="07:00" max="16:00" />
        </div>
        <div class="field">
            <label for="piket-exit-reason">Alasan <span style="color:var(--color-text-muted)">(opsional)</span></label>
            <textarea id="piket-exit-reason" class="input" rows="2" placeholder="Keperluan keluar…"></textarea>
        </div>
        <button class="btn btn-primary" id="piket-exit-submit" disabled>Catat Izin Keluar</button>
    `;

    let _exitSelectedStudent = null;
    let _exitDebounceTimer   = null;

    const searchEl  = document.getElementById('piket-exit-search');
    const dropEl    = document.getElementById('piket-exit-dropdown');
    const selectedEl= document.getElementById('piket-exit-selected');
    const submitBtn = document.getElementById('piket-exit-submit');

    searchEl.addEventListener('input', () => {
        clearTimeout(_exitDebounceTimer);
        _exitDebounceTimer = setTimeout(async () => {
            const q = searchEl.value.trim();
            if (q.length < 2) { dropEl.style.display = 'none'; return; }
            try {
                const results = await searchStudents(q, currentUser.school_id);
                if (!results.length) { dropEl.style.display = 'none'; return; }
                dropEl.innerHTML = results.slice(0, 8).map(s =>
                    `<div class="search-result-item" data-id="${esc(s.student_id)}"
                          style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--color-border)">
                        ${esc(s.full_name)} <span style="color:var(--color-text-muted);font-size:12px">${esc(s.nis)} — ${esc(s.class_name ?? '')}</span>
                     </div>`).join('');
                dropEl.style.display = 'block';
                dropEl.querySelectorAll('.search-result-item').forEach(el => {
                    el.addEventListener('click', () => {
                        _exitSelectedStudent = results.find(s => s.student_id === el.dataset.id);
                        searchEl.value = '';
                        dropEl.style.display = 'none';
                        selectedEl.innerHTML = `<span class="badge badge-info">✓ ${esc(_exitSelectedStudent.full_name)} — ${esc(_exitSelectedStudent.class_name ?? '')}</span>
                            <button type="button" style="margin-left:8px;background:none;border:none;cursor:pointer;color:var(--color-text-muted)" id="piket-exit-clear">×</button>`;
                        selectedEl.style.display = 'block';
                        submitBtn.disabled = false;
                        document.getElementById('piket-exit-clear')?.addEventListener('click', () => {
                            _exitSelectedStudent = null;
                            selectedEl.style.display = 'none';
                            submitBtn.disabled = true;
                        });
                    });
                });
            } catch (e) {
                console.error('searchStudents (exit):', e);
                dropEl.innerHTML = `<div style="padding:8px 12px;color:var(--color-danger,#dc2626)">Pencarian gagal. Coba lagi.</div>`;
                dropEl.style.display = 'block';
            }
        }, 300);
    });

    submitBtn.addEventListener('click', async () => {
        if (!_exitSelectedStudent) return;
        const exitTime = document.getElementById('piket-exit-time').value;
        const reason   = document.getElementById('piket-exit-reason').value.trim();
        if (!exitTime) { alert('Jam keluar wajib diisi.'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            await recordExit(_exitSelectedStudent.student_id, exitTime, reason || null, currentUser.school_id, currentUser.user_id);
            _exitSelectedStudent = null;
            selectedEl.style.display = 'none';
            submitBtn.disabled = true;
            document.getElementById('piket-exit-reason').value = '';
            await _piketRenderAll();
        } catch (e) {
            alert('Gagal mencatat: ' + (e.message ?? e));
            submitBtn.disabled = false;
        } finally {
            submitBtn.textContent = 'Catat Izin Keluar';
        }
    });
}

async function _piketRenderExits() {
    const content = document.getElementById('piket-exits-content');
    if (!content) return;
    const exits = await getTodayExits();
    const currentUserId = currentUser?.user_id ?? null;
    if (!exits.length) {
        content.innerHTML = '<p class="hint">Belum ada siswa izin keluar hari ini.</p>';
        return;
    }
    content.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:2px solid var(--color-border);text-align:left">
                        <th style="padding:8px 10px">Nama Siswa</th>
                        <th style="padding:8px 10px">Kelas</th>
                        <th style="padding:8px 10px">Jam Keluar</th>
                        <th style="padding:8px 10px">Jam Kembali</th>
                        <th style="padding:8px 10px">Alasan</th>
                        <th style="padding:8px 10px">Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    ${exits.map(r => `
                        <tr style="border-bottom:1px solid var(--color-border)" data-exit-id="${esc(r.exit_id)}">
                            <td style="padding:8px 10px">${esc(r.student_name)}</td>
                            <td style="padding:8px 10px">${esc(r.class_name)}</td>
                            <td style="padding:8px 10px">${r.exit_time ? r.exit_time.slice(0,5) : '—'}</td>
                            <td style="padding:8px 10px">
                                ${r.return_time
                                    ? r.return_time.slice(0,5)
                                    : (r.recorder_id === currentUserId
                                        ? `<button class="btn btn-sm btn-secondary piket-return-btn" data-exit-id="${esc(r.exit_id)}">Catat Kembali</button>`
                                        : '—')}
                            </td>
                            <td style="padding:8px 10px">${r.reason ? esc(r.reason) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                            <td style="padding:8px 10px">
                                ${r.recorder_id === currentUserId
                                    ? `<button class="btn btn-sm btn-danger piket-exit-delete-btn" data-exit-id="${esc(r.exit_id)}">Hapus</button>`
                                    : ''}
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    content.querySelectorAll('.piket-return-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const now = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
            const returnTime = await showInputModal('Jam kembali (HH:MM):', { defaultValue: now, placeholder: 'HH:MM' });
            if (!returnTime) return;
            try {
                await updateReturnTime(btn.dataset.exitId, returnTime);
                await _piketRenderExits();
            } catch (e) { alert('Gagal mencatat jam kembali: ' + (e.message ?? e)); }
        });
    });

    content.querySelectorAll('.piket-exit-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus catatan izin keluar ini?')) return;
            try {
                await deleteExit(btn.dataset.exitId);
                await _piketRenderAll();
            } catch (e) { alert('Gagal menghapus: ' + (e.message ?? e)); }
        });
    });
}

// ─── TAB FORUM ───────────────────────────────────────────────

// ─── Forum Sekolah — State ─────────────────────────────────────
let _forumMode        = 'masuk';   // 'masuk' | 'terkirim'
let _forumCursor      = null;     // audit Forum A-10: { created_at, post_id } posting terakhir yang tampil; null = dari awal
let _forumHasMore     = false;
let _forumTabInit     = false;
let _forumScope       = null;      // dari fn_get_user_forum_scope
let _forumEditPostId  = null;      // null = buat baru, uuid = edit
let _forumDetailSeq  = 0;         // audit Forum A-12: nomor permintaan detail; respons usang diabaikan
let _forumDetailPost = null;      // posting yang sedang tampil di detail (dipakai tombol Edit, A-08)
let _forumCommentBusy = false;    // audit Forum A-09: kunci kirim komentar
// FUNC-03: kunci idempotensi per DRAFT (bukan per klik). Dibuat saat modal
// dibuka, dipertahankan selama modal masih terbuka — jadi double-click dan
// retry setelah error jaringan memakai kunci yang sama dan server
// mengembalikan posting yang sama, bukan duplikat.
let _forumIdemKey     = null;

function isForumModerator() {
    return ['KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE'].includes(currentUser?.role_type)
        || currentUser?.is_kepsek === true
        || currentUser?.is_waka_kesiswaan === true;
}

function newIdemKey() {
    try { return crypto.randomUUID(); } catch { /* fallback di bawah */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// State panel pilih penerima
let _forumRecipients  = new Map(); // user_id → { user_id, full_name, role_label }
let _forumGroupLabels = new Map(); // groupKey → label string
let _forumGroupBtns   = new Map(); // groupKey → btnEl
let _forumGroupUids   = new Map(); // groupKey → Set<uid>
let _forumPrograms    = [];        // [{ program_id, name }]
let _forumClasses     = [];        // [{ class_id, name, grade_level, program_id }]

// Drill-down picker state
let _drillType       = null;        // 'SISWA' | 'ORTU'
let _drillExpanded   = new Set();   // program_id yang ter-expand
let _drillJurusanAll = new Set();   // program_id pilih semua
let _drillKelasAll   = new Set();   // class_id pilih semua
let _drillIndividu      = new Map();   // user_id → candidate
let _drillKelasExpanded = new Set();   // class_id yang ter-expand
let _drillKelasData     = new Map();   // class_id → candidates[] (cache)
let _drillJurusanCount  = new Map();   // program_id → fetched total count
let _drillKelasCount    = new Map();   // class_id   → fetched total count

// Piket drill-down state
let _drillPiketExpanded  = new Set();  // dayOfWeek yang ter-expand
let _drillPiketHariAll   = new Set();  // dayOfWeek semua dipilih
let _drillPiketIndividu  = new Map();  // user_id → candidate
let _drillPiketHariData  = new Map();  // dayOfWeek → candidates[] (cache)
let _drillPiketHariCount = new Map();  // dayOfWeek → fetched count

let _drillWaliExpanded = new Set();    // grade_level yang ter-expand
let _drillWaliGradeAll = new Set();    // grade_level yang semua dipilih
let _drillWaliSelected = new Map();    // user_id → candidate (individu)
let _waliKelasCache    = null;         // Map<class_name, candidate> (cache per buka)

// ─── Init ─────────────────────────────────────────────────────
async function initForumTab() {
    if (_forumTabInit) { await loadForumPosts(); return; }
    _forumTabInit = true;

    // Ambil scope user (role, jabatan, dll)
    const { data: scope, error: scopeError } = await supabase
        .rpc('fn_get_user_forum_scope', { p_user_id: currentUser.user_id })
        .maybeSingle();
    if (scopeError) {
        _forumTabInit = false;
        throw new Error('Scope Forum gagal dimuat. Silakan coba lagi.');
    }
    if (!scope) {
        _forumTabInit = false;
        throw new Error('Akses Forum tidak tersedia untuk akun ini.');
    }
    _forumScope = scope;

    // Ambil program dan kelas untuk filter
    const [progRes, classRes] = await Promise.all([
        supabase.from('programs').select('program_id, name').eq('is_active', true)
            .eq('school_id', currentUser.school_id).order('name'),
        supabase.from('classes').select('class_id, name, grade_level, program_id')
            .eq('is_active', true).eq('school_id', currentUser.school_id).order('name'),
    ]);
    if (progRes.error || classRes.error) {
        _forumTabInit = false;
        throw new Error('Data jurusan atau kelas gagal dimuat. Silakan coba lagi.');
    }
    _forumPrograms = progRes.data ?? [];
    _forumClasses  = classRes.data ?? [];

    // Isi dropdown filter jurusan dan kelas di modal
    const selJur = document.getElementById('forum-filter-jurusan');
    _forumPrograms.forEach(p => {
        selJur.insertAdjacentHTML('beforeend',
            `<option value="${p.program_id}">${esc(p.name)}</option>`);
    });
    const selKls = document.getElementById('forum-filter-kelas');
    _forumClasses.forEach(c => {
        selKls.insertAdjacentHTML('beforeend',
            `<option value="${c.class_id}">${esc(c.name)}</option>`);
    });

    // Sub-tab buttons
    document.getElementById('forum-tab-masuk').addEventListener('click', () => {
        _forumMode = 'masuk'; _forumCursor = null;
        localStorage.setItem('guru_forum_sub_tab', 'masuk');
        document.getElementById('forum-tab-masuk').className = 'btn btn-primary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-secondary';
        loadForumPosts();
    });
    document.getElementById('forum-tab-terkirim').addEventListener('click', () => {
        _forumMode = 'terkirim'; _forumCursor = null;
        localStorage.setItem('guru_forum_sub_tab', 'terkirim');
        document.getElementById('forum-tab-masuk').className = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
        loadForumPosts();
    });

    // Restore forum sub-tab dari localStorage
    const savedForumSub = localStorage.getItem('guru_forum_sub_tab');
    if (savedForumSub === 'terkirim') {
        _forumMode = 'terkirim';
        document.getElementById('forum-tab-masuk').className    = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
    }

    // Buat posting
    document.getElementById('btn-forum-buat').addEventListener('click', () => openForumModal());

    // Modal buat/edit
    document.getElementById('btn-forum-modal-batal').addEventListener('click', closeForumModal);
    document.getElementById('modal-forum-post').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumModal();
    });
    document.getElementById('btn-forum-modal-simpan').addEventListener('click', submitForumPost);

    // Modal detail
    document.getElementById('btn-forum-detail-close').addEventListener('click', closeForumDetail);
    document.getElementById('modal-forum-detail').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumDetail();
    });
    document.getElementById('btn-forum-comment-submit').addEventListener('click', submitForumComment);
    document.getElementById('btn-forum-edit').addEventListener('click', () => {
        const postId = document.getElementById('modal-forum-detail').dataset.postId;
        const post   = _forumDetailPost;
        // A-08: formulir edit diisi dari posting yang sedang dibuka; tanpa datanya, jangan buka formulir kosong yang bisa menimpa isi lama.
        if (!post || String(post.post_id) !== String(postId)) {
            alert('Data posting belum selesai dimuat. Tunggu sebentar lalu coba lagi.');
            return;
        }
        closeForumDetail();
        openForumModal(postId, post);
    });
    document.getElementById('btn-forum-delete').addEventListener('click', async () => {
        const postId = document.getElementById('modal-forum-detail').dataset.postId;
        if (!confirm('Hapus posting ini secara PERMANEN?\n\n' +
            'Komentar, daftar penerima, tanda sudah dibaca, notifikasi, dan ' +
            'lampiran ikut terhapus. Tindakan ini TIDAK dapat dibatalkan.')) return;
        try {
            const result = await deleteForumSekolahPost(postId);
            closeForumDetail();
            loadForumPosts();
            if (result?.attachmentCleanupError) {
                alert('Posting terhapus, tetapi lampiran lama belum berhasil dibersihkan. ' +
                    'Silakan laporkan kepada administrator.');
            }
        } catch (err) { alert(fe(err)); }
    });

    // Load more
    document.getElementById('btn-forum-load-more').addEventListener('click', () => loadForumPosts(true));

    await loadForumPosts();
}

// ─── Load Posts ───────────────────────────────────────────────
async function loadForumPosts(append = false) {
    const loadingEl = document.getElementById('forum-loading');
    const listEl    = document.getElementById('forum-posts-list');
    const moreBtn   = document.getElementById('btn-forum-load-more');
    const LIMIT = 20;

    if (!append) {
        _forumCursor = null;
        listEl.innerHTML = '';
        loadingEl.textContent = 'Memuat forum\u2026';
        loadingEl.style.display = 'block';
    }
    moreBtn.style.display = 'none';

    try {
        let posts;
        if (_forumMode === 'masuk') {
            posts = await getForumSekolahPosts(
                currentUser.school_id, currentUser.user_id, LIMIT, _forumCursor);
        } else {
            posts = await getForumSekolahSentPosts(
                currentUser.school_id, currentUser.user_id, LIMIT, _forumCursor);
        }
        loadingEl.style.display = 'none';
        if (!posts.length && !append) {
            listEl.innerHTML = '<p class="hint">Belum ada posting.</p>';
            return;
        }
        listEl.insertAdjacentHTML('beforeend', posts.map(renderForumPostCard).join(''));
        if (posts.length) {
            const terakhir = posts[posts.length - 1];
            _forumCursor = { created_at: terakhir.created_at, post_id: terakhir.post_id };
        }
        _forumHasMore = posts.length === LIMIT;
        moreBtn.style.display = _forumHasMore ? 'inline-block' : 'none';
        wireForumCards();
    } catch (err) {
        loadingEl.textContent = fe(err);
        loadingEl.style.display = 'block';
    }
}

// ─── Render Card ─────────────────────────────────────────────
function renderForumPostCard(post) {
    const time    = new Date(post.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    const author  = esc(post.author?.full_name ?? '\u2014');
    const cmtCnt  = post.comments?.length ?? 0;
    const ackCnt  = post.acknowledgements?.length ?? 0;
    const hasFile = !!(post.attachment_url || post.attachment_path);
    const edited  = post.is_edited ? ' <span class="hint">(diedit)</span>' : '';
    const withdrawn = post.is_withdrawn
        ? ' <span style="color:var(--color-danger);font-size:12px">Ditarik</span>' : '';

    return `
    <div class="section-card forum-post-card" data-post-id="${post.post_id}" style="cursor:pointer;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <strong>${esc(post.title)}${edited}${withdrawn}</strong>
            <span class="hint" style="white-space:nowrap;font-size:12px">${time}</span>
        </div>
        <p class="hint" style="margin:4px 0 8px">${author}</p>
        <p style="margin:0 0 8px;white-space:pre-wrap;font-size:14px">${esc(post.body).substring(0, 200)}${post.body.length > 200 ? '\u2026' : ''}</p>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--color-muted)">
            ${hasFile ? '<span>\uD83D\uDCCE Lampiran</span>' : ''}
            <span>\uD83D\uDCAC ${cmtCnt} komentar</span>
            ${_forumMode === 'terkirim' ? `<span>\u2713 ${ackCnt} dibaca</span>` : ''}
        </div>
    </div>`;
}

function wireForumCards() {
    document.querySelectorAll('.forum-post-card').forEach(card => {
        if (card.dataset.forumWired === '1') return;
        card.dataset.forumWired = '1';
        card.addEventListener('click', () => openForumDetail(card.dataset.postId));
    });
}

// ─── Modal Buat/Edit ─────────────────────────────────────────
function openForumModal(postId = null, post = null) {
    _forumEditPostId = postId;
    _forumIdemKey    = postId ? null : newIdemKey();   // FUNC-03
    _forumRecipients.clear();
    _forumGroupLabels.clear();
    _forumGroupBtns.clear();
    _forumGroupUids.clear();
    renderRecipientChips();

    const modal = document.getElementById('modal-forum-post');
    document.getElementById('modal-forum-title').textContent = postId ? 'Edit Posting' : 'Buat Posting';
    document.getElementById('forum-input-title').value = '';
    document.getElementById('forum-input-body').value  = '';
    document.getElementById('forum-input-file').value  = '';
    document.getElementById('forum-file-name').textContent = '';
    document.getElementById('forum-post-error').style.display = 'none';

    document.getElementById('forum-filter-jurusan-wrap').style.display = 'none';
    document.getElementById('forum-filter-kelas-wrap').style.display   = 'none';
    document.getElementById('forum-filter-hari-wrap').style.display    = 'none';
    buildRecipientGroupButtons();

    // A-08: mode edit memuat judul/isi/lampiran posting; penerima tidak dapat diubah, jadi bagiannya disembunyikan.
    const recipientField = document.getElementById('forum-recipient-field');
    const editNote       = document.getElementById('forum-edit-note');
    const btnSimpan      = document.getElementById('btn-forum-modal-simpan');
    if (postId && post) {
        document.getElementById('forum-input-title').value = post.title ?? '';
        document.getElementById('forum-input-body').value  = post.body ?? '';
        recipientField.style.display = 'none';
        editNote.style.display       = 'block';
        document.getElementById('forum-file-name').textContent = (post.attachment_name || post.attachment_path)
            ? 'Lampiran saat ini: ' + (post.attachment_name ?? 'berkas') + '. Pilih berkas baru hanya jika ingin menggantinya.' : '';
        btnSimpan.textContent = 'Simpan';
    } else {
        recipientField.style.display = '';
        editNote.style.display       = 'none';
        btnSimpan.textContent        = 'Kirim';
    }

    sipPrepareOpen(modal);
    modal.style.display = 'flex';
}

function closeForumModal() {
    sipCloseOverlay(document.getElementById('modal-forum-post'));
    _forumEditPostId = null;
    _forumIdemKey    = null;                          // FUNC-03
    _forumRecipients.clear();
    _forumGroupLabels.clear();
    _forumGroupBtns.clear();
    _forumGroupUids.clear();
}

// ─── Tombol Grup Penerima ─────────────────────────────────────
const GROUP_LABELS = {
    SEMUA_WAKA:          'Semua Waka dipilih',
    SEMUA_KAPRODI:       'Semua Kaprodi dipilih',
    SEMUA_GURU:          'Semua Guru dipilih',
    GURU_MAPEL:          'Semua Guru dipilih',
    SEMUA_WALI_KELAS:    'Semua Wali Kelas dipilih',
    WALI_KELAS_JURUSAN:  'Semua Wali Kelas Jurusan dipilih',
    SEMUA_GURU_WALI:     'Semua Guru Wali dipilih',
    SEMUA_BK:            'Semua Guru BK dipilih',
    GURU_PIKET:          'Semua Guru Piket dipilih',
    SEMUA_SISWA:         'Semua Siswa dipilih',
    SISWA_KELAS:         'Siswa Semua Kelas dipilih',
    SISWA_JURUSAN:       'Siswa Semua Jurusan dipilih',
    SEMUA_ORTU:          'Semua Ortu dipilih',
    ORTU_KELAS:          'Ortu Semua Kelas dipilih',
    ORTU_JURUSAN:        'Ortu Semua Jurusan dipilih',
    SEMUA_TU:            'Semua TU dipilih',
    KEPSEK:              'Kepsek dipilih',
};

// ─── Panel Penerima — State Picker ────────────────────────────
let _pickerGroupDef   = null;
let _pickerCandidates = [];
let _pickerSelected   = new Map();

// ─── Bangun Tombol Grup Penerima ─────────────────────────────
function buildRecipientGroupButtons() {
    const scope = _forumScope;
    const container = document.getElementById('forum-recipient-group-btns');
    container.innerHTML = '';
    container.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;';

    const isKepsek  = scope?.is_kepsek || scope?.role_type === 'KEPSEK';
    const isWaka    = scope?.is_waka_kurikulum || scope?.is_waka_kesiswaan
                   || scope?.is_waka_humas
                   || ['WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'].includes(scope?.role_type);
    const isKaprodi = !!scope?.kaprodi_program_id || scope?.role_type === 'KAPRODI';
    const isTU      = scope?.role_type === 'TU';
    const isAdmin   = scope?.role_type === 'ADMINISTRATIVE';

    let groups = [];

    if (isKepsek || isWaka || isAdmin) {
        // Bug #7: tambah Guru Wali
        groups = [
            { label: 'Guru',          group: 'SEMUA_GURU',       hasIndividual: true, pickerGroup: 'GURU_MAPEL' },
            { label: 'Waka',          group: 'SEMUA_WAKA',       hasIndividual: true, needsJabatan: true },
            { label: 'Kaprodi',       group: 'SEMUA_KAPRODI',    hasIndividual: true },
            { label: 'Wali Kelas',    group: 'SEMUA_WALI_KELAS', hasIndividual: true, isDrillDownWaliKelas: true, labelSemua: 'Semua Wali Kelas'    },
            { label: 'Guru Wali',     group: 'SEMUA_GURU_WALI',  hasIndividual: true  },
            { label: 'Guru BK',       group: 'SEMUA_BK',         hasIndividual: true  },
            { label: 'Guru Piket',    group: 'GURU_PIKET',       hasIndividual: true, isDrillDownPiket: true },
            { label: 'Semua Siswa',   group: 'SEMUA_SISWA',      hasIndividual: false, labelSemua: 'Semua Siswa' },
            { label: 'Semua Ortu',    group: 'SEMUA_ORTU',       hasIndividual: false, labelSemua: 'Semua Ortu'  },
            { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
            { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
            { label: 'TU',    group: 'SEMUA_TU',         hasIndividual: true  },
            ...(isKepsek ? [] : [{ label: 'Kepsek', group: 'KEPSEK', hasIndividual: false, labelSemua: 'Kepsek' }]),
        ];
    } else if (isKaprodi) {
        // Bug #3: Guru Jurusan pakai GURU_MAPEL (bukan SEMUA_GURU) agar filter programId efektif
        // Bug #4: tambah grup Kaprodi (sesama kaprodi)
        // Bug #7: tambah Guru Wali dan Siswa Kelas, Ortu Kelas
        groups = [
            { label: 'Guru Jurusan',     group: 'GURU_MAPEL',          hasIndividual: true, programId: scope.kaprodi_program_id },
            { label: 'Wali Kls Jurusan', group: 'WALI_KELAS_JURUSAN',  hasIndividual: true, labelSemua: 'Semua Wali Kelas Jurusan' },
            { label: 'Guru Wali',        group: 'SEMUA_GURU_WALI',     hasIndividual: true  },
            { label: 'Guru BK',          group: 'SEMUA_BK',            hasIndividual: true  },
            { label: 'Kaprodi',          group: 'SEMUA_KAPRODI',       hasIndividual: true },
            { label: 'Kepsek',           group: 'KEPSEK',              hasIndividual: false, labelSemua: 'Kepsek' },
            { label: 'Waka',             group: 'SEMUA_WAKA',          hasIndividual: true, needsJabatan: true },
            { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
            { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
            { label: 'TU',       group: 'SEMUA_TU',            hasIndividual: true  },
        ];
    } else {
        // Bug #5: tambah Semua Siswa
        // Bug #7: tambah Guru Wali
        groups = [
            { label: 'Kepsek',        group: 'KEPSEK',           hasIndividual: false, labelSemua: 'Kepsek' },
            { label: 'Waka',          group: 'SEMUA_WAKA',       hasIndividual: true, needsJabatan: true },
            { label: 'Kaprodi',       group: 'SEMUA_KAPRODI',    hasIndividual: true },
            { label: 'Guru',          group: 'SEMUA_GURU',       hasIndividual: true, pickerGroup: 'GURU_MAPEL' },
            { label: 'Wali Kelas',    group: 'SEMUA_WALI_KELAS', hasIndividual: true, isDrillDownWaliKelas: true, labelSemua: 'Semua Wali Kelas'    },
            { label: 'Guru Wali',     group: 'SEMUA_GURU_WALI',  hasIndividual: true  },
            { label: 'Guru BK',       group: 'SEMUA_BK',         hasIndividual: true  },
            { label: 'Guru Piket',    group: 'GURU_PIKET',       hasIndividual: true, isDrillDownPiket: true },
            { label: 'Semua Siswa',   group: 'SEMUA_SISWA',      hasIndividual: false, labelSemua: 'Semua Siswa' },
            { label: 'Semua Ortu',    group: 'SEMUA_ORTU',       hasIndividual: false, labelSemua: 'Semua Ortu'  },
            { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
            { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
            { label: 'TU',    group: 'SEMUA_TU',         hasIndividual: true  },
        ];
    }

    const rendered = new Set();
    groups.forEach(g => {
        if (rendered.has(g.group)) return;

        if (g.isDrillDown || g.isDrillDownPiket || g.isDrillDownWaliKelas) {
            const isPickOnly = g.isDrillDown;
            if (isPickOnly) {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;width:100%;gap:4px;margin-bottom:6px';
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary';
                btn.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px)';
                btn.textContent = g.labelSemua ?? g.label;
                btn.addEventListener('click', () => addRecipientGroup(g, btn));
                wrap.appendChild(btn);
                container.appendChild(wrap);
                return;
            }
            // isDrillDownPiket / isDrillDownWaliKelas → tetap render via path hasIndividual di bawah
        }

        // SEMUA_SISWA + SEMUA_ORTU → satu baris berdampingan
        if (g.group === 'SEMUA_SISWA') {
            const ortu = groups.find(x => x.group === 'SEMUA_ORTU');
            if (ortu) {
                rendered.add('SEMUA_ORTU');
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;width:100%;gap:4px;margin-bottom:6px';
                [g, ortu].forEach(entry => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-secondary';
                    btn.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px)';
                    btn.textContent = entry.labelSemua ?? `Semua ${entry.label}`;
                    btn.addEventListener('click', () => addRecipientGroup({ ...entry, mode: 'semua' }, btn));
                    wrap.appendChild(btn);
                });
                container.appendChild(wrap);
                return;
            }
        }

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;width:100%;gap:4px;margin-bottom:6px';

        const btnAll = document.createElement('button');
        btnAll.className = 'btn btn-secondary';
        btnAll.style.cssText = g.hasIndividual
            ? 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px);border-radius:6px 0 0 6px'
            : 'width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px)';
        btnAll.textContent = g.labelSemua ?? `Semua ${g.label}`;
        btnAll.addEventListener('click', () => addRecipientGroup({ ...g, mode: 'semua' }, btnAll));
        wrap.appendChild(btnAll);

        if (g.hasIndividual) {
            const btnPick = document.createElement('button');
            btnPick.className = 'btn btn-secondary';
            btnPick.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px);border-radius:0 6px 6px 0;border-left:1px solid var(--color-border)';
            btnPick.textContent = `${g.label} tertentu`;
            btnPick.addEventListener('click', () => addRecipientGroup({ ...g, mode: 'tertentu' }, btnPick));
            wrap.appendChild(btnPick);
        }

        container.appendChild(wrap);
    });
}

// ─── Tambah Grup Penerima ─────────────────────────────────────
async function addRecipientGroup(groupDef, btnEl = null) {
    const errEl = document.getElementById('forum-post-error');
    errEl.style.display = 'none';
    document.getElementById('forum-filter-jurusan-wrap').style.display = 'none';
    document.getElementById('forum-filter-kelas-wrap').style.display   = 'none';
    document.getElementById('forum-filter-hari-wrap').style.display    = 'none';

    if (groupDef.isDrillDown) {
        openDrillDownPicker(groupDef.group, btnEl);
        return;
    }
    if (groupDef.isDrillDownPiket && groupDef.mode === 'tertentu') {
        openDrillDownPiketPicker();
        return;
    }
    if (groupDef.isDrillDownWaliKelas && groupDef.mode === 'tertentu') {
        openDrillDownWaliKelasPicker();
        return;
    }

    // Toggle: klik kedua pada grup yang sudah aktif → batalkan pilihan
    if (groupDef.mode === 'semua' && _forumGroupLabels.has(groupDef.group)) {
        _forumGroupUids.get(groupDef.group)?.forEach(uid => _forumRecipients.delete(uid));
        _forumGroupLabels.delete(groupDef.group);
        _forumGroupUids.delete(groupDef.group);
        if (btnEl) btnEl.className = 'btn btn-secondary';
        _forumGroupBtns.delete(groupDef.group);
        renderRecipientChips();
        return;
    }

    let programId = groupDef.programId ?? null;
    let classId   = null;
    let dayOfWeek = null;

    if (groupDef.needsJurusan && groupDef.mode === 'semua') {
        const wrap = document.getElementById('forum-filter-jurusan-wrap');
        const sel  = document.getElementById('forum-filter-jurusan');
        if (wrap.style.display === 'none' || wrap.style.display === '') {
            wrap.style.display = 'block'; return;
        }
        if (!sel.value) { errEl.textContent = 'Pilih jurusan dulu.'; errEl.style.display = 'block'; return; }
        programId = sel.value;
    }
    if (groupDef.needsKelas && groupDef.mode === 'semua') {
        const wrap = document.getElementById('forum-filter-kelas-wrap');
        const sel  = document.getElementById('forum-filter-kelas');
        if (wrap.style.display === 'none' || wrap.style.display === '') {
            wrap.style.display = 'block'; return;
        }
        if (!sel.value) { errEl.textContent = 'Pilih kelas dulu.'; errEl.style.display = 'block'; return; }
        classId = sel.value;
    }
    if (groupDef.needsHari && groupDef.mode === 'semua') {
        const wrap = document.getElementById('forum-filter-hari-wrap');
        const sel  = document.getElementById('forum-filter-hari');
        if (wrap.style.display === 'none' || wrap.style.display === '') {
            wrap.style.display = 'block'; return;
        }
        if (!sel.value) { errEl.textContent = 'Pilih hari dulu.'; errEl.style.display = 'block'; return; }
        dayOfWeek = parseInt(sel.value, 10);
    }

    if (groupDef.mode === 'semua') {
        try {
            const candidates = await getForumRecipientCandidates(groupDef.group, {
                programId, classId, dayOfWeek,
                academicYear: config.current_academic_year,
            });
            // Jika grup sudah ada, hapus uid lama dulu sebelum re-add
            if (_forumGroupUids.has(groupDef.group)) {
                _forumGroupUids.get(groupDef.group).forEach(uid => _forumRecipients.delete(uid));
                const oldBtn = _forumGroupBtns.get(groupDef.group);
                if (oldBtn) oldBtn.className = 'btn btn-secondary';
            }
            candidates.forEach(c => _forumRecipients.set(c.user_id, c));
            _forumGroupLabels.set(groupDef.group,
                GROUP_LABELS[groupDef.group] ?? `${groupDef.labelSemua ?? 'Semua ' + groupDef.label} dipilih`);
            _forumGroupBtns.set(groupDef.group, btnEl);
            _forumGroupUids.set(groupDef.group, new Set(candidates.map(c => c.user_id)));
            if (btnEl) btnEl.className = 'btn btn-primary';
            renderRecipientChips();
        } catch (err) {
            errEl.textContent = fe(err);
            errEl.style.display = 'block';
        }
    } else {
        await openRecipientPicker({
            ...groupDef,
            group: groupDef.pickerGroup ?? groupDef.group,
        });
    }
}

// ─── Modal Picker ─────────────────────────────────────────────
async function openRecipientPicker(groupDef) {
    _pickerGroupDef   = groupDef;
    _pickerSelected   = new Map();
    _pickerCandidates = [];

    const modal    = document.getElementById('modal-forum-picker');
    const titleEl  = document.getElementById('picker-title');
    const listEl   = document.getElementById('picker-list');
    const errEl    = document.getElementById('picker-error');
    const searchEl = document.getElementById('picker-search');

    titleEl.textContent = `Pilih ${groupDef.label} tertentu`;
    listEl.innerHTML    = '';
    listEl.style.display = 'block';
    document.getElementById('picker-tree').style.display = 'none';
    delete modal.dataset.drillMode;
    searchEl.value      = '';
    errEl.style.display = 'none';

    document.getElementById('picker-filter-jabatan-wrap').style.display =
        groupDef.needsJabatan ? 'block' : 'none';
    document.getElementById('picker-filter-jurusan-wrap').style.display =
        groupDef.needsJurusan ? 'block' : 'none';
    document.getElementById('picker-filter-kelas-wrap').style.display =
        groupDef.needsKelas ? 'block' : 'none';
    document.getElementById('picker-filter-hari-wrap').style.display =
        groupDef.needsHari ? 'block' : 'none';

    const selJurPicker = document.getElementById('picker-filter-jurusan');
    selJurPicker.innerHTML = '<option value="">Semua Jurusan</option>';
    _forumPrograms.forEach(p => {
        selJurPicker.insertAdjacentHTML('beforeend',
            `<option value="${p.program_id}">${esc(p.name)}</option>`);
    });

    const selKlsPicker = document.getElementById('picker-filter-kelas');
    selKlsPicker.innerHTML = '<option value="">Semua Kelas</option>';
    _forumClasses.forEach(c => {
        selKlsPicker.insertAdjacentHTML('beforeend',
            `<option value="${c.class_id}">${esc(c.name)}</option>`);
    });

    modal.style.display = 'flex';
    await loadPickerCandidates();

    _initPickerWiring(modal);
}

async function loadPickerCandidates() {
    const loadEl   = document.getElementById('picker-loading');
    const errEl    = document.getElementById('picker-error');
    const groupDef = _pickerGroupDef;
    if (!groupDef) return;

    let programId = groupDef.programId ?? null;
    let classId   = null;
    let dayOfWeek = null;

    if (groupDef.needsJurusan) {
        programId = document.getElementById('picker-filter-jurusan').value || null;
    }
    if (groupDef.needsKelas) {
        classId = document.getElementById('picker-filter-kelas').value || null;
    }
    if (groupDef.needsHari) {
        const v = document.getElementById('picker-filter-hari').value;
        dayOfWeek = v ? parseInt(v, 10) : null;
    }

    loadEl.style.display = 'block';
    errEl.style.display  = 'none';

    try {
        _pickerCandidates = await getForumRecipientCandidates(groupDef.group, {
            programId, classId, dayOfWeek,
            academicYear: config.current_academic_year,
        });
        renderPickerList();
    } catch (err) {
        errEl.textContent   = fe(err);
        errEl.style.display = 'block';
    } finally {
        loadEl.style.display = 'none';
    }
}

function renderPickerList() {
    const listEl    = document.getElementById('picker-list');
    const searchVal = document.getElementById('picker-search').value.toLowerCase();
    const jabatan   = document.getElementById('picker-filter-jabatan')?.value ?? '';

    let filtered = _pickerCandidates;

    if (searchVal) {
        filtered = filtered.filter(c =>
            c.full_name.toLowerCase().includes(searchVal));
    }

    if (jabatan && _pickerGroupDef?.needsJabatan) {
        filtered = filtered.filter(c => c.role_label === jabatan);
    }

    if (!filtered.length) {
        listEl.innerHTML = '<p class="hint" style="padding:8px">Tidak ada hasil.</p>';
        return;
    }

    listEl.innerHTML = filtered.map(c => {
        const checked = _pickerSelected.has(c.user_id);
        const roleLabel = c.extra_info
            ? `${c.role_label} · ${esc(c.extra_info)}`
            : esc(c.role_label ?? '');
        return `
        <label style="display:flex;align-items:center;gap:8px;padding:8px;
                      cursor:pointer;border-bottom:1px solid var(--color-border)">
            <input type="checkbox" data-uid="${c.user_id}"
                   ${checked ? 'checked' : ''}
                   style="width:16px;height:16px;flex-shrink:0">
            <div>
                <div style="font-size:14px">${esc(c.full_name)}</div>
                <div class="hint" style="font-size:12px">${roleLabel}</div>
            </div>
        </label>`;
    }).join('');

    listEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const uid = cb.dataset.uid;
            const candidate = _pickerCandidates.find(c => c.user_id === uid);
            if (!candidate) return;
            if (cb.checked) {
                _pickerSelected.set(uid, candidate);
            } else {
                _pickerSelected.delete(uid);
            }
        });
    });
}

function closeRecipientPicker() {
    document.getElementById('modal-forum-picker').style.display = 'none';
    _pickerGroupDef   = null;
    _pickerCandidates = [];
}

function _initPickerWiring(modal) {
    if (modal.dataset.wired) return;
    modal.dataset.wired = '1';
    document.getElementById('btn-picker-batal').addEventListener('click', () => {
        if (modal.dataset.drillMode === '1') closeDrillDownPicker();
        else if (modal.dataset.drillMode === 'piket') closeDrillDownPiketPicker();
        else if (modal.dataset.drillMode === 'wali') closeDrillDownWaliKelasPicker();
        else closeRecipientPicker();
    });
    modal.addEventListener('click', e => {
        if (e.target === e.currentTarget) {
            if (modal.dataset.drillMode === '1') closeDrillDownPicker();
            else if (modal.dataset.drillMode === 'piket') closeDrillDownPiketPicker();
            else if (modal.dataset.drillMode === 'wali') closeDrillDownWaliKelasPicker();
            else closeRecipientPicker();
        }
    });
    document.getElementById('picker-search').addEventListener('input', () => {
        if (modal.dataset.drillMode === '1') renderDrillTree();
        else if (modal.dataset.drillMode === 'piket') renderPiketTree();
        else if (modal.dataset.drillMode === 'wali') renderWaliKelasTree();
        else renderPickerList();
    });
    document.getElementById('picker-filter-jabatan').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-jurusan').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-kelas').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-hari').addEventListener('change', loadPickerCandidates);
    document.getElementById('btn-picker-tambahkan').addEventListener('click', () => {
        if (modal.dataset.drillMode === '1') {
            submitDrillDown();
        } else if (modal.dataset.drillMode === 'piket') {
            submitDrillDownPiket();
        } else if (modal.dataset.drillMode === 'wali') {
            submitWaliKelasDrillDown();
        } else {
            _pickerSelected.forEach((c, uid) => _forumRecipients.set(uid, c));
            renderRecipientChips();
            closeRecipientPicker();
        }
    });
}

// ─── Drill-down Picker (SISWA_DRILL / ORTU_DRILL) ─────────────
function openDrillDownPicker(drillType) {
    _drillType = drillType;
    _drillExpanded.clear();
    _drillJurusanAll.clear();
    _drillKelasAll.clear();
    _drillIndividu.clear();
    _drillKelasExpanded.clear();
    _drillKelasData.clear();
    _drillJurusanCount.clear();
    _drillKelasCount.clear();

    const modal = document.getElementById('modal-forum-picker');
    modal.dataset.drillMode = '1';
    modal.style.display = 'flex';

    document.getElementById('picker-title').textContent =
        drillType === 'SISWA_DRILL' ? 'Pilih Siswa Tertentu' : 'Pilih Orang Tua Tertentu';
    document.getElementById('picker-search').value = '';
    document.getElementById('picker-list').style.display = 'none';
    document.getElementById('picker-loading').style.display = 'none';
    document.getElementById('picker-error').style.display = 'none';
    ['picker-filter-jabatan-wrap','picker-filter-jurusan-wrap',
     'picker-filter-kelas-wrap','picker-filter-hari-wrap'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });

    _initPickerWiring(modal);
    renderDrillTree();
}

function renderDrillTree() {
    const tree       = document.getElementById('picker-tree');
    const searchText = (document.getElementById('picker-search')?.value ?? '').toLowerCase().trim();
    tree.style.display = 'block';
    tree.innerHTML = '';

    if (_forumPrograms.length === 0) {
        tree.textContent = 'Tidak ada data jurusan.';
        return;
    }

    _forumPrograms.forEach(prog => {
        const expanded = _drillExpanded.has(prog.program_id);
        const jurAll     = _drillJurusanAll.has(prog.program_id);
        const jurClasses = _forumClasses.filter(c => c.program_id === prog.program_id);
        const indCnt     = [..._drillIndividu.values()].filter(c => c._programId === prog.program_id).length;
        let selCount;
        if (jurAll) {
            selCount = _drillJurusanCount.has(prog.program_id)
                ? _drillJurusanCount.get(prog.program_id)
                : jurClasses.reduce((s, c) => s + (_drillKelasData.get(c.class_id)?.length ?? 0), 0);
        } else {
            const klsTotalCnt = jurClasses.reduce((s, c) => {
                if (!_drillKelasAll.has(c.class_id)) return s;
                return s + (_drillKelasCount.has(c.class_id)
                    ? _drillKelasCount.get(c.class_id)
                    : (_drillKelasData.get(c.class_id)?.length ?? 0));
            }, 0);
            selCount = klsTotalCnt + indCnt;
        }

        const node = document.createElement('div');
        node.style.cssText = 'border-bottom:1px solid var(--color-border)';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:10px;color:var(--color-muted);min-width:12px';
        arrow.textContent = expanded ? '▼' : '▶';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-weight:500';
        lbl.textContent = prog.name;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--color-primary);font-weight:500';
        badge.textContent = selCount > 0 ? `${selCount} dipilih` : '';
        hdr.append(arrow, lbl, badge);
        hdr.addEventListener('click', () => {
            if (_drillExpanded.has(prog.program_id)) _drillExpanded.delete(prog.program_id);
            else _drillExpanded.add(prog.program_id);
            renderDrillTree();
        });
        node.appendChild(hdr);

        if (expanded) {
            const sub = document.createElement('div');
            sub.style.cssText = 'padding-left:16px;padding-bottom:8px';

            // Checkbox "Semua [jurusan]"
            const jurRow = document.createElement('label');
            jurRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer';
            const jurCb = document.createElement('input');
            jurCb.type    = 'checkbox';
            jurCb.checked = jurAll;
            jurCb.addEventListener('change', async () => {
                if (jurCb.checked) {
                    _drillJurusanAll.add(prog.program_id);
                    _forumClasses.filter(c => c.program_id === prog.program_id)
                        .forEach(c => _drillKelasAll.delete(c.class_id));
                    for (const [uid, c] of _drillIndividu.entries()) {
                        if (c._programId === prog.program_id) _drillIndividu.delete(uid);
                    }
                    renderDrillTree();
                    if (!_drillJurusanCount.has(prog.program_id)) {
                        try {
                            const tJur = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_JURUSAN' : 'ORTU_PER_JURUSAN';
                            const list = await getForumRecipientCandidates(tJur, {
                                programId: prog.program_id, academicYear: config.current_academic_year,
                            });
                            _drillJurusanCount.set(prog.program_id, list.length);
                        } catch (_) {
                            _drillJurusanCount.set(prog.program_id, 0);
                        }
                        renderDrillTree();
                    }
                } else {
                    _drillJurusanAll.delete(prog.program_id);
                    renderDrillTree();
                }
            });
            const jurLbl = document.createElement('span');
            jurLbl.style.cssText = 'font-size:13px';
            jurLbl.textContent = `Semua ${prog.name}`;
            jurRow.append(jurCb, jurLbl);
            sub.appendChild(jurRow);

            // Kelas — masing-masing collapsed by default
            _forumClasses.filter(c => c.program_id === prog.program_id).forEach(cls => {
                const klsExpanded = _drillKelasExpanded.has(cls.class_id);
                const klsAll      = _drillKelasAll.has(cls.class_id);
                const klsData     = _drillKelasData.get(cls.class_id);
                const iCnt        = [..._drillIndividu.values()].filter(c => c._classId === cls.class_id).length;
                const klsSelCnt   = (jurAll || klsAll)
                    ? (_drillKelasCount.has(cls.class_id)
                        ? _drillKelasCount.get(cls.class_id)
                        : (klsData?.length ?? 0))
                    : iCnt;

                const klsNode = document.createElement('div');
                klsNode.style.cssText = 'margin-left:4px';

                const klsHdr = document.createElement('div');
                klsHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;cursor:pointer;user-select:none;border-radius:4px';
                const klsArrow = document.createElement('span');
                klsArrow.style.cssText = 'font-size:9px;color:var(--color-muted);min-width:10px';
                klsArrow.textContent = klsExpanded ? '▼' : '▶';
                const klsLbl = document.createElement('span');
                klsLbl.style.cssText = 'flex:1;font-size:13px';
                klsLbl.textContent = cls.name;
                const klsBadge = document.createElement('span');
                klsBadge.style.cssText = 'font-size:11px;color:var(--color-primary)';
                klsBadge.textContent = klsSelCnt > 0 ? `${klsSelCnt} dipilih` : '';
                klsHdr.append(klsArrow, klsLbl, klsBadge);
                klsHdr.addEventListener('click', () => _toggleDrillKelas(cls.class_id, cls.name, prog.program_id));
                klsNode.appendChild(klsHdr);

                if (klsExpanded) {
                    const klsSub = document.createElement('div');
                    klsSub.style.cssText = 'padding-left:20px;padding-bottom:4px';

                    if (!klsData) {
                        klsSub.innerHTML = '<span style="font-size:12px;color:var(--color-muted)">Memuat…</span>';
                    } else {
                        // Checkbox "Semua [kelas]"
                        const klsAllRow = document.createElement('label');
                        klsAllRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer';
                        const klsAllCb = document.createElement('input');
                        klsAllCb.type     = 'checkbox';
                        klsAllCb.checked  = klsAll || jurAll;
                        klsAllCb.disabled = jurAll;
                        klsAllCb.addEventListener('change', async () => {
                            if (klsAllCb.checked) {
                                _drillKelasAll.add(cls.class_id);
                                for (const [uid, c] of _drillIndividu.entries()) {
                                    if (c._classId === cls.class_id) _drillIndividu.delete(uid);
                                }
                                renderDrillTree();
                                if (!_drillKelasCount.has(cls.class_id) && !_drillKelasData.has(cls.class_id)) {
                                    try {
                                        const tKls = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_KELAS' : 'ORTU_PER_KELAS';
                                        const list = await getForumRecipientCandidates(tKls, {
                                            classId: cls.class_id, academicYear: config.current_academic_year,
                                        });
                                        _drillKelasCount.set(cls.class_id, list.length);
                                    } catch (_) {
                                        _drillKelasCount.set(cls.class_id, 0);
                                    }
                                    renderDrillTree();
                                }
                            } else {
                                _drillKelasAll.delete(cls.class_id);
                                renderDrillTree();
                            }
                        });
                        const klsAllLbl = document.createElement('span');
                        klsAllLbl.style.cssText = 'font-size:12px;font-weight:500';
                        klsAllLbl.textContent = `Semua ${cls.name}`;
                        klsAllRow.append(klsAllCb, klsAllLbl);
                        klsSub.appendChild(klsAllRow);

                        // Individu — filter by search
                        const filtered = searchText
                            ? klsData.filter(c => c.full_name.toLowerCase().includes(searchText))
                            : klsData;
                        filtered.forEach(c => {
                            const row = document.createElement('label');
                            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer';
                            const cb = document.createElement('input');
                            cb.type     = 'checkbox';
                            cb.checked  = jurAll || klsAll || _drillIndividu.has(c.user_id);
                            cb.disabled = jurAll || klsAll;
                            cb.addEventListener('change', () => {
                                if (cb.checked) _drillIndividu.set(c.user_id, c);
                                else _drillIndividu.delete(c.user_id);
                                renderDrillTree();
                            });
                            row.append(cb, document.createTextNode(c.full_name));
                            klsSub.appendChild(row);
                        });
                        if (filtered.length === 0 && searchText) {
                            klsSub.insertAdjacentHTML('beforeend',
                                '<p style="font-size:12px;color:var(--color-muted);padding:4px 0">Tidak ada hasil pencarian</p>');
                        }
                    }
                    klsNode.appendChild(klsSub);
                }
                sub.appendChild(klsNode);
            });

            node.appendChild(sub);
        }
        tree.appendChild(node);
    });
}

async function _toggleDrillKelas(classId, className, programId) {
    if (_drillKelasExpanded.has(classId)) {
        _drillKelasExpanded.delete(classId);
        renderDrillTree();
        return;
    }
    _drillKelasExpanded.add(classId);
    renderDrillTree(); // tampil "Memuat…" dulu
    if (!_drillKelasData.has(classId)) {
        const targetGroup = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_KELAS' : 'ORTU_PER_KELAS';
        try {
            const candidates = await getForumRecipientCandidates(targetGroup, {
                classId,
                academicYear: config.current_academic_year,
            });
            candidates.forEach(c => { c._classId = classId; c._programId = programId; });
            _drillKelasData.set(classId, candidates);
        } catch (_) {
            _drillKelasData.set(classId, []);
        }
        renderDrillTree();
    }
}

async function submitDrillDown() {
    const acYear = config.current_academic_year;
    const tJur   = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_JURUSAN' : 'ORTU_PER_JURUSAN';
    const tKls   = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_KELAS'   : 'ORTU_PER_KELAS';
    const loadEl = document.getElementById('picker-loading');
    const errEl  = document.getElementById('picker-error');
    loadEl.style.display = 'block';
    errEl.style.display  = 'none';

    try {
        await Promise.all([
            ...[..._drillJurusanAll].map(async programId => {
                const prog = _forumPrograms.find(p => p.program_id === programId);
                const list = await getForumRecipientCandidates(tJur, { programId, academicYear: acYear });
                const key  = `${_drillType}_JUR_${programId}`;
                list.forEach(c => _forumRecipients.set(c.user_id, c));
                _forumGroupLabels.set(key, `${prog?.name ?? 'Jurusan'} (semua)`);
                _forumGroupUids.set(key, new Set(list.map(c => c.user_id)));
            }),
            ...[..._drillKelasAll].map(async classId => {
                const cls  = _forumClasses.find(c => c.class_id === classId);
                const list = await getForumRecipientCandidates(tKls, { classId, academicYear: acYear });
                const key  = `${_drillType}_KLS_${classId}`;
                list.forEach(c => _forumRecipients.set(c.user_id, c));
                _forumGroupLabels.set(key, `${cls?.name ?? 'Kelas'} (semua)`);
                _forumGroupUids.set(key, new Set(list.map(c => c.user_id)));
            }),
        ]);
        if (_drillIndividu.size > 0) {
            const key = `${_drillType}_INDIVIDU_${Date.now()}`;
            _drillIndividu.forEach((c, uid) => _forumRecipients.set(uid, c));
            _forumGroupLabels.set(key, `${_drillType === 'SISWA_DRILL' ? 'Siswa' : 'Ortu'} pilihan`);
            _forumGroupUids.set(key, new Set(_drillIndividu.keys()));
        }
        renderRecipientChips();
        closeDrillDownPicker();
    } catch (err) {
        loadEl.style.display = 'none';
        errEl.textContent    = fe(err);
        errEl.style.display  = 'block';
    }
}

function closeDrillDownPicker() {
    const modal = document.getElementById('modal-forum-picker');
    modal.style.display = 'none';
    delete modal.dataset.drillMode;
    document.getElementById('picker-tree').style.display = 'none';
    document.getElementById('picker-list').innerHTML     = '';
    _drillType = null;
    _drillExpanded.clear();
}

// ─── Drill-down Picker Piket ──────────────────────────────────
const _PIKET_HARI = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

function openDrillDownPiketPicker() {
    _drillPiketExpanded.clear();
    _drillPiketHariAll.clear();
    _drillPiketIndividu.clear();
    _drillPiketHariData.clear();
    _drillPiketHariCount.clear();

    const modal = document.getElementById('modal-forum-picker');
    modal.dataset.drillMode = 'piket';
    modal.style.display = 'flex';

    document.getElementById('picker-title').textContent = 'Pilih Guru Piket Tertentu';
    document.getElementById('picker-search').value = '';
    document.getElementById('picker-list').style.display = 'none';
    document.getElementById('picker-loading').style.display = 'none';
    document.getElementById('picker-error').style.display = 'none';
    ['picker-filter-jabatan-wrap','picker-filter-jurusan-wrap',
     'picker-filter-kelas-wrap','picker-filter-hari-wrap'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    _initPickerWiring(modal);
    renderPiketTree();
}

function renderPiketTree() {
    const tree = document.getElementById('picker-tree');
    tree.style.display = 'block';
    tree.innerHTML = '';

    _PIKET_HARI.forEach((hariNama, idx) => {
        const day      = idx + 1;
        const expanded = _drillPiketExpanded.has(day);
        const hariAll  = _drillPiketHariAll.has(day);
        const hariData = _drillPiketHariData.get(day);
        const iCnt     = [..._drillPiketIndividu.values()].filter(c => c._dayOfWeek === day).length;
        const selCount = hariAll
            ? (_drillPiketHariCount.has(day) ? _drillPiketHariCount.get(day) : (hariData?.length ?? 0))
            : iCnt;

        const node = document.createElement('div');
        node.style.cssText = 'border-bottom:1px solid var(--color-border)';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:10px;color:var(--color-muted);min-width:12px';
        arrow.textContent = expanded ? '▼' : '▶';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-weight:500';
        lbl.textContent = hariNama;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--color-primary);font-weight:500';
        badge.textContent = selCount > 0 ? `${selCount} dipilih` : '';
        hdr.append(arrow, lbl, badge);
        hdr.addEventListener('click', () => _togglePiketHari(day));
        node.appendChild(hdr);

        if (expanded) {
            const sub = document.createElement('div');
            sub.style.cssText = 'padding-left:20px;padding-bottom:8px';

            if (!hariData) {
                sub.innerHTML = '<span style="font-size:12px;color:var(--color-muted)">Memuat…</span>';
            } else {
                // Checkbox "Semua Guru Piket [Hari]"
                const allRow = document.createElement('label');
                allRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer';
                const allCb = document.createElement('input');
                allCb.type    = 'checkbox';
                allCb.checked = hariAll;
                allCb.addEventListener('change', async () => {
                    if (allCb.checked) {
                        _drillPiketHariAll.add(day);
                        for (const [uid, c] of _drillPiketIndividu.entries()) {
                            if (c._dayOfWeek === day) _drillPiketIndividu.delete(uid);
                        }
                        renderPiketTree();
                        if (!_drillPiketHariCount.has(day)) {
                            try {
                                const list = await getForumRecipientCandidates('GURU_PIKET', {
                                    dayOfWeek: day, academicYear: config.current_academic_year,
                                });
                                list.forEach(c => { c._dayOfWeek = day; });
                                _drillPiketHariCount.set(day, list.length);
                                if (!_drillPiketHariData.has(day)) _drillPiketHariData.set(day, list);
                            } catch (_) {
                                _drillPiketHariCount.set(day, 0);
                            }
                            renderPiketTree();
                        }
                    } else {
                        _drillPiketHariAll.delete(day);
                        renderPiketTree();
                    }
                });
                const allLbl = document.createElement('span');
                allLbl.style.cssText = 'font-size:13px;font-weight:500';
                allLbl.textContent = `Semua Guru Piket ${hariNama}`;
                allRow.append(allCb, allLbl);
                sub.appendChild(allRow);

                // Individu
                hariData.forEach(c => {
                    const row = document.createElement('label');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer';
                    const cb = document.createElement('input');
                    cb.type     = 'checkbox';
                    cb.checked  = hariAll || _drillPiketIndividu.has(c.user_id);
                    cb.disabled = hariAll;
                    cb.addEventListener('change', () => {
                        if (cb.checked) _drillPiketIndividu.set(c.user_id, c);
                        else _drillPiketIndividu.delete(c.user_id);
                        renderPiketTree();
                    });
                    row.append(cb, document.createTextNode(c.full_name));
                    sub.appendChild(row);
                });
            }
            node.appendChild(sub);
        }
        tree.appendChild(node);
    });
}

async function _togglePiketHari(day) {
    if (_drillPiketExpanded.has(day)) {
        _drillPiketExpanded.delete(day);
        renderPiketTree();
        return;
    }
    _drillPiketExpanded.add(day);
    renderPiketTree();
    if (!_drillPiketHariData.has(day)) {
        try {
            const list = await getForumRecipientCandidates('GURU_PIKET', {
                dayOfWeek: day, academicYear: config.current_academic_year,
            });
            list.forEach(c => { c._dayOfWeek = day; });
            _drillPiketHariData.set(day, list);
        } catch (_) {
            _drillPiketHariData.set(day, []);
        }
        renderPiketTree();
    }
}

async function submitDrillDownPiket() {
    const loadEl = document.getElementById('picker-loading');
    const errEl  = document.getElementById('picker-error');
    loadEl.style.display = 'block';
    errEl.style.display  = 'none';

    try {
        for (const day of _drillPiketHariAll) {
            let list = _drillPiketHariData.get(day);
            if (!list) {
                list = await getForumRecipientCandidates('GURU_PIKET', {
                    dayOfWeek: day, academicYear: config.current_academic_year,
                });
                list.forEach(c => { c._dayOfWeek = day; });
            }
            const key = `GURU_PIKET_${day}`;
            list.forEach(c => _forumRecipients.set(c.user_id, c));
            _forumGroupLabels.set(key, `Guru Piket ${_PIKET_HARI[day - 1]} dipilih`);
            _forumGroupUids.set(key, new Set(list.map(c => c.user_id)));
        }
        if (_drillPiketIndividu.size > 0) {
            const key = `GURU_PIKET_INDIVIDU_${Date.now()}`;
            _drillPiketIndividu.forEach((c, uid) => _forumRecipients.set(uid, c));
            _forumGroupLabels.set(key, 'Guru Piket pilihan');
            _forumGroupUids.set(key, new Set(_drillPiketIndividu.keys()));
        }
        renderRecipientChips();
        closeDrillDownPiketPicker();
    } catch (err) {
        loadEl.style.display = 'none';
        errEl.textContent    = fe(err);
        errEl.style.display  = 'block';
    }
}

function closeDrillDownPiketPicker() {
    const modal = document.getElementById('modal-forum-picker');
    modal.style.display = 'none';
    delete modal.dataset.drillMode;
    document.getElementById('picker-tree').style.display = 'none';
    document.getElementById('picker-list').innerHTML     = '';
    _drillPiketExpanded.clear();
}

// ─── Drill-down Picker Wali Kelas ─────────────────────────────
function openDrillDownWaliKelasPicker() {
    _drillWaliExpanded.clear();
    _drillWaliGradeAll.clear();
    _drillWaliSelected.clear();
    _waliKelasCache = null;

    const modal = document.getElementById('modal-forum-picker');
    modal.dataset.drillMode = 'wali';
    modal.style.display = 'flex';

    document.getElementById('picker-title').textContent = 'Pilih Wali Kelas Tertentu';
    document.getElementById('picker-search').value = '';
    document.getElementById('picker-list').style.display = 'none';
    document.getElementById('picker-loading').style.display = 'block';
    document.getElementById('picker-error').style.display = 'none';
    ['picker-filter-jabatan-wrap','picker-filter-jurusan-wrap',
     'picker-filter-kelas-wrap','picker-filter-hari-wrap'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });

    _initPickerWiring(modal);

    getForumRecipientCandidates('SEMUA_WALI_KELAS', {
        academicYear: config.current_academic_year,
    }).then(list => {
        _waliKelasCache = new Map();
        list.forEach(c => { if (c.extra_info) _waliKelasCache.set(c.extra_info, c); });
        document.getElementById('picker-loading').style.display = 'none';
        renderWaliKelasTree();
    }).catch(err => {
        document.getElementById('picker-loading').style.display = 'none';
        document.getElementById('picker-error').textContent = fe(err);
        document.getElementById('picker-error').style.display = 'block';
    });
}

function renderWaliKelasTree() {
    const tree = document.getElementById('picker-tree');
    tree.style.display = 'block';
    tree.innerHTML = '';

    if (!_waliKelasCache) {
        tree.textContent = 'Memuat…';
        return;
    }

    const grades = [
        { level: 10, label: 'X' },
        { level: 11, label: 'XI' },
        { level: 12, label: 'XII' },
    ];

    grades.forEach(({ level, label }) => {
        const classes    = _forumClasses.filter(c => c.grade_level === level);
        if (!classes.length) return;
        const gradeWali  = classes.map(cls => _waliKelasCache.get(cls.name)).filter(Boolean);
        const expanded   = _drillWaliExpanded.has(level);
        const gradeAll   = _drillWaliGradeAll.has(level);
        const selCnt     = gradeAll
            ? gradeWali.length
            : gradeWali.filter(c => _drillWaliSelected.has(c.user_id)).length;

        const node = document.createElement('div');
        node.style.cssText = 'border-bottom:1px solid var(--color-border)';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:10px;color:var(--color-muted);min-width:12px';
        arrow.textContent = expanded ? '▼' : '▶';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-weight:500';
        lbl.textContent = `Kelas ${label}`;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--color-primary);font-weight:500';
        badge.textContent = selCnt > 0 ? `${selCnt} dipilih` : '';
        hdr.append(arrow, lbl, badge);
        hdr.addEventListener('click', () => {
            if (_drillWaliExpanded.has(level)) _drillWaliExpanded.delete(level);
            else _drillWaliExpanded.add(level);
            renderWaliKelasTree();
        });
        node.appendChild(hdr);

        if (expanded) {
            const sub = document.createElement('div');
            sub.style.cssText = 'padding-left:16px;padding-bottom:8px';

            // Checkbox "Semua Wali Kelas [label]"
            const allRow = document.createElement('label');
            allRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer';
            const allCb = document.createElement('input');
            allCb.type    = 'checkbox';
            allCb.checked = gradeAll;
            allCb.addEventListener('change', () => {
                if (allCb.checked) {
                    _drillWaliGradeAll.add(level);
                    gradeWali.forEach(c => _drillWaliSelected.delete(c.user_id));
                } else {
                    _drillWaliGradeAll.delete(level);
                }
                renderWaliKelasTree();
            });
            const allLbl = document.createElement('span');
            allLbl.style.cssText = 'font-size:13px;font-weight:500';
            allLbl.textContent = `Semua Wali Kelas ${label}`;
            allRow.append(allCb, allLbl);
            sub.appendChild(allRow);

            if (!gradeWali.length) {
                sub.insertAdjacentHTML('beforeend',
                    '<p style="font-size:12px;color:var(--color-muted);padding:4px">Belum ada Wali Kelas.</p>');
            } else {
                gradeWali.forEach(wali => {
                    const row = document.createElement('label');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 4px;cursor:pointer';
                    const cb = document.createElement('input');
                    cb.type     = 'checkbox';
                    cb.checked  = gradeAll || _drillWaliSelected.has(wali.user_id);
                    cb.disabled = gradeAll;
                    cb.addEventListener('change', () => {
                        if (cb.checked) _drillWaliSelected.set(wali.user_id, wali);
                        else _drillWaliSelected.delete(wali.user_id);
                        renderWaliKelasTree();
                    });
                    const nameEl = document.createElement('div');
                    nameEl.innerHTML =
                        `<div style="font-size:13px">${esc(wali.full_name)}</div>` +
                        `<div style="font-size:11px;color:var(--color-muted)">${esc(wali.extra_info ?? '')}</div>`;
                    row.append(cb, nameEl);
                    sub.appendChild(row);
                });
            }
            node.appendChild(sub);
        }
        tree.appendChild(node);
    });
}

async function submitWaliKelasDrillDown() {
    const toAdd = new Map(_drillWaliSelected);
    _drillWaliGradeAll.forEach(level => {
        _forumClasses.filter(c => c.grade_level === level).forEach(cls => {
            const wali = _waliKelasCache?.get(cls.name);
            if (wali) toAdd.set(wali.user_id, wali);
        });
    });
    if (toAdd.size === 0) {
        closeDrillDownWaliKelasPicker();
        return;
    }
    const key = `WALI_KELAS_INDIVIDU_${Date.now()}`;
    toAdd.forEach((c, uid) => _forumRecipients.set(uid, c));
    _forumGroupLabels.set(key, 'Wali Kelas pilihan');
    _forumGroupUids.set(key, new Set(toAdd.keys()));
    renderRecipientChips();
    closeDrillDownWaliKelasPicker();
}

function closeDrillDownWaliKelasPicker() {
    const modal = document.getElementById('modal-forum-picker');
    modal.style.display = 'none';
    delete modal.dataset.drillMode;
    document.getElementById('picker-tree').style.display = 'none';
    document.getElementById('picker-list').innerHTML = '';
    _drillWaliExpanded.clear();
    _drillWaliGradeAll.clear();
}

// ─── Chips Penerima ───────────────────────────────────────────
function renderRecipientChips() {
    const container = document.getElementById('forum-recipient-chips');
    const emptyEl   = document.getElementById('forum-chips-empty');
    const countEl   = document.getElementById('forum-recipient-count');

    container.querySelectorAll('.recipient-chip').forEach(el => el.remove());

    if (_forumRecipients.size === 0 && _forumGroupLabels.size === 0) {
        emptyEl.style.display = 'inline';
        countEl.textContent = '';
        return;
    }
    emptyEl.style.display = 'none';
    countEl.textContent = _forumRecipients.size > 0
        ? `${_forumRecipients.size} penerima dipilih` : '';

    const chipCss = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;' +
        'background:var(--color-bg-alt);border-radius:12px;font-size:12px';
    const btnCss  = 'background:none;border:none;cursor:pointer;padding:0;line-height:1';

    // Satu chip ringkas per grup "Semua X"
    const groupedUids = new Set();
    _forumGroupLabels.forEach((label, groupKey) => {
        const uids = _forumGroupUids.get(groupKey) ?? new Set();
        uids.forEach(uid => groupedUids.add(uid));
        const chip = document.createElement('span');
        chip.className = 'recipient-chip';
        chip.style.cssText = chipCss;
        chip.innerHTML = `${esc(label)} <button style="${btnCss}">\u2715</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            uids.forEach(uid => _forumRecipients.delete(uid));
            _forumGroupLabels.delete(groupKey);
            _forumGroupUids.delete(groupKey);
            const btn = _forumGroupBtns.get(groupKey);
            if (btn) btn.className = 'btn btn-secondary';
            _forumGroupBtns.delete(groupKey);
            renderRecipientChips();
        });
        container.appendChild(chip);
    });

    // Chip individual untuk penerima di luar grup
    _forumRecipients.forEach((r, uid) => {
        if (groupedUids.has(uid)) return;
        const chip = document.createElement('span');
        chip.className = 'recipient-chip';
        chip.style.cssText = chipCss;
        chip.innerHTML = `${esc(r.full_name)} <button data-uid="${uid}" style="${btnCss}">\u2715</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            _forumRecipients.delete(uid);
            renderRecipientChips();
        });
        container.appendChild(chip);
    });
}

async function submitForumPost() {
    const errEl   = document.getElementById('forum-post-error');
    const btnEl   = document.getElementById('btn-forum-modal-simpan');
    const title   = document.getElementById('forum-input-title').value.trim();
    const body    = document.getElementById('forum-input-body').value.trim();
    const fileEl  = document.getElementById('forum-input-file');

    errEl.style.display = 'none';
    const wasEdit = !!_forumEditPostId;   // closeForumModal() mengosongkan _forumEditPostId sebelum blok finally
    if (!title) { errEl.textContent = 'Judul wajib diisi.'; errEl.style.display = 'block'; return; }
    if (!body)  { errEl.textContent = 'Isi posting wajib diisi.'; errEl.style.display = 'block'; return; }
    if (_forumRecipients.size === 0 && !_forumEditPostId) {
        errEl.textContent = 'Pilih minimal satu penerima.';
        errEl.style.display = 'block'; return;
    }

    btnEl.disabled = true;
    btnEl.textContent = 'Mengirim\u2026';

    // FUNC-01: path file yang sudah ter-upload tapi BELUM tereferensi posting
    // manapun. Selama nilainya tidak null, file itu masih calon orphan dan
    // wajib dihapus lagi kalau ada langkah berikutnya yang gagal.
    let uploadedPath = null;
    let postSaved    = false;

    try {
        let attachmentUrl  = null;
        let attachmentName = null;

        if (fileEl.files[0]) {
            const file = fileEl.files[0];
            if (file.size > 10 * 1024 * 1024) {
                errEl.textContent = 'Ukuran file maks. 10 MB.';
                errEl.style.display = 'block'; return;
            }
            const ext = file.name.split('.').pop().toLowerCase();
            const allowedTypes = new Set(['pdf', 'doc', 'docx']);
            const allowedMime = new Set([
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ]);
            if (!allowedTypes.has(ext) || (file.type && !allowedMime.has(file.type))) {
                errEl.textContent = 'Lampiran harus berupa PDF, DOC, atau DOCX.';
                errEl.style.display = 'block'; return;
            }
            const path = `${currentUser.school_id}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('forum-attachments')
                .upload(path, file, { upsert: false });
            // FUNC-01 poin 2: upload gagal → keluar sebelum menyentuh DB.
            if (upErr) throw upErr;
            uploadedPath = path;
            // FORUM-FIX-01: bucket forum-attachments bersifat private, jadi
            // getPublicUrl() menghasilkan URL yang selalu 403 saat diklik.
            // attachment_path yang disimpan cukup -- pembaca membuat signed URL
            // sendiri lewat createSignedUrl() saat membuka detail posting.
            attachmentUrl  = null;
            attachmentName = file.name;
        }

        let attachmentCleanupWarning = false;
        if (_forumEditPostId) {
            // FUNC-01: jalur edit sebelumnya meng-upload file baru tapi TIDAK
            // pernah memasangnya ke posting — orphan permanen di bucket.
            // Ambil path lama dulu supaya file yang digantikan ikut dibersihkan.
            let oldPath = null;
            if (uploadedPath) {
                const { data: oldRow, error: oldErr } = await supabase
                    .from('forum_posts')
                    .select('attachment_path')
                    .eq('post_id', _forumEditPostId)
                    .maybeSingle();
                if (oldErr) throw oldErr;
                oldPath = oldRow?.attachment_path ?? null;
            }
            await updateForumSekolahPost(_forumEditPostId, title, body);
            postSaved = true;
            if (uploadedPath) {
                const newPath = uploadedPath;
                await setForumAttachment(_forumEditPostId, attachmentUrl,
                    attachmentName, newPath);
                uploadedPath = null;   // sudah tereferensi posting — bukan orphan lagi
                if (oldPath && oldPath !== newPath) {
                    const { error: oldCleanupError } = await supabase.storage
                        .from('forum-attachments').remove([oldPath]);
                    if (oldCleanupError) {
                        attachmentCleanupWarning = true;
                        console.warn('[forum] hapus lampiran lama gagal:', oldCleanupError);
                    }
                }
            }
        } else {
            const recipientIds = [..._forumRecipients.keys()];
            // FUNC-03: kunci idempotensi ikut dikirim; retry dengan kunci sama
            // mengembalikan post_id yang sama, tidak membuat duplikat.
            const newPostId = await createForumSekolahPost(title, body, recipientIds,
                config.current_academic_year, _forumIdemKey);
            postSaved = true;
            if (uploadedPath) {
                if (!newPostId) throw new Error('Server tidak mengembalikan ID posting.');
                await setForumAttachment(newPostId, attachmentUrl,
                    attachmentName, uploadedPath);
                uploadedPath = null;   // sudah tereferensi posting — bukan orphan lagi
            }
        }

        closeForumModal();
        if (attachmentCleanupWarning) {
            alert('Posting tersimpan, tetapi lampiran lama belum berhasil dibersihkan. ' +
                'Silakan laporkan kepada administrator.');
        }
        _forumMode = 'terkirim';
        document.getElementById('forum-tab-masuk').className    = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
        _forumCursor = null;
        loadForumPosts();
    } catch (err) {
        // FUNC-01 poin 1: file yang terlanjur ter-upload tapi tidak jadi
        // tereferensi posting manapun dihapus lagi dari storage.
        if (uploadedPath) {
            supabase.storage.from('forum-attachments').remove([uploadedPath])
                .catch(e => console.warn('[forum] cleanup orphan gagal:', e));
            uploadedPath = null;
        }
        // FUNC-01 poin 3: bedakan "gagal kirim" dari "terkirim, lampiran gagal".
        // Menyamakan keduanya membuat penulis mengirim ulang → posting ganda.
        if (postSaved) {
            closeForumModal();
            alert('Posting tersimpan, tetapi lampiran gagal dipasang. ' +
                  'Buka posting lalu edit untuk melampirkan ulang.');
            loadForumPosts();
        } else {
            errEl.textContent = galatJaringanForum(err) ?? fe(err);
            errEl.style.display = 'block';
        }
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = wasEdit ? 'Simpan' : 'Kirim';
    }
}

// ─── Modal Detail ─────────────────────────────────────────────
// Audit Forum A-01: tautan lampiran lama hanya dipasang bila skemanya http/https (bukan javascript:, data:, dst.).
function urlAman(u) { const t = String(u ?? '').trim().toLowerCase(); return (t.startsWith('http://') || t.startsWith('https://')) ? String(u).trim() : null; }

async function openForumDetail(postId) {
    const seq  = ++_forumDetailSeq;   // A-12: respons yang datang sesudah detail lain dibuka/ditutup diabaikan
    const mode = _forumMode;          // A-11: tab asal dikunci saat dibuka
    _forumDetailPost = null;
    const modal = document.getElementById('modal-forum-detail');
    modal.dataset.postId = postId;
    sipPrepareOpen(modal);
    modal.style.display  = 'flex';

    document.getElementById('detail-forum-title').textContent  = 'Memuat\u2026';
    document.getElementById('detail-forum-body').textContent   = '';
    document.getElementById('detail-forum-meta').textContent   = '';
    document.getElementById('detail-forum-attachment').innerHTML = '';
    document.getElementById('detail-forum-comments-list').innerHTML = '';
    document.getElementById('detail-forum-comments-loading').style.display = 'block';
    document.getElementById('forum-author-actions').style.display = 'none';
    document.getElementById('forum-comment-error').style.display  = 'none';
    document.getElementById('forum-comment-input').value = '';

    try {
        const post = mode === 'masuk'
            ? await getForumSekolahPostById(postId, currentUser.school_id, currentUser.user_id)
            : await getForumSekolahSentPostById(postId, currentUser.school_id, currentUser.user_id);
        if (seq !== _forumDetailSeq) return;
        _forumDetailPost = post;

        document.getElementById('detail-forum-title').textContent = post.title;
        document.getElementById('detail-forum-body').textContent  = post.body;

        const time   = new Date(post.created_at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
        const author = post.author?.full_name ?? '\u2014';
        const edited = post.is_edited ? ' \u2022 diedit' : '';
        const withdrawn = post.is_withdrawn ? ' \u2022 Ditarik' : '';
        document.getElementById('detail-forum-meta').textContent = `${author} \u00B7 ${time}${edited}${withdrawn}`;
        modal.dataset.withdrawn = String(post.is_withdrawn === true);

        if (post.attachment_url || post.attachment_path) {
            let attachmentHref = urlAman(post.attachment_url);
            let attachmentError = null;
            if (post.attachment_path) {
                const { data: signed, error: signedError } = await supabase.storage
                    .from('forum-attachments')
                    .createSignedUrl(post.attachment_path, 172800);
                attachmentError = signedError;
                if (signed?.signedUrl) attachmentHref = signed.signedUrl;
            }
            if (seq !== _forumDetailSeq) return;
            const attachmentEl = document.getElementById('detail-forum-attachment');
            if (attachmentHref) {
                attachmentEl.innerHTML =
                    `<a href="${esc(attachmentHref)}" target="_blank" class="btn btn-secondary" style="font-size:13px">
                        \uD83D\uDCCE ${esc(post.attachment_name ?? 'Unduh Lampiran')}
                    </a>`;
            } else {
                if (attachmentError) {
                    attachmentEl.innerHTML =
                        '<span class="hint">Lampiran tersedia, tetapi belum dapat dibuka.</span> ' +
                        '<button type="button" class="btn-link" id="btn-forum-attachment-retry">Coba lagi</button>';
                    document.getElementById('btn-forum-attachment-retry')
                        .addEventListener('click', () => openForumDetail(postId));
                } else {
                    attachmentEl.textContent = 'Lampiran tidak tersedia.';
                }
            }
        }

        // NOTIF-01: ack "posting sudah dibaca" ikut antrean retry.
        // A-11: hanya dari tab Masuk (penerima). Membuka posting sendiri di tab Terkirim bukan "dibaca oleh penerima".
        if (mode === 'masuk') {
            await ackWithRetry(
                'forum_ack',
                { postId, userId: currentUser.user_id, schoolId: currentUser.school_id },
                `forum_ack:${postId}:${currentUser.user_id}`);
            if (seq !== _forumDetailSeq) return;
        }

        const isAuthor = post.author_user_id === currentUser.user_id;
        const isModerator = isForumModerator();
        if (isAuthor || isModerator) {
            document.getElementById('forum-author-actions').style.display = 'block';
            document.getElementById('btn-forum-edit').style.display = isAuthor ? '' : 'none';
            // FORUM-DEL-01: moderator kini boleh menghapus posting siapa pun,
            // sejalan dengan otorisasi di dalam fn_delete_forum_post.
            document.getElementById('btn-forum-delete').style.display =
                isAuthor || isModerator ? '' : 'none';
        }

        await loadForumComments(postId);

    } catch (err) {
        if (seq !== _forumDetailSeq) return;
        document.getElementById('detail-forum-title').textContent = 'Gagal memuat posting.';
        document.getElementById('detail-forum-comments-loading').textContent = fe(err);
    }
}

function closeForumDetail() {
    _forumDetailSeq++;   // A-12: respons yang masih berjalan tidak boleh mengisi modal yang sudah ditutup
    sipCloseOverlay(document.getElementById('modal-forum-detail'));
}

async function loadForumComments(postId) {
    const loadEl = document.getElementById('detail-forum-comments-loading');
    const listEl = document.getElementById('detail-forum-comments-list');
    try {
        const comments = await getForumSekolahComments(postId);
        if (String(document.getElementById('modal-forum-detail').dataset.postId) !== String(postId)) return;   // A-12
        loadEl.style.display = 'none';
        if (!comments.length) {
            listEl.innerHTML = '<p class="hint">Belum ada komentar.</p>';
            return;
        }
        listEl.innerHTML = comments.map(c => {
            const time   = new Date(c.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
            const author = esc(c.author?.full_name ?? '\u2014');
            const isOwn  = c.author_user_id === currentUser.user_id;
            return `
            <div style="padding:8px 0;border-bottom:1px solid var(--color-border)" data-comment-id="${c.comment_id}">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <strong style="font-size:13px">${author}</strong>
                    <span class="hint" style="font-size:11px">${time}
                        ${isOwn ? `<button class="btn-link btn-hapus-komentar" data-cid="${c.comment_id}"
                            style="margin-left:8px;color:var(--color-danger);font-size:11px;
                                   background:none;border:none;cursor:pointer">Hapus</button>` : ''}
                    </span>
                </div>
                <p style="margin:4px 0 0;font-size:14px;white-space:pre-wrap">${esc(c.body)}</p>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.btn-hapus-komentar').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Hapus komentar ini?')) return;
                try {
                    await deleteForumSekolahComment(btn.dataset.cid);
                    await loadForumComments(postId);
                } catch (err) { alert(fe(err)); }
            });
        });
    } catch (err) {
        loadEl.textContent = fe(err);
        loadEl.style.display = 'block';
    }
}

async function submitForumComment() {
    const input  = document.getElementById('forum-comment-input');
    const errEl  = document.getElementById('forum-comment-error');
    const postId = document.getElementById('modal-forum-detail').dataset.postId;
    const body   = input.value.trim();

    errEl.style.display = 'none';
    if (!body) return;
    if (_forumCommentBusy) return;   // A-09: klik ganda/ketukan beruntun tidak boleh membuat komentar ganda
    _forumCommentBusy = true;
    const btn = document.getElementById('btn-forum-comment-submit');
    btn.disabled = true;

    try {
        await addForumSekolahComment(postId, body, currentUser.school_id, currentUser.user_id);
        input.value = '';
        await loadForumComments(postId);
    } catch (err) {
        errEl.textContent = galatJaringanForum(err) ?? fe(err);
        errEl.style.display = 'block';
    } finally {
        _forumCommentBusy = false;
        btn.disabled = false;
    }
}

// ─── Accordion: rekap kehadiran (collapsed by default) ────────
function wireSimpleAccordion(cardId) {
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
