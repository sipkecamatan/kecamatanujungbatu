/**
 * @file guru/js/tab-forum.js
 * Tab Forum Sekolah — buat posting, kirim ke grup penerima, komentar, detail.
 */
import { supabase } from './api.js';
import {
    getForumRecipientCandidates,
    getForumSekolahPosts, getForumSekolahSentPosts,
    getForumSekolahPostById, getForumSekolahSentPostById,
    getForumSekolahComments, createForumSekolahPost, updateForumSekolahPost,
    deleteForumSekolahPost, addForumSekolahComment, deleteForumSekolahComment,
    addForumSekolahAcknowledgement, setForumAttachment,
} from './api.js';
import { ackWithRetry } from '../../shared/ack-queue.js';
import { esc, fe, fmt, fmtTime, localDateStr, sipPrepareOpen, sipCloseOverlay, showInputModal } from './tab-shared.js';

// ── Module state ─────────────────────────────────────────────
let currentUser = null;
let config      = null;

function galatJaringanForum(err) {
    const m = String(err?.message ?? '').toLowerCase();
    const luring = (typeof navigator !== 'undefined' && navigator.onLine === false) || m.includes('failed to fetch') || m.includes('network') || m.includes('load failed');
    return luring ? 'Tidak ada koneksi internet. Tulisan Anda tidak hilang; coba kirim lagi setelah tersambung.' : null;
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
    return ['KEPSEK', 'WAKA_KESISWAAN', 'WAKASEK', 'ADMINISTRATIVE'].includes(currentUser?.role_type)
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
export async function initForumTab({ currentUser: cu, config: c }) {
    currentUser = cu;
    config = c;
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
                   || ['WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','WAKASEK'].includes(scope?.role_type);
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
