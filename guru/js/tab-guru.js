/**
 * @file guru/js/tab-guru.js
 * Tab Guru (jadwal, kehadiran, rekap) dan Tab Observasi.
 * Juga mengekspor: updateSyncBanner, runFlush, ensureStudentPool,
 * serta live-binding myStudents & isBroadObserver untuk kasus engine.
 */
import {
    getMyClasses, getEnrolledStudents,
    getAttendanceSummaryByStudents, getClassAttendanceByDate,
    getMyScheduleForDate, getAttendanceForSession,
    getMyStudents, insertObservation, getMyObservations, voidObservation,
} from './api.js';
import { saveAttendanceBatch, flushPending, pendingCount, rejectedCount } from './offline.js';
import { esc, fe, fmt, fmtTime, buildAttStatCards, sipPrepareOpen, sipCloseOverlay, localDateStr, buildPertemuanMeta } from './tab-shared.js';

// ── Module state ─────────────────────────────────────────────
let _currentUser   = null;
let _config        = null;
let _jabatan       = [];
let _LC            = null;
let _onSyncCb      = null;   // callback pasca-flush sukses (→ segarkanKasusSetelahKirim)

// guru tab
let _guruTabInit     = false;
let _guruRekapRows      = [];
let _guruRekapPage      = 0;
let _guruRekapDateStart = null;
let _guruRekapDateEnd   = null;
let _guruRekapClassName = null;
let _guruRecapSeq       = 0;

// att modal
let _attModalSeq        = 0;
let _attModalFokusAsal  = null;
let _attSavedFlag       = false;

// obs
let _obsFormInit = false;
const OBS_HISTORY_PAGE_SIZE    = 100;
const OBS_HISTORY_DISPLAY_SIZE = 10;
let _obsHistoryRows  = [];
let _obsHistoryTotal = 0;
let _obsHistoryBusy  = false;
let _obsHistoryPage  = 0;   // halaman display saat ini (0-based)

// student pool
export let myStudents      = [];
export let isBroadObserver = false;
let _studentPoolInit       = false;

/** Daftarkan callback yang dipanggil setelah flush berhasil (segarkanKasusSetelahKirim). */
export function setOnSyncCallback(fn) { _onSyncCb = fn; }

// ── Tab Guru ─────────────────────────────────────────────────

export async function initGuruTab({ currentUser, config, jabatan, LC }) {
    _currentUser = currentUser;
    _config      = config;
    _jabatan     = jabatan;
    _LC          = LC;

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
        const today = localDateStr();
        const firstOfMonth = today.slice(0, 8) + '01';
        document.getElementById('guru-recap-start').value = firstOfMonth;
        document.getElementById('guru-recap-end').value   = today;
        await initGuruRekapDropdown();

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
        const classes = await getMyClasses(_currentUser.user_id, _config.current_academic_year, _config.current_semester);
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

    const sorted = [..._guruRekapRows].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
    container.innerHTML = buildAttStatCards(sorted) + sorted
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
        const enrolled = await getEnrolledStudents(classId, _config.current_academic_year, _config.current_semester);
        if (seq !== _guruRecapSeq) return;
        if (enrolled.length === 0) {
            content.innerHTML = '<p class="hint">Belum ada siswa aktif di kelas ini untuk tahun ajaran ini.</p>';
            return;
        }
        const rows = await getAttendanceSummaryByStudents(classId, _config.current_academic_year, dateStart || null, dateEnd || null, _currentUser.user_id);
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

                const classes = await getMyClasses(_currentUser.user_id, _config.current_academic_year, _config.current_semester);
                if (!classes.length) return;

                const wb = XLSX.utils.book_new();
                const usedNames = new Set();

                await Promise.all(classes.map(async (cls) => {
                    const [summary, detail] = await Promise.all([
                        getAttendanceSummaryByStudents(cls.class_id, _config.current_academic_year, null, null, _currentUser.user_id),
                        getClassAttendanceByDate(cls.class_id, _config.current_academic_year, null, null, _currentUser.user_id),
                    ]);

                    const { sortedIds, labelById } = buildPertemuanMeta(detail);

                    const pivot = {};
                    for (const r of detail) {
                        if (!r.block_group_id) continue;
                        if (!pivot[r.student_id]) pivot[r.student_id] = {};
                        const prev = pivot[r.student_id][r.block_group_id];
                        if (prev === undefined || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
                            pivot[r.student_id][r.block_group_id] = r.status;
                    }

                    const roster   = [...summary].sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
                    const header   = ['No', 'Nama', ...sortedIds.map(id => labelById.get(id)), 'Persentase'];
                    const dataRows = roster.map((s, idx) => {
                        const tot = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                        const pct = tot > 0 ? Math.round(s.HADIR / tot * 100) + '%' : '—';
                        return [idx + 1, s.full_name, ...sortedIds.map(id => STATUS_HURUF[pivot[s.student_id]?.[id]] ?? ''), pct];
                    });

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

// ── Jadwal ───────────────────────────────────────────────────

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
        const lastSubject    = (last?.subject_label ?? '').trim().toLocaleLowerCase();
        const currentSubject = (s.subject_label ?? '').trim().toLocaleLowerCase();
        const sameBlock = last
            && last.class?.class_id === s.class?.class_id
            && lastSubject === currentSubject
            && isConsecutive(last.merged_end, s.session_start);
        if (sameBlock) {
            last.merged_end = s.session_end;
            last.schedule_ids.push(s.schedule_id);
        } else {
            merged.push({ ...s, merged_start: s.session_start, merged_end: s.session_end, schedule_ids: [s.schedule_id] });
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
    const seq   = ++_attModalSeq;
    _attModalFokusAsal = document.activeElement;
    const modal  = document.getElementById('att-modal');
    const isPast = btn.dataset.ispast === 'true';
    document.getElementById('att-modal-title').textContent =
        isPast ? `Koreksi Kehadiran — ${btn.dataset.classname}` : `Kehadiran — ${btn.dataset.classname}`;
    document.getElementById('att-modal-body').innerHTML =
        (isPast ? '<p class="hint" style="background:var(--color-bg-alt);padding:8px 10px;border-radius:6px;margin-bottom:12px">Data kehadiran sebelumnya sudah ditampilkan. Ubah jika perlu lalu klik Simpan.</p>' : '') +
        '<p class="hint">Memuat daftar siswa…</p>';
    sipPrepareOpen(modal);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('att-modal-close')?.focus();
    loadAttModalContent(btn.dataset.schedule, btn.dataset.class, btn.dataset.classname, seq);
}

function closeAttModal(saved = false) {
    _attModalSeq++;
    sipCloseOverlay(document.getElementById('att-modal'));
    document.body.style.overflow = '';
    try { _attModalFokusAsal?.focus?.(); } catch (_) { /* elemen sudah tidak ada */ }
    _attModalFokusAsal = null;
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
    const cacheKey  = `sched-${_currentUser.user_id}-${date}`;

    const cached = _LC.get(cacheKey);
    if (cached) {
        renderScheduleRows(cached, contentEl, date);
    } else {
        contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    }

    try {
        const rows = await getMyScheduleForDate(_currentUser.user_id, date);
        _LC.set(cacheKey, rows);
        renderScheduleRows(rows, contentEl, date);
    } catch (err) {
        if (!cached) {
            contentEl.innerHTML = `<div class="status-err">Gagal memuat data. ${esc(fe(err))}</div>`;
        }
    }
}

async function loadWeekSchedule() {
    const contentEl = document.getElementById('sched-week-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal minggu ini…</p>';

    const today = new Date();
    const dow   = today.getDay();
    const diff  = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);

    const days = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return localDateStr(d);
    });

    try {
        const results = await Promise.all(
            days.map(d => getMyScheduleForDate(_currentUser.user_id, d)
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
            if (idx === 5 && !r.error && r.rows.length === 0) return '';
            const dayLabel   = `${DAY_NAMES[idx]}, ${fmtDayLabel(r.date).split(',')[1]?.trim() ?? r.date}`;
            const isToday    = r.date === todayStr;
            const mergedSessions = r.error ? [] : mergeConsecutiveSessions(r.rows);
            const sesiCount  = mergedSessions.length;
            const tableHtml  = r.error
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
            getEnrolledStudents(classId, _config.current_academic_year, _config.current_semester),
            getAttendanceForSession(scheduleId),
        ]);
        if (seq !== _attModalSeq) return;

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
                    <div class="att-name">${esc(s.full_name)}</div>
                    <div class="att-radio-group">${radios}</div>
                    <input type="text" id="notes_${scheduleId}_${s.student_id}"
                           class="input att-notes-input"
                           placeholder="Alasan izin (opsional)…"
                           value="${esc(curNotes)}"
                           style="display:${cur === 'IZIN' ? 'block' : 'none'}; margin-top:4px; width:100%; font-size:0.85em">
                </div>`;
        }

        const CHUNK = 5;
        const chunks = [];
        for (let i = 0; i < students.length; i += CHUNK)
            chunks.push(students.slice(i, i + CHUNK));

        const slidesHtml = chunks.map(group => `
            <div class="att-carousel-slide">${group.map(renderStudentRow).join('')}</div>`).join('');

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
    const saveBtn    = document.querySelector(`.att-save[data-schedule="${scheduleId}"]`);
    const statusEl   = document.getElementById(`att-status-${scheduleId}`);
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
            submitted_by:    _currentUser.user_id,
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

// ── Sinkronisasi offline ──────────────────────────────────────

export async function updateSyncBanner() {
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

export async function runFlush() {
    try {
        const { synced, remaining, sessionExpired } = await flushPending();
        if (synced > 0) console.log(`[offline] ${synced} item tersinkron`);
        if (sessionExpired) { showSessionExpiredBanner(); return remaining; }
        await updateSyncBanner();
        if (synced > 0 && _onSyncCb) _onSyncCb().catch(() => {});
        return remaining;
    } catch (e) { console.warn('[offline] flush gagal:', e); }
}

// ── Student pool ──────────────────────────────────────────────

export async function ensureStudentPool() {
    if (_studentPoolInit) return;
    isBroadObserver = _jabatan.some(j => ['bk', 'waka_kesiswaan', 'kepsek'].includes(j));
    const stuCacheKey = `mystudents-${_currentUser.user_id}`;
    myStudents = _LC.get(stuCacheKey) ?? [];
    try {
        const fresh = await getMyStudents(
            _currentUser.user_id,
            _config.current_academic_year,
            _config.current_semester
        );
        myStudents = fresh;
        _LC.set(stuCacheKey, fresh);
        _studentPoolInit = true;
    } catch (err) {
        _studentPoolInit = false;
        throw err;
    }
}

// ── Observasi ─────────────────────────────────────────────────

async function initObsForm() {
    if (_obsFormInit) return;
    try {
        await ensureStudentPool();
    } catch (err) {
        const statusEl    = document.getElementById('obs-status');
        const submitBtn   = document.getElementById('obs-submit');
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
    populateStudentSelect(classFilterEl.value);

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
        if (obsContentEl.value.trim().length < 10) {
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
                authorId:   _currentUser.user_id,
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
            obsCharCountEl.textContent = '0';
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

export async function initObsTab({ currentUser, config, jabatan, LC }) {
    _currentUser = currentUser;
    _config      = config;
    _jabatan     = jabatan;
    _LC          = LC;

    await initObsForm();
    _initObsHistoryCollapse();
    const moreBtn = document.getElementById('obs-history-more');
    if (moreBtn && moreBtn.dataset.wired !== '1') {
        moreBtn.dataset.wired = '1';
        moreBtn.addEventListener('click', loadMoreObsHistory);
    }
    await loadObsHistory();
}

function _initObsHistoryCollapse() {
    const listEl  = document.getElementById('obs-history-list');
    const moreWrap = document.getElementById('obs-history-more')?.parentElement;
    const h3 = listEl?.closest('.section-card')?.querySelector('h3');
    if (!h3 || h3.dataset.collapseWired) return;
    h3.dataset.collapseWired = '1';

    // Chevron di sebelah kanan judul
    const chevron = document.createElement('span');
    chevron.style.cssText = 'font-size:10px;color:var(--color-text-muted);transition:transform .18s;float:right;margin-top:2px';
    chevron.textContent = '▶';
    h3.style.cursor = 'pointer';
    h3.appendChild(chevron);

    // Konten tersembunyi secara default
    const collapseEls = [listEl, document.getElementById('obs-history-kelas-filter'), moreWrap].filter(Boolean);
    collapseEls.forEach(el => { el.style.display = 'none'; });
    let terbuka = false;

    h3.addEventListener('click', () => {
        terbuka = !terbuka;
        const filterEl = document.getElementById('obs-history-kelas-filter');
        [listEl, filterEl, moreWrap].filter(Boolean).forEach(el => {
            el.style.display = terbuka ? '' : 'none';
        });
        chevron.style.transform = terbuka ? 'rotate(90deg)' : '';
    });
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
    const cacheKey = `obs-history-${_currentUser.user_id}`;
    const cached   = _LC.get(cacheKey);
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
        const result = await getMyObservations(_currentUser.user_id, {
            limit: OBS_HISTORY_PAGE_SIZE,
            offset: 0,
        });
        _obsHistoryRows  = result.rows;
        _obsHistoryTotal = result.total;
        _LC.set(cacheKey, result);
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
        const result = await getMyObservations(_currentUser.user_id, {
            limit: OBS_HISTORY_PAGE_SIZE,
            offset: _obsHistoryRows.length,
        });
        _obsHistoryRows  = [..._obsHistoryRows, ...result.rows];
        _obsHistoryTotal = result.total;
        _LC.set(`obs-history-${_currentUser.user_id}`, {
            rows: _obsHistoryRows,
            total: _obsHistoryTotal,
        });
        _obsHistoryPage = 0;
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
const SENTIMENT_LABELS     = { POSITIF:'Positif', NETRAL:'Netral', NEGATIF:'Perlu Perhatian' };
const SENTIMENT_COLOR      = { POSITIF:'var(--color-success)', NETRAL:'var(--color-text-muted)', NEGATIF:'var(--color-danger)' };

const OBS_VIS_LABEL = {
    SISWA_SAJA:    '🎓 Siswa saja',
    ORTU_SAJA:     '👨‍👩‍👧 Orang Tua saja',
    SISWA_DAN_ORTU:'👨‍👩‍👦 Siswa & Orang Tua',
    PRIVATE:       '🔒 Catatan pribadi',
};

// Kelas aktif yang dipilih guru di filter riwayat catatan ('' = semua kelas)
let _obsHistoryKelasFilter    = '';
// Sentimen aktif ('' = semua, 'NEGATIF' = perlu perhatian, 'POSITIF' = positif)
let _obsHistorySentimenFilter = '';

function buildObsStudentClassMap() {
    const map = new Map();
    for (const s of myStudents) {
        if (s.student_id && s.class_name) map.set(s.student_id, s.class_name);
    }
    return map;
}

function renderObsKelasFilter(rows, listEl, classMap) {
    const wrapperId = 'obs-history-kelas-filter';
    let wrapper = document.getElementById(wrapperId);

    // Kumpulkan kelas unik dari baris riwayat, urutkan
    const kelasSet = new Set();
    for (const r of rows) {
        const kn = classMap.get(r.student_id);
        if (kn) kelasSet.add(kn);
    }
    const kelasList = [...kelasSet].sort();

    // Jika hanya satu kelas atau tidak ada data kelas, sembunyikan filter
    if (kelasList.length <= 1) {
        if (wrapper) wrapper.remove();
        return;
    }

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = wrapperId;
        wrapper.className = 'section-card';
        wrapper.style.cssText = 'margin-bottom:16px';
        listEl.before(wrapper);
    }

    // Pola identik selector konteks Penilaian: section-card > flex row > .field > .label + .input
    wrapper.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px">
            <label class="label">Filter Kelas</label>
            <select id="obs-history-kelas" class="input">
                <option value="">— Semua Kelas —</option>
                ${kelasList.map(k => `<option value="${esc(k)}"${k === _obsHistoryKelasFilter ? ' selected' : ''}>${esc(k)}</option>`).join('')}
            </select>
        </div>
        <div class="field" style="flex:1;min-width:160px">
            <label class="label">Sentimen</label>
            <select id="obs-history-sentimen" class="input">
                <option value=""${_obsHistorySentimenFilter === '' ? ' selected' : ''}>— Semua —</option>
                <option value="NEGATIF"${_obsHistorySentimenFilter === 'NEGATIF' ? ' selected' : ''}>Perlu Perhatian</option>
                <option value="POSITIF"${_obsHistorySentimenFilter === 'POSITIF' ? ' selected' : ''}>Positif</option>
            </select>
        </div>
    </div>`;

    if (!wrapper._kelasTerpasang) {
        wrapper._kelasTerpasang = true;
        wrapper.addEventListener('change', (e) => {
            if (e.target.id === 'obs-history-kelas') {
                _obsHistoryKelasFilter = e.target.value;
            } else if (e.target.id === 'obs-history-sentimen') {
                _obsHistorySentimenFilter = e.target.value;
            } else return;
            _obsHistoryPage = 0;
            renderObsHistory(_obsHistoryRows, listEl);
        });
    }

    // Ikut sembunyikan jika section sedang collapsed (filter dibuat setelah collapse di-wire)
    if (listEl.style.display === 'none') wrapper.style.display = 'none';
}

function buildObsKartu(r, classMap) {
    const nama      = r.student?.full_name ?? '—';
    const dim       = DIMENSION_LABELS_OBS[r.dimension] ?? r.dimension;
    const vis       = r.visibility ?? 'SISWA_DAN_ORTU';
    const visLabel  = OBS_VIS_LABEL[vis] ?? vis;
    const visColor  = 'var(--color-primary)';
    const isVoid    = !!r.is_void;
    const voidOpacity = isVoid ? 'opacity:0.55;' : '';
    const voidBadge   = isVoid ? `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--color-danger);padding:6px 0 2px">
        <span>⊘ ${r.voided_by && r.voided_by === r.author_user_id ? 'Dibatalkan oleh Anda' : 'Disembunyikan'}</span>
        ${r.void_reason ? `<span style="color:var(--color-text-muted)">— ${esc(r.void_reason)}</span>` : ''}
    </div>` : '';

    return `<div data-obs-id="${esc(r.observation_id)}" data-obs-vis="${esc(vis)}"
         data-student-id="${esc(r.student_id ?? '')}"
         data-author-id="${esc(r.author_user_id ?? '')}"
         data-student-name="${esc(r.student?.full_name ?? '')}"
         style="border-bottom:0.5px solid var(--color-border);font-size:13px;${voidOpacity}">
        <!-- Header kartu (selalu tampil, klik untuk buka/tutup) -->
        <div data-obs-toggle style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;padding:10px 0 10px;cursor:pointer;user-select:none">
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:4px;margin-bottom:3px">
                    <strong>${esc(nama)}</strong>
                    <span style="margin-left:auto;font-size:11px;color:var(--color-text-muted);white-space:nowrap">${fmt(r.observed_at)}</span>
                </div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
                    <span style="font-size:11px;padding:2px 7px;border-radius:4px;background:var(--color-bg-alt)">${esc(dim)}</span>
                    <span style="font-size:11px;padding:2px 7px;border-radius:4px;color:${visColor};background:var(--color-bg-alt)">${visLabel}</span>
                </div>
            </div>
            <span data-obs-chevron style="font-size:10px;color:var(--color-text-muted);margin-top:3px;flex-shrink:0;transition:transform .18s">▼</span>
        </div>
        <!-- Body kartu (tersembunyi saat collapsed) -->
        <div data-obs-body style="display:none;padding-bottom:10px">
            ${voidBadge}
            <p style="margin:0 0 6px;white-space:pre-wrap;color:var(--color-text)">${esc(r.content)}</p>
            ${isVoid ? '' : `<button type="button" class="btn btn-sm btn-danger-outline" data-void-obs="${esc(r.observation_id)}">Batalkan catatan</button>`}
        </div>
    </div>`;
}

function renderObsHistory(rows, listEl) {
    const classMap = buildObsStudentClassMap();

    renderObsKelasFilter(rows, listEl, classMap);

    let filtered = _obsHistoryKelasFilter
        ? rows.filter(r => classMap.get(r.student_id) === _obsHistoryKelasFilter)
        : rows;
    if (_obsHistorySentimenFilter) {
        filtered = filtered.filter(r => _obsHistorySentimenFilter === 'POSITIF'
            ? r.sentiment !== 'NEGATIF'
            : r.sentiment === 'NEGATIF');
    }

    if (!filtered.length) {
        listEl.innerHTML = rows.length
            ? '<p class="hint">Tidak ada catatan untuk kelas ini.</p>'
            : '<p class="hint">Belum ada catatan yang ditulis.</p>';
        return;
    }

    // Pagination: ambil slice 10 dari seluruh filtered (urutan: NEGATIF dulu, lalu lainnya)
    const ordered        = [
        ...filtered.filter(r => r.sentiment === 'NEGATIF'),
        ...filtered.filter(r => r.sentiment !== 'NEGATIF'),
    ];
    const totalHalaman   = Math.ceil(ordered.length / OBS_HISTORY_DISPLAY_SIZE);
    _obsHistoryPage      = Math.min(_obsHistoryPage, Math.max(0, totalHalaman - 1));
    const start          = _obsHistoryPage * OBS_HISTORY_DISPLAY_SIZE;
    const halaman        = ordered.slice(start, start + OBS_HISTORY_DISPLAY_SIZE);

    // Pisahkan slice halaman ini ke grup sentimen
    const perluPerhatian = halaman.filter(r => r.sentiment === 'NEGATIF');
    const lainnya        = halaman.filter(r => r.sentiment !== 'NEGATIF');

    function grupHeader(label, color, count) {
        return `<div style="display:flex;align-items:center;gap:7px;padding:8px 0 5px;border-top:0.5px solid var(--color-border)">
            <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block"></span>
            <span style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${color}">${label}</span>
            <span style="font-size:11px;color:var(--color-text-muted)">${count} catatan</span>
        </div>`;
    }

    let html = '';
    if (perluPerhatian.length) {
        html += grupHeader('Perlu Perhatian', 'var(--color-danger)', perluPerhatian.length);
        html += perluPerhatian.map(r => buildObsKartu(r, classMap)).join('');
    }
    if (lainnya.length) {
        html += grupHeader('Positif', 'var(--color-success)', lainnya.length);
        html += lainnya.map(r => buildObsKartu(r, classMap)).join('');
    }

    // Navigasi halaman ← →
    if (totalHalaman > 1) {
        const prevDis = _obsHistoryPage === 0 ? 'opacity:.35;cursor:default;pointer-events:none' : 'cursor:pointer';
        const nextDis = _obsHistoryPage >= totalHalaman - 1 ? 'opacity:.35;cursor:default;pointer-events:none' : 'cursor:pointer';
        html += `<div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 0 2px">
            <button type="button" data-obs-prev style="background:none;border:1px solid var(--color-border);border-radius:6px;padding:4px 12px;font-size:16px;color:var(--color-text);${prevDis}">&#8592;</button>
            <span style="font-size:12px;color:var(--color-text-muted);min-width:48px;text-align:center">${_obsHistoryPage + 1} / ${totalHalaman}</span>
            <button type="button" data-obs-next style="background:none;border:1px solid var(--color-border);border-radius:6px;padding:4px 12px;font-size:16px;color:var(--color-text);${nextDis}">&#8594;</button>
        </div>`;
    }

    listEl.innerHTML = html;

    // Navigasi halaman
    listEl.querySelector('[data-obs-prev]')?.addEventListener('click', () => {
        if (_obsHistoryPage > 0) { _obsHistoryPage--; renderObsHistory(_obsHistoryRows, listEl); }
    });
    listEl.querySelector('[data-obs-next]')?.addEventListener('click', () => {
        if (_obsHistoryPage < totalHalaman - 1) { _obsHistoryPage++; renderObsHistory(_obsHistoryRows, listEl); }
    });

    // Toggle collapse per kartu
    listEl.querySelectorAll('[data-obs-toggle]').forEach(hdr => {
        hdr.addEventListener('click', (e) => {
            if (e.target.closest('[data-void-obs]') || e.target.closest('.obs-void-form')) return;
            const kartu   = hdr.closest('[data-obs-id]');
            const body    = kartu?.querySelector('[data-obs-body]');
            const chevron = kartu?.querySelector('[data-obs-chevron]');
            if (!body) return;
            const terbuka = body.style.display !== 'none';
            body.style.display    = terbuka ? 'none' : 'block';
            if (chevron) chevron.style.transform = terbuka ? '' : 'rotate(180deg)';
        });
    });

    if (!listEl._voidTerpasang) {
        listEl._voidTerpasang = true;
        listEl.addEventListener('click', async (e) => {
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
            const form   = ok.closest('.obs-void-form');
            const msgEl  = form.querySelector('.obs-void-msg');
            const alasan = form.querySelector('.obs-void-reason').value.trim();
            if (alasan.length < 5) { msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = 'Alasan minimal 5 karakter.'; return; }
            ok.disabled = true; msgEl.style.color = 'var(--color-text-muted)'; msgEl.textContent = 'Membatalkan…';
            try {
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
