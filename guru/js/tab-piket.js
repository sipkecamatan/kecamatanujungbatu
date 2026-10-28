/**
 * @file guru/js/tab-piket.js
 * Tab Piket — catat keterlambatan dan izin keluar siswa.
 * Dipanggil dari dashboard.js via initPiketTab().
 */
import {
    searchStudents,
    getTodayLateArrivals, recordLateArrival, deleteLateArrival,
    getTodayExits, recordExit, updateReturnTime, deleteExit,
} from './api.js';
import { esc, fe, fmtTime, showInputModal } from './tab-shared.js';

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

export async function initPiketTab({ currentUser }) {
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
    await _piketRenderAll(currentUser);
}

async function _piketRenderAll(currentUser) {
    await Promise.all([
        _piketRenderRingkasan(),
        _piketRenderForm(currentUser),
        _piketRenderRekap(currentUser),
        _piketRenderExitForm(currentUser),
        _piketRenderExits(currentUser),
    ]);
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

async function _piketRenderForm(currentUser) {
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
            await Promise.all([_piketRenderRingkasan(), _piketRenderRekap(currentUser)]);
        } catch (err) {
            msgEl.style.color = 'var(--color-danger,#dc2626)';
            msgEl.textContent = fe(err, 's');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Catat Keterlambatan';
        }
    });
}

async function _piketRenderRekap(currentUser) {
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
                await Promise.all([_piketRenderRingkasan(), _piketRenderRekap(currentUser)]);
            } catch (err) {
                alert(fe(err, 'h'));
                btn.disabled = false;
            }
        });
    });
}

async function _piketRenderExitForm(currentUser) {
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
            await _piketRenderAll(currentUser);
        } catch (e) {
            alert('Gagal mencatat: ' + (e.message ?? e));
            submitBtn.disabled = false;
        } finally {
            submitBtn.textContent = 'Catat Izin Keluar';
        }
    });
}

async function _piketRenderExits(currentUser) {
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
                await _piketRenderExits(currentUser);
            } catch (e) { alert('Gagal mencatat jam kembali: ' + (e.message ?? e)); }
        });
    });

    content.querySelectorAll('.piket-exit-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus catatan izin keluar ini?')) return;
            try {
                await deleteExit(btn.dataset.exitId);
                await _piketRenderAll(currentUser);
            } catch (e) { alert('Gagal menghapus: ' + (e.message ?? e)); }
        });
    });
}
