const SUPABASE_URL  = 'https://lqgzpiohxdzkkmxjtwor.supabase.co';

import { getSuperadminKey, setSuperadminKey } from './auth.js';

function getSaKey() {
    const k = getSuperadminKey();
    if (!k) {
        // Key hilang (refresh) — kembali ke login view
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = '';
        return null;
    }
    return k;
}

// ── Tab navigation ────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
});

// ── Toggle form daftarkan sekolah ─────────────────────────────
const provisionCard = document.getElementById('provision-card');
document.getElementById('toggle-provision-btn').addEventListener('click', () => {
    const open = provisionCard.style.display !== 'none';
    provisionCard.style.display = open ? 'none' : '';
    document.getElementById('toggle-provision-btn').textContent = open ? '+ Daftarkan Baru' : '✕ Tutup Form';
    if (!open) provisionCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
document.getElementById('cancel-provision-btn').addEventListener('click', () => {
    provisionCard.style.display = 'none';
    document.getElementById('toggle-provision-btn').textContent = '+ Daftarkan Baru';
});

// ── Sinkron color picker ↔ hex input ─────────────────────────
function syncColor(pickerId, hexId) {
    const picker = document.getElementById(pickerId);
    const hex    = document.getElementById(hexId);
    if (!picker || !hex) return;
    picker.addEventListener('input', () => { hex.value = picker.value; });
    hex.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value;
    });
}
syncColor('f-primary-color', 'f-primary-color-hex');
syncColor('f-secondary-color', 'f-secondary-color-hex');

// Aman untuk isi elemen DAN nilai atribut berkutip: tanda kutip ikut diloloskan.
function esc(s) {
    return String(s ?? '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
    setSuperadminKey(null);
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('login-view').style.display = '';
});

// ── Health badges per sekolah ─────────────────────────────────
function renderHealthBadges(h) {
    if (!h) return '';

    function jabatanBadge(label, count) {
        if (count === 0) return `<span class="hbadge hbadge-missing">✗ ${label}</span>`;
        if (count === 1) return `<span class="hbadge hbadge-ok">✓ ${label}</span>`;
        return `<span class="hbadge hbadge-dup">⚠ ${label} (${count}×!)</span>`;
    }

    const provRatio = h.student_count > 0
        ? Math.round((h.provisioned_count / h.student_count) * 100)
        : null;

    return `
    <div class="health-panel">
      <div class="health-row health-jabatan">
        ${jabatanBadge('Kepsek', h.kepsek_count)}
        ${jabatanBadge('Waka Kur.', h.waka_kurikulum_count)}
        ${jabatanBadge('Waka Kes.', h.waka_kesiswaan_count)}
        ${jabatanBadge('Waka Humas', h.waka_humas_count)}
      </div>
      <div class="health-row health-counts">
        <span class="hstat"><strong>${h.staff_count}</strong> staf</span>
        <span class="hstat"><strong>${h.student_count}</strong> siswa</span>
        ${provRatio !== null
            ? `<span class="hstat ${provRatio < 100 ? 'hstat-warn' : ''}"><strong>${h.provisioned_count}</strong>/${h.student_count} punya akun (${provRatio}%)</span>`
            : ''}
      </div>
      ${(h.guru_count != null) ? `
      <div class="health-row" style="gap:12px;flex-wrap:wrap;font-size:12px;color:var(--color-text-muted,#64748b);border-top:1px solid var(--color-border,#e2e8f0);padding-top:6px;margin-top:4px">
        <span>👩‍🏫 <strong>${h.guru_count}</strong> guru/staf</span>
        <span>🎓 <strong>${h.siswa_count}</strong> siswa</span>
        <span>👪 <strong>${h.ortu_count}</strong> ortu</span>
        <span>🏭 <strong>${h.dudi_count}</strong> DUDI</span>
        <span>📊 <strong>${h.stakeholder_count}</strong> stakeholder</span>
      </div>` : ''}
    </div>`;
}

// ── Load daftar sekolah ───────────────────────────────────────
async function loadSchools() {
    const saKey = getSaKey(); if (!saKey) return;
    const hintEl  = document.getElementById('schools-hint');
    const listWrap = document.getElementById('schools-list');

    // Tampilkan pesan DAN kosongkan daftar lama. Tanpa ini, setelah sekolah
    // terakhir dihapus kartu lamanya tetap terlihat (daftar basi) sementara
    // pesan "kosong" tersembunyi — tampilan tidak sesuai database.
    const tampilkanPesan = (msg) => {
        if (listWrap) listWrap.innerHTML = '';
        hintEl.textContent = msg;
        hintEl.style.display = '';
    };

    try {
        // Superadmin key-based (bukan Supabase auth) → baca daftar sekolah
        // lewat edge function service-role yang digerbang X-Superadmin-Key,
        // karena RLS schools kini butuh auth.uid() (tak ada untuk anon).
        const res = await fetch(`${SUPABASE_URL}/functions/v1/list-schools`, {
            headers: { 'x-superadmin-key': saKey },
        });
        const data = await res.json();

        if (res.status === 401) { tampilkanPesan('Sesi superadmin tidak valid. Masuk ulang.'); return; }
        // "Kosong" hanya boleh muncul untuk jawaban sukses berupa daftar kosong.
        // Jawaban lain (galat server, jawaban gerbang saat fungsi belum dideploy)
        // harus terlihat sebagai kegagalan, bukan disamarkan sebagai kekosongan.
        if (!res.ok || !Array.isArray(data)) {
            const sebab = data?.error ?? data?.message ?? `respons tidak dikenali (HTTP ${res.status})`;
            tampilkanPesan(`Gagal memuat: ${sebab}`);
            return;
        }
        if (data.length === 0) { tampilkanPesan('Belum ada sekolah terdaftar.'); return; }

        hintEl.style.display = 'none';
        const listEl = document.getElementById('schools-list');
        const BASE = location.origin + location.pathname.replace(/superadmin\/.*$/, '');

        listEl.innerHTML = data.map(s => {
            const adminUrl = s.slug ? `${BASE}admin/?school=${esc(s.slug)}` : null;
            // SUP-08: primary_color masuk ke atribut style — validasi format hex
            // agar nilai seperti 'red; width:100vw' tidak bisa menyuntik CSS.
            const hexOk = /^#[0-9a-fA-F]{6}$/.test(s.primary_color ?? '');
            const swatchColor = hexOk ? s.primary_color : '#cccccc';
            const colorSwatch = s.primary_color
                ? `<span class="color-swatch" style="background:${swatchColor}"></span>${esc(s.primary_color)}`
                : '—';
            return `
            <div class="school-item">
              <button class="school-summary" type="button">
                <span class="school-summary-left">
                  ${s.primary_color ? `<span class="color-dot" style="background:${swatchColor}"></span>` : ''}
                  <span class="school-summary-name">${esc(s.name)}</span>
                  <span class="school-summary-meta" style="font-size:11px;color:#94a3b8;margin-top:2px;display:flex;gap:16px">
                      <span>${esc(s.admin_name || '—')}</span>
                      <span style="color:#60a5fa">${s.admin_login_identifier ? esc(s.admin_login_identifier) : '—'}</span>
                  </span>
                </span>
                <span class="school-summary-right">
                  <span class="badge ${s.is_active ? 'badge-active' : 'badge-inactive'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span>
                  <span class="chevron">›</span>
                </span>
              </button>
              <div class="school-detail">
                <div class="school-top" style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
                <dl class="school-meta" style="flex:1 1 260px;min-width:0">
                  ${s.npsn ? `<div class="meta-row"><dt>NPSN</dt><dd>${esc(s.npsn)}</dd></div>` : ''}
                  <div class="meta-row"><dt>Admin</dt><dd>${esc(s.admin_name)}</dd></div>
                  <div class="meta-row"><dt>Login Admin</dt><dd>${s.admin_login_identifier ? esc(s.admin_login_identifier) : '—'}</dd></div>
                  ${adminUrl ? `<div class="meta-row"><dt>Link Login</dt><dd>
                    <code class="slug-code">?school=${esc(s.slug)}</code>
                    <div class="meta-actions">
                      <button class="btn btn-sm btn-secondary copy-url-btn" data-url="${adminUrl}">Salin Link</button>
                      <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-secondary">Buka ↗</a>
                    </div>
                  </dd></div>` : ''}
                  ${s.phone ? `<div class="meta-row"><dt>Telepon</dt><dd>${esc(s.phone)}</dd></div>` : ''}
                  <div class="meta-row"><dt>Warna</dt><dd style="display:flex;align-items:center;gap:6px">${colorSwatch}</dd></div>
                  <div class="meta-row"><dt>Terdaftar</dt><dd>${fmt(s.created_at)}</dd></div>
                </dl>
                <div class="wilayah-box" style="flex:1 1 280px;min-width:0" data-school-id="${esc(s.school_id)}"><span class="hint">Memuat penghubungan wilayah…</span></div>
                </div>
                ${renderHealthBadges(s.health)}
                <div class="school-actions">
                  <button class="btn btn-sm btn-secondary reset-pw-btn"
                      data-school-id="${esc(s.school_id)}"
                      data-school-name="${esc(s.name)}"
                      ${!s.has_admin_account ? 'disabled title="Tidak ada akun admin"' : ''}>
                      Reset Password
                  </button>
                  ${s.is_active
                      ? `<button class="btn btn-sm toggle-status-btn"
                              data-school-id="${esc(s.school_id)}"
                              data-school-name="${esc(s.name)}"
                              data-active="true"
                              style="background:#b45309;color:#fff;border-color:#b45309">
                              Nonaktifkan
                         </button>`
                      : `<button class="btn btn-sm toggle-status-btn"
                              data-school-id="${esc(s.school_id)}"
                              data-school-name="${esc(s.name)}"
                              data-active="false"
                              style="background:#15803d;color:#fff;border-color:#15803d">
                              Aktifkan
                         </button>
                         <button class="btn btn-sm delete-school-btn"
                              data-school-id="${esc(s.school_id)}"
                              data-school-name="${esc(s.name)}"
                              style="background:#dc2626;color:#fff;border-color:#dc2626">
                              Hapus Permanen
                         </button>`
                  }
                </div>
              </div>
            </div>`;
        }).join('');
        isiKotakWilayah(listEl);

    } catch (err) {
        tampilkanPesan(`Gagal memuat: ${err.message}`);
    }
}

// ── Penghubungan sekolah dengan wilayah ──
// Satu pilihan kecamatan (Kabupaten/Kota lalu Kecamatan, dari daftar resmi) dan tiga kotak centang.
// Dicentang = penanda tingkat itu terpasang; tidak dicentang = terputus. Kabupaten dan provinsi mengikuti
// kecamatan yang dipilih (tidak dipilih manual), sehingga tidak bisa tidak cocok.
// Semua terkunci sampai tombol "Ubah penghubungan" ditekan, dan perubahan meminta konfirmasi.
// Persetujuan berbagi tetap hak kepala sekolah: penanda saja tidak membuka data.
const TINGKAT_WILAYAH = [
    { level: 'KECAMATAN', kolom: 'region_id',    bagi: 'share_with_region', judul: 'Kecamatan' },
    { level: 'KABUPATEN', kolom: 'kabupaten_id', bagi: 'share_kabupaten',   judul: 'Kabupaten' },
    { level: 'PROVINSI',  kolom: 'provinsi_id',  bagi: 'share_provinsi',    judul: 'Provinsi' },
];

async function isiKotakWilayah(listEl) {
    const kotak = [...listEl.querySelectorAll('.wilayah-box')];
    if (!kotak.length) return;
    let d, indeks;
    try { [d, indeks] = await Promise.all([regionApi({ action: 'list' }), loadIndeksProvinsi()]); }
    catch (e) { kotak.forEach(k => k.replaceChildren(h('span', { class: 'hint' }, 'Gagal memuat penghubungan wilayah: ' + e.message))); return; }

    const wilayahId = Object.fromEntries(d.regions.map(r => [r.region_id, r]));
    const sekolahById = {};
    for (const r of d.regions) for (const s of r.schools) sekolahById[s.school_id] = s;
    for (const s of d.schools_tanpa_wilayah) sekolahById[s.school_id] = s;

    for (const el of kotak) {
        const s = sekolahById[el.dataset.schoolId];
        if (!s) { el.replaceChildren(h('span', { class: 'hint' }, 'Data wilayah sekolah tidak ditemukan.')); continue; }

        // Kode wilayah yang terpasang saat ini (kecamatan 7 digit, kabupaten 4, provinsi 2)
        const kodeKini = {};
        for (const t of TINGKAT_WILAYAH) kodeKini[t.level] = (s[t.kolom] && wilayahId[s[t.kolom]] && wilayahId[s[t.kolom]].kode) || null;
        const awalKec  = kodeKini.KECAMATAN;
        const awalKab  = awalKec ? awalKec.slice(0, 4) : (kodeKini.KABUPATEN || '');
        const awalProv = awalKec ? awalKec.slice(0, 2) : (kodeKini.KABUPATEN ? kodeKini.KABUPATEN.slice(0, 2) : (kodeKini.PROVINSI || (indeks.length === 1 ? indeks[0].kode : '')));

        const selProv = h('select', { class: 'input', disabled: true, style: 'width:auto;' + (indeks.length > 1 ? '' : 'display:none'), 'aria-label': 'Provinsi' },
            ...indeks.map(p => h('option', { value: p.kode }, 'Provinsi ' + p.nama)));
        const selKab = h('select', { class: 'input', disabled: true, style: 'width:auto;max-width:100%', 'aria-label': 'Kabupaten / Kota' });
        const selKec = h('select', { class: 'input', disabled: true, style: 'width:auto;max-width:100%', 'aria-label': 'Kecamatan' });
        selProv.value = awalProv;

        const kotakCentang = {};
        const labelTeks = {};
        const rantai = { ref: null, kab: null, kec: null };   // hasil pilihan saat ini

        const hitungRantai = () => {
            const ref = rantai.ref;
            const kab = ref ? ref.kabupaten.find(x => x.kode === selKab.value) : null;
            const kec = kab ? kab.kecamatan.find(c => c.kode === selKec.value) : null;
            rantai.kab = kab; rantai.kec = kec;
            return {
                PROVINSI:  ref ? { kode: ref.provinsi.kode, name: namaProv(ref.provinsi), level: 'PROVINSI' } : null,
                KABUPATEN: kab ? { kode: kab.kode, name: namaKab(kab), level: 'KABUPATEN' } : null,
                KECAMATAN: kab && kec ? { kode: kec.kode, name: 'Kecamatan ' + kec.nama + ', ' + namaKab(kab), level: 'KECAMATAN' } : null,
            };
        };
        const segarkanLabel = () => {
            const rt = hitungRantai();
            for (const t of TINGKAT_WILAYAH) {
                const w = rt[t.level];
                labelTeks[t.level].textContent = ' — ' + (w ? w.name : 'belum dipilih') + (s[t.kolom] && kodeKini[t.level] === (w && w.kode) ? (s[t.bagi] ? ' · berbagi: ya' : ' · berbagi: tidak') : '');
                if (!w) kotakCentang[t.level].checked = false;
            }
        };
        const isiKab = async () => {
            let ref = null;
            try { ref = selProv.value ? await loadRefProvinsi(selProv.value) : null; } catch { ref = null; }
            rantai.ref = ref;
            const dulu = selKab.value || awalKab;
            selKab.replaceChildren(h('option', { value: '' }, '— kabupaten / kota —'),
                ...(ref ? ref.kabupaten : []).map(k => h('option', { value: k.kode }, namaKab(k))));
            selKab.value = ref && ref.kabupaten.some(k => k.kode === dulu) ? dulu : '';
            isiKec();
        };
        const isiKec = () => {
            const ref = rantai.ref;
            const kab = ref ? ref.kabupaten.find(x => x.kode === selKab.value) : null;
            const dulu = selKec.value || awalKec || '';
            selKec.replaceChildren(h('option', { value: '' }, '— kecamatan —'),
                ...(kab ? kab.kecamatan : []).map(c => h('option', { value: c.kode }, c.nama)));
            selKec.value = kab && kab.kecamatan.some(c => c.kode === dulu) ? dulu : '';
            segarkanLabel();
        };

        const baris = TINGKAT_WILAYAH.map(t => {
            const cb = h('input', { type: 'checkbox', disabled: true });
            cb.checked = Boolean(s[t.kolom]);
            kotakCentang[t.level] = cb;
            const teks = h('span', {}, ' — …');
            labelTeks[t.level] = teks;
            return h('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin:4px 0;font-size:13px' },
                cb, h('span', {}, h('strong', {}, t.judul), teks));
        });

        const peringatan = h('p', { class: 'hint', style: 'display:none;margin:6px 0' },
            'Hati-hati: memutus atau mengganti penghubungan mereset persetujuan berbagi kepala sekolah pada tingkat itu. ' +
            'Menghidupkan hanya memasang penanda; data baru terlihat setelah kepala sekolah menyetujui berbagi.');
        const ubah   = h('button', { class: 'btn btn-sm btn-secondary', type: 'button' }, 'Ubah penghubungan');
        const simpan = h('button', { class: 'btn btn-sm', type: 'button', style: 'display:none' }, 'Simpan perubahan');
        const batal  = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: 'display:none' }, 'Batal');
        const awal   = Object.fromEntries(TINGKAT_WILAYAH.map(t => [t.level, Boolean(s[t.kolom])]));

        const kunci = (buka) => {
            selProv.disabled = selKab.disabled = selKec.disabled = !buka;
            for (const t of TINGKAT_WILAYAH) kotakCentang[t.level].disabled = !buka;
            peringatan.style.display = buka ? 'block' : 'none';
            ubah.style.display   = buka ? 'none' : '';
            simpan.style.display = buka ? '' : 'none';
            batal.style.display  = buka ? '' : 'none';
        };
        selProv.addEventListener('change', async () => { selKab.value = ''; selKec.value = ''; await isiKab(); });
        selKab.addEventListener('change', () => { selKec.value = ''; isiKec(); });
        selKec.addEventListener('change', () => {
            segarkanLabel();
            // memilih kecamatan baru menyalakan ketiga kotak yang punya wilayah
            const rt = hitungRantai();
            for (const t of TINGKAT_WILAYAH) if (rt[t.level]) kotakCentang[t.level].checked = true;
        });
        ubah.addEventListener('click', () => kunci(true));
        batal.addEventListener('click', async () => {
            for (const t of TINGKAT_WILAYAH) kotakCentang[t.level].checked = awal[t.level];
            selProv.value = awalProv; selKab.value = awalKab; selKec.value = awalKec || '';
            await isiKab();
            for (const t of TINGKAT_WILAYAH) kotakCentang[t.level].checked = awal[t.level];
            kunci(false);
        });
        simpan.addEventListener('click', async () => {
            const rt = hitungRantai();
            const rincian = [];
            let reset = false;
            for (const t of TINGKAT_WILAYAH) {
                const target = kotakCentang[t.level].checked ? rt[t.level] : null;
                const kini = kodeKini[t.level];
                if (kotakCentang[t.level].checked && !rt[t.level]) { alert('Pilih ' + t.judul.toLowerCase() + ' terlebih dahulu.'); return; }
                const kodeTarget = target ? target.kode : null;
                if (kodeTarget === kini) continue;
                const namaKini = s[t.kolom] && wilayahId[s[t.kolom]] ? wilayahId[s[t.kolom]].name : '';
                if (target && !kini)      rincian.push('+ hubungkan ' + t.judul.toLowerCase() + ' (' + target.name + ')');
                else if (!target && kini) rincian.push('- putuskan ' + t.judul.toLowerCase() + ' (' + namaKini + ')');
                else                      rincian.push('~ ganti ' + t.judul.toLowerCase() + ': ' + namaKini + ' -> ' + target.name);
                if (kini && s[t.bagi]) reset = true;
            }
            if (!rincian.length) { kunci(false); return; }
            if (!confirm('Ubah penghubungan wilayah ' + s.name + '?\n\n' + rincian.join('\n')
                + (reset ? '\n\nPersetujuan berbagi kepala sekolah pada tingkat yang berubah akan direset.' : '') + '\n\nLanjutkan?')) return;
            simpan.disabled = true;
            try {
                const isi = { action: 'assign_school', school_id: s.school_id, jenjang: s.jenjang ?? null };
                for (const t of TINGKAT_WILAYAH) {
                    const w = kotakCentang[t.level].checked ? rt[t.level] : null;
                    if (!w) { isi[t.kolom] = null; continue; }
                    const out = await regionApi({ action: 'ensure_region', kode: w.kode, name: w.name, level: w.level });
                    isi[t.kolom] = out.region.region_id;
                }
                await regionApi(isi);
                showRegionMsg('Penghubungan wilayah ' + s.name + ' disimpan.', true);
                loadSchools(); loadRegions();
            } catch (e) { showRegionMsg(e.message, false); alert('Gagal menyimpan: ' + e.message); simpan.disabled = false; }
        });

        el.replaceChildren(
            h('div', { class: 'field-section-label', style: 'margin:10px 0 4px' }, 'Penghubungan wilayah'),
            h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px' }, selProv, selKab, selKec),
            ...baris, peringatan,
            h('div', { style: 'display:flex;gap:8px;margin:6px 0 10px;flex-wrap:wrap' }, ubah, simpan, batal));
        isiKab().then(() => { for (const t of TINGKAT_WILAYAH) kotakCentang[t.level].checked = awal[t.level]; });
    }
}

// SUP-10: delegasi klik daftar sekolah didaftarkan SEKALI di module level.
// Sebelumnya listener ini berada di dalam loadSchools(), sehingga tiap refresh
// (provision / hapus / toggle status) menambahkan satu handler baru dan satu
// klik memicu N aksi. #schools-list ada statis di index.html
// (#dashboard-view, sejak SUP-03 SPA migration).
const schoolsListEl = document.getElementById('schools-list');
schoolsListEl?.addEventListener('click', e => {
    // Accordion toggle
    const summary = e.target.closest('.school-summary');
    if (summary) {
        const item = summary.closest('.school-item');
        const isOpen = item.classList.contains('open');
        // tutup semua lain
        schoolsListEl.querySelectorAll('.school-item.open').forEach(el => el.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
        return;
    }
    const resetBtn = e.target.closest('.reset-pw-btn');
    if (resetBtn && !resetBtn.disabled) {
        openResetModal(resetBtn.dataset.schoolId, resetBtn.dataset.schoolName);
    }
    const copyBtn = e.target.closest('.copy-url-btn');
    if (copyBtn) {
        navigator.clipboard.writeText(copyBtn.dataset.url).then(() => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = 'Tersalin!';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        }).catch(() => {
            // SUP-09: clipboard API gagal (izin ditolak / bukan HTTPS) — beri jalan keluar.
            alert('Gagal menyalin otomatis. Salin manual:\n' + copyBtn.dataset.url);
        });
    }
    const delBtn = e.target.closest('.delete-school-btn');
    if (delBtn) confirmDeleteSchool(delBtn.dataset.schoolId, delBtn.dataset.schoolName);

    const toggleBtn = e.target.closest('.toggle-status-btn');
    if (toggleBtn) toggleSchoolStatus(toggleBtn);
});

// ── Form daftar sekolah baru ──────────────────────────────────
document.getElementById('provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saKey = getSaKey(); if (!saKey) return;
    const btn       = document.getElementById('provision-btn');
    const resultEl  = document.getElementById('provision-result');
    const credBox   = document.getElementById('cred-box');

    resultEl.style.display = 'none';
    credBox.style.display  = 'none';
    btn.disabled = true; btn.textContent = 'Mendaftarkan…';

    const payload = {
        school_name:      document.getElementById('f-school-name').value.trim(),
        npsn:             document.getElementById('f-npsn').value.trim(),
        phone:            document.getElementById('f-phone').value.trim(),
        address:          document.getElementById('f-address').value.trim(),
        admin_name:       document.getElementById('f-admin-name').value.trim(),
        admin_identifier: document.getElementById('f-admin-id').value.trim(),
        slug:             document.getElementById('f-slug').value.trim() || null,
        logo_url:         document.getElementById('f-logo-url').value.trim() || null,
        primary_color:    document.getElementById('f-primary-color-hex').value.trim() || null,
        secondary_color:  document.getElementById('f-secondary-color-hex').value.trim() || null,
        jenjang:          document.getElementById('f-jenjang').value || null,
        // Penghubungan wilayah diatur dari kartu sekolah (kotak centang), bukan saat mendaftar.
        region_id:        null,
        kabupaten_id:     null,
        provinsi_id:      null,
    };

    // SUP-05: slug ikut ke URL tenant (?school=<slug>). Format yang salah baru
    // ketahuan setelah sekolah terlanjur dibuat, jadi disaring di sini sebelum
    // request terkirim. Slug kosong dibiarkan — server yang men-generate.
    if (payload.slug) {
        const slugRe = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
        const valid = slugRe.test(payload.slug)
            && payload.slug.length >= 3
            && payload.slug.length <= 50;
        if (!valid) {
            resultEl.textContent = '✗ Slug tidak valid. Gunakan huruf kecil, angka, '
                + 'dan tanda strip (-). Minimal 3 karakter, tidak boleh diawali '
                + 'atau diakhiri strip.';
            resultEl.className     = 'alert alert-danger';
            resultEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Daftarkan Sekolah';
            return;
        }
    }

    try {
        const res  = await fetch(`${SUPABASE_URL}/functions/v1/provision-school`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body:    JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

        // Tampilkan kredensial
        document.getElementById('cred-school').textContent     = data.school_name;
        document.getElementById('cred-identifier').textContent = data.admin_identifier;
        document.getElementById('cred-password').textContent   = data.admin_password;
        credBox.style.display = 'block';

        resultEl.textContent    = `✓ Sekolah "${data.school_name}" berhasil didaftarkan.`;
        resultEl.className      = 'alert alert-success';
        resultEl.style.display  = 'block';

        e.target.reset();
        loadRegions();
        // SUP-19: form.reset() tidak selalu mengembalikan input[type=color] ke
        // nilai atribut value-nya. Set ulang manual, berikut hex input pasangannya.
        const DEF_PRIMARY = '#1a56db', DEF_SECONDARY = '#1e40af';
        const pcPicker = document.getElementById('f-primary-color');
        const pcHex    = document.getElementById('f-primary-color-hex');
        const scPicker = document.getElementById('f-secondary-color');
        const scHex    = document.getElementById('f-secondary-color-hex');
        if (pcPicker) pcPicker.value = DEF_PRIMARY;
        if (pcHex)    pcHex.value    = DEF_PRIMARY;
        if (scPicker) scPicker.value = DEF_SECONDARY;
        if (scHex)    scHex.value    = DEF_SECONDARY;
        await loadSchools();
    } catch (err) {
        resultEl.textContent   = `✗ ${err.message}`;
        resultEl.className     = 'alert alert-danger';
        resultEl.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Daftarkan Sekolah';
    }
});

// ── Hapus sekolah ────────────────────────────────────────────
function confirmDeleteSchool(schoolId, schoolName) {
    openDeleteModal(schoolId, schoolName);
}

async function toggleSchoolStatus(btn) {
    const saKey = getSaKey(); if (!saKey) return;
    const schoolId   = btn.dataset.schoolId;
    const schoolName = btn.dataset.schoolName;
    const isActive   = btn.dataset.active === 'true';
    const aksi       = isActive ? 'nonaktifkan' : 'aktifkan kembali';

    if (!confirm(`${isActive ? 'Nonaktifkan' : 'Aktifkan'} sekolah "${schoolName}"?\n\n${isActive ? 'Semua pengguna sekolah ini tidak bisa login sampai diaktifkan kembali.' : 'Semua pengguna bisa login kembali.'}`)) return;

    btn.disabled = true;
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/update-school-status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body: JSON.stringify({ school_id: schoolId, is_active: !isActive }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Gagal');
        await loadSchools();
        // SUP-13: beri konfirmasi sukses — sebelumnya daftar refresh diam-diam.
        const hintEl = document.getElementById('schools-hint');
        if (hintEl) {
            hintEl.textContent = `✓ Sekolah "${schoolName}" berhasil di${isActive ? 'nonaktifkan' : 'aktifkan'}.`;
            hintEl.style.display = 'block';
        }
    } catch (err) {
        alert(`Gagal ${aksi}: ${err.message}`);
        btn.disabled = false;
    }
}

// ── Modal reset password admin sekolah ───────────────────────
const resetModal       = document.getElementById('reset-modal');
const resetModalSchool = document.getElementById('reset-modal-school');
const resetConfirmView = document.getElementById('reset-confirm-view');
const resetResultView  = document.getElementById('reset-result-view');
const resetError       = document.getElementById('reset-error');

let _resetSchoolId = null;

function openResetModal(schoolId, schoolName) {
    _resetSchoolId = schoolId;
    resetModalSchool.textContent = schoolName;
    resetConfirmView.style.display = '';
    resetResultView.style.display  = 'none';
    resetError.style.display       = 'none';
    resetModal.style.display       = 'flex';
}

function closeResetModal() {
    resetModal.style.display = 'none';
    _resetSchoolId = null;
}

document.getElementById('reset-cancel-btn').addEventListener('click', closeResetModal);
document.getElementById('reset-close-btn').addEventListener('click', closeResetModal);
resetModal.addEventListener('click', e => { if (e.target === resetModal) closeResetModal(); });

document.getElementById('reset-confirm-btn').addEventListener('click', async () => {
    const saKey = getSaKey(); if (!saKey) return;
    const btn = document.getElementById('reset-confirm-btn');
    resetError.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Mereset…';

    try {
        const res  = await fetch(`${SUPABASE_URL}/functions/v1/reset-admin-password`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body:    JSON.stringify({ school_id: _resetSchoolId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

        document.getElementById('reset-cred-identifier').textContent = data.admin_identifier;
        document.getElementById('reset-cred-password').textContent   = data.admin_password;
        resetConfirmView.style.display = 'none';
        resetResultView.style.display  = '';
    } catch (err) {
        resetError.textContent   = `✗ ${err.message}`;
        resetError.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Ya, Reset Sekarang';
    }
});

// ── Modal hapus sekolah permanen ─────────────────────────────
const deleteModal        = document.getElementById('delete-modal');
const deleteModalSchool  = document.getElementById('delete-modal-school');
const deleteConfirmInput = document.getElementById('delete-confirm-input');
const deleteConfirmBtn   = document.getElementById('delete-confirm-btn');
const deleteError        = document.getElementById('delete-error');

let _deleteSchoolId   = null;
let _deleteSchoolName = null;
let _deleteResumeFrom = null;

function openDeleteModal(schoolId, schoolName) {
    _deleteSchoolId   = schoolId;
    _deleteSchoolName = schoolName;
    _deleteResumeFrom = null;
    deleteModalSchool.textContent = schoolName;
    deleteConfirmInput.value      = '';
    deleteConfirmBtn.disabled     = true;
    deleteError.style.display     = 'none';
    deleteModal.style.display     = 'flex';
    deleteConfirmInput.focus();
}

function closeDeleteModal() {
    deleteModal.style.display = 'none';
    _deleteSchoolId   = null;
    _deleteSchoolName = null;
    _deleteResumeFrom = null;
    deleteConfirmInput.value  = '';
    deleteConfirmBtn.disabled = true;
}

deleteConfirmInput.addEventListener('input', () => {
    deleteConfirmBtn.disabled =
        deleteConfirmInput.value !== _deleteSchoolName;
});

document.getElementById('delete-cancel-btn')
    .addEventListener('click', closeDeleteModal);
deleteModal.addEventListener('click', e => {
    if (e.target === deleteModal) closeDeleteModal();
});

deleteConfirmBtn.addEventListener('click', async () => {
    const saKey = getSaKey();
    if (!saKey) {
        closeDeleteModal();
        return;
    }
    deleteError.style.display = 'none';
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Menghapus…';
    const namaSekolah = _deleteSchoolName;
    let _elapsed = 0;
    const _timer = setInterval(() => {
        _elapsed++;
        deleteConfirmBtn.textContent = `Menghapus… ${_elapsed}d`;
    }, 1000);
    try {
        const res = await fetch(
            `${SUPABASE_URL}/functions/v1/delete-school`, {
            method: 'DELETE',
            headers: {
                'Content-Type':     'application/json',
                'x-superadmin-key': saKey,
            },
            body: JSON.stringify({
                school_id: _deleteSchoolId,
                ...(_deleteResumeFrom && { resume_from: _deleteResumeFrom }),
            }),
        });
        const json = await res.json();
        clearInterval(_timer);
        if (res.status === 401) {
            closeDeleteModal();
            return;
        }
        if (!res.ok) throw new Error(
            json?.error ?? json?.message ?? 'Gagal menghapus');

        if (json.status === 'partial' || json.status === 'timeout') {
            if (!json.resume_from) throw new Error('Server tidak mengirim checkpoint lanjutan');
            _deleteResumeFrom = json.resume_from;
            const lanjut = confirm(
                `Proses selesai sebagian (${json.deleted} dari ${json.total}). Lanjutkan?`
            );
            deleteConfirmBtn.disabled = false;
            deleteConfirmBtn.textContent = 'Lanjutkan Penghapusan';
            if (lanjut) deleteConfirmBtn.click();
            return;
        }

        if (json.status !== 'complete') {
            throw new Error(`Status penghapusan tidak dikenal: ${json.status ?? 'kosong'}`);
        }
        closeDeleteModal();
        await loadSchools();
        const hintEl = document.getElementById('schools-hint');
        if (hintEl) {
            hintEl.textContent = `✓ Sekolah "${namaSekolah}" berhasil dihapus.`;
            hintEl.style.display = 'block';
        }
    } catch (err) {
        clearInterval(_timer);
        deleteError.textContent = `✗ ${err.message}`;
        deleteError.style.display = 'block';
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = 'Hapus Permanen';
    }
});

// ── Pemeliharaan Sistem (banner global) ──────────────────────
const maintBtn     = document.getElementById('maint-toggle-btn');
const maintMsgEl   = document.getElementById('maint-message');
const maintBanner  = document.getElementById('maint-status-banner');
const maintResult  = document.getElementById('maint-result');
let   maintActive  = false;

function renderMaintState() {
    maintBtn.textContent = maintActive ? '🔴 Matikan Pemeliharaan' : '🟢 Nyalakan Pemeliharaan';
    maintBtn.className   = 'btn btn-block ' + (maintActive ? 'btn-danger' : 'btn-primary');
    maintBanner.style.display = '';
    maintBanner.className = 'status-banner ' + (maintActive ? 'active' : 'inactive');
    maintBanner.textContent = maintActive ? '● Banner pemeliharaan AKTIF di semua portal' : '○ Banner tidak aktif';
}

async function loadMaintenance() {
    const saKey = getSaKey(); if (!saKey) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/set-maintenance`, {
            headers: { 'x-superadmin-key': saKey },
        });
        if (!res.ok) throw new Error('Gagal memuat status');
        const data = await res.json();
        maintActive = !!data.active;
        if (data.message) maintMsgEl.value = data.message;
        renderMaintState();
    } catch (err) {
        maintBtn.textContent = 'Coba lagi';
        maintResult.textContent = err.message;
    }
}

maintBtn.addEventListener('click', async () => {
    const saKey = getSaKey(); if (!saKey) return;
    const next = !maintActive;
    const konfirmMsg = next
        ? 'Nyalakan banner pemeliharaan di SEMUA portal sekarang?'
        : 'Matikan banner pemeliharaan? Semua portal akan kembali normal.';
    if (!confirm(konfirmMsg)) return;
    maintBtn.disabled = true;
    maintResult.style.display = 'none';
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/set-maintenance`, {
            method:  'PATCH',
            headers: { 'x-superadmin-key': saKey, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ active: next, message: maintMsgEl.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan');
        maintActive = next;
        renderMaintState();
        maintResult.className = 'alert alert-success';
        maintResult.textContent = next
            ? 'Banner pemeliharaan dinyalakan. Semua portal akan menampilkannya.'
            : 'Banner pemeliharaan dimatikan.';
        maintResult.style.display = 'block';
    } catch (err) {
        maintResult.className = 'alert alert-danger';
        maintResult.textContent = err.message;
        maintResult.style.display = 'block';
    } finally {
        maintBtn.disabled = false;
    }
});

// ── Monitoring Penyimpanan Database ──────────────────────────
async function loadStorage() {
    const saKey = getSaKey(); if (!saKey) return;
    const summary = document.getElementById('storage-summary');
    const table   = document.getElementById('storage-table');
    const body    = document.getElementById('storage-body');
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-stats`, {
            headers: { 'x-superadmin-key': saKey },
        });
        if (!res.ok) throw new Error('Gagal memuat statistik penyimpanan');
        const data = await res.json();

        const mb = (data.db_size_bytes ?? 0) / (1024 * 1024);
        let color = '#16a34a', note = 'Aman';
        if (mb >= 500)      { color = '#dc2626'; note = 'Melewati kuota Free (±500 MB) — cek paket / bersihkan data'; }
        else if (mb >= 400) { color = '#b45309'; note = 'Mendekati kuota Free (±500 MB)'; }

        summary.innerHTML =
            `Ukuran database: <strong style="color:${color};font-size:16px">${esc(data.db_size_pretty)}</strong> ` +
            `<span style="color:${color}">— ${esc(note)}</span>`;

        body.innerHTML = (data.tables ?? []).map(t => `
            <tr>
                <td>${esc(t.name)}</td>
                <td style="text-align:right;white-space:nowrap">${esc(t.size_pretty)}</td>
                <td style="text-align:right">${t.est_rows < 0 ? '—' : Number(t.est_rows).toLocaleString('id-ID')}</td>
            </tr>`).join('');
        table.style.display = '';
    } catch (err) {
        summary.textContent = err.message;
    }
}

// Inisialisasi data dipicu oleh event dari auth.js setelah login sukses
document.addEventListener('superadmin-ready', () => {
    loadSchools();
    loadMaintenance();
    loadStorage();
});

// ── Wilayah (kecamatan, kabupaten, atau provinsi) ─────────────────────────────────────────
const JENJANG_OPSI = ['SMP', 'SMA', 'SMK'];

async function regionApi(body) {
    const saKey = getSaKey(); if (!saKey) throw new Error('Sesi berakhir');
    const res  = await fetch(`${SUPABASE_URL}/functions/v1/manage-region`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
        body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
    return data;
}

function showRegionMsg(msg, ok) {
    const el = document.getElementById('region-result');
    el.textContent = (ok ? '✓ ' : '✗ ') + msg;
    el.className = 'alert ' + (ok ? 'alert-success' : 'alert-danger');
    el.style.display = 'block';
}

function h(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') n.className = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
    return n;
}

// Daftar sekolah per wilayah bisa dilipat; wilayah yang sedang dibuka diingat agar tidak menutup sendiri
// setelah muat ulang (mis. sesudah menekan Simpan).
const _sekolahTerbuka = new Set();

// Kotak kredensial berada di bawah seluruh daftar wilayah; tampilkan lalu gulir ke sana agar tidak terlewat.
function tampilkanKredensialPegawai() {
    const kotak = document.getElementById('staff-cred-box');
    kotak.style.display = 'block';
    kotak.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
for (const [id, sumber] of [['staff-cred-copy-email', 'staff-cred-email'], ['staff-cred-copy-password', 'staff-cred-password']]) {
    const tombol = document.getElementById(id);
    if (!tombol) continue;
    const awal = tombol.textContent;
    tombol.addEventListener('click', async () => {
        const nilai = document.getElementById(sumber).textContent.trim();
        try { await navigator.clipboard.writeText(nilai); tombol.textContent = 'Tersalin ✓'; }
        catch { tombol.textContent = 'Gagal menyalin, pilih manual'; }
        setTimeout(() => { tombol.textContent = awal; }, 2000);
    });
}

async function loadRegions() {
    const listEl = document.getElementById('region-list');
    try {
        const d = await regionApi({ action: 'list' });
        listEl.replaceChildren();

        // pilihan kabupaten dan provinsi untuk tiap sekolah
        const idByKode = Object.fromEntries(d.regions.filter(r => r.kode).map(r => [r.kode, r.region_id]));
        const opsiKab  = d.regions.filter(r => r.level === 'KABUPATEN');
        const opsiProv = d.regions.filter(r => r.level === 'PROVINSI');
        const LEVEL_LABEL = { KECAMATAN: 'Kecamatan', KABUPATEN: 'Kabupaten', PROVINSI: 'Provinsi' };

        if (!d.regions.length) listEl.append(h('p', { class: 'hint' }, 'Belum ada wilayah. Buat satu di atas.'));

        const resetStaff = async (st) => {
            if (!confirm(`Buat kata sandi sementara baru untuk ${st.full_name}? Kata sandi lama langsung tidak berlaku.`)) return;
            try {
                const out = await regionApi({ action: 'reset_staff_password', auth_user_id: st.auth_user_id });
                document.getElementById('staff-cred-email').textContent    = out.email;
                document.getElementById('staff-cred-password').textContent = out.password;
                tampilkanKredensialPegawai();
                showRegionMsg(`Kata sandi sementara ${out.full_name} dibuat. Kotak kredensial ada di bagian bawah halaman ini.`, true);
            } catch (e) { showRegionMsg(e.message, false); }
        };
        const hapusStaff = async (st) => {
            if (!confirm(`Hapus akses ${st.full_name}? Akun login juga dihapus.`)) return;
            try { await regionApi({ action: 'remove_staff', auth_user_id: st.auth_user_id }); showRegionMsg('Pegawai dihapus.', true); loadRegions(); }
            catch (e) { showRegionMsg(e.message, false); }
        };
        const tombolStaff = (st) => [
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => resetStaff(st) }, 'Reset kata sandi'),
            h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => hapusStaff(st) }, 'Hapus'),
        ];

        // Tautan portal pegawai wilayah, siap disalin untuk dibagikan bersama kredensial
        const urlPortal = new URL('../kecamatan/', location.href).href;
        const barisTautan = () => {
            const kolomUrl = h('input', { class: 'input', type: 'text', readonly: true, value: urlPortal,
                                          style: 'flex:1;min-width:220px', 'aria-label': 'Tautan portal pegawai wilayah' });
            const tombolSalin = h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
                try { await navigator.clipboard.writeText(urlPortal); }
                catch { kolomUrl.select(); document.execCommand('copy'); }
                tombolSalin.textContent = 'Tersalin ✓';
                setTimeout(() => { tombolSalin.textContent = 'Salin tautan'; }, 2000);
            }}, 'Salin tautan');
            return h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 10px' },
                h('span', { class: 'hint' }, 'Portal pegawai wilayah:'), kolomUrl, tombolSalin);
        };

        for (const r of d.regions) {
            const card = h('div', { class: 'section-card' }, h('h3', {}, r.name));
            card.append(h('p', { class: 'hint' }, `Jenis: ${LEVEL_LABEL[r.level] ?? 'Kecamatan'}`));

            // sekolah
            const sekolahBox = h('details', { style: 'margin:6px 0' },
                h('summary', { style: 'cursor:pointer;font-weight:700;padding:4px 0' }, `Sekolah (${r.schools.length})`));
            if (_sekolahTerbuka.has(r.region_id)) sekolahBox.open = true;
            sekolahBox.addEventListener('toggle', () => {
                if (sekolahBox.open) _sekolahTerbuka.add(r.region_id); else _sekolahTerbuka.delete(r.region_id);
            });
            card.append(sekolahBox);
            if (!r.schools.length) sekolahBox.append(h('p', { class: 'hint' }, 'Belum ada sekolah.'));
            for (const s of r.schools) {
                const jen = h('select', { class: 'input', style: 'width:auto' },
                    h('option', { value: '' }, '— jenjang —'),
                    ...JENJANG_OPSI.map(j => h('option', { value: j, selected: s.jenjang === j }, j)));
                const pilihTingkat = (opsi, terpilih, label) => h('select', { class: 'input', style: 'width:auto', title: label },
                    h('option', { value: '' }, `— ${label} —`),
                    ...opsi.map(o => h('option', { value: o.region_id, selected: terpilih === o.region_id }, o.name)));
                // Bila belum diisi: turunkan dari kode kecamatan (7 digit -> kabupaten 4, provinsi 2).
                const defKab  = r.kode && r.kode.length === 7 ? idByKode[r.kode.slice(0, 4)] : null;
                const defProv = r.kode && r.kode.length === 7 ? idByKode[r.kode.slice(0, 2)] : null;
                const kab  = pilihTingkat(opsiKab,  s.kabupaten_id || defKab  || null, 'kabupaten');
                const prov = pilihTingkat(opsiProv, s.provinsi_id  || defProv || null, 'provinsi');
                const simpan = h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
                    try {
                        await regionApi({ action: 'assign_school', school_id: s.school_id, region_id: r.region_id, jenjang: jen.value || null,
                                          kabupaten_id: kab.value || null, provinsi_id: prov.value || null });
                        showRegionMsg(`Data ${s.name} disimpan.`, true); loadRegions();
                    } catch (e) { showRegionMsg(e.message, false); }
                }}, 'Simpan');
                const lepas = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
                    if (!confirm(`Lepas ${s.name} dari ${r.name}? Persetujuan berbagi akan direset.`)) return;
                    try {
                        await regionApi({ action: 'assign_school', school_id: s.school_id, region_id: null, kabupaten_id: null, provinsi_id: null, jenjang: s.jenjang });
                        showRegionMsg(`${s.name} dilepas dari wilayah.`, true); loadRegions(); loadSchools();
                    } catch (e) { showRegionMsg(e.message, false); }
                }}, 'Lepas');
                sekolahBox.append(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0' },
                    h('strong', {}, s.name), jen, kab, prov, simpan, lepas,
                    h('span', { class: (s.share_with_region || s.share_kabupaten || s.share_provinsi) ? 'badge badge-success' : 'badge' },
                        'Berbagi — kecamatan: ' + (s.share_with_region ? 'ya' : 'tidak') +
                        ' · kabupaten: ' + (s.kabupaten_id ? (s.share_kabupaten ? 'ya' : 'tidak') : '–') +
                        ' · provinsi: ' + (s.provinsi_id ? (s.share_provinsi ? 'ya' : 'tidak') : '–'))));
            }

            // tambah sekolah yang belum punya wilayah
            if (d.schools_tanpa_wilayah.length) {
                const pilih = h('select', { class: 'input', style: 'width:auto' },
                    h('option', { value: '' }, '+ tempatkan sekolah…'),
                    ...d.schools_tanpa_wilayah.map(s => h('option', { value: s.school_id }, s.name)));
                pilih.addEventListener('change', async () => {
                    if (!pilih.value) return;
                    const sk = d.schools_tanpa_wilayah.find(x => x.school_id === pilih.value);
                    try {
                        const kolom = { KABUPATEN: 'kabupaten_id', PROVINSI: 'provinsi_id' }[r.level] ?? 'region_id';
                        await regionApi({ action: 'assign_school', school_id: pilih.value, [kolom]: r.region_id, jenjang: sk.jenjang ?? null });
                        showRegionMsg(`${sk.name} ditempatkan di ${r.name}.`, true); loadRegions(); loadSchools();
                    } catch (e) { showRegionMsg(e.message, false); }
                });
                sekolahBox.append(pilih);
            }

            // pegawai: tabel di dalam kartu wilayahnya sendiri
            card.append(h('h4', { style: 'margin-top:14px' }, `Pegawai wilayah (${r.staff.length})`));
            card.append(barisTautan());
            if (!r.staff.length) {
                card.append(h('p', { class: 'hint' }, 'Belum ada pegawai.'));
            } else {
                const tdStyle = 'padding:6px 10px;text-align:left;border-bottom:1px solid var(--color-border, #2b3447);vertical-align:middle';
                card.append(h('div', { style: 'overflow-x:auto' },
                    h('table', { style: 'width:100%;border-collapse:collapse;font-size:.9rem' },
                        h('thead', {}, h('tr', {}, ...['Nama', 'Email', 'Aksi'].map(t => h('th', { style: tdStyle }, t)))),
                        h('tbody', {}, ...r.staff.map(st => h('tr', {},
                            h('td', { style: tdStyle }, h('strong', {}, st.full_name)),
                            h('td', { style: tdStyle }, st.email),
                            h('td', { style: tdStyle + ';white-space:nowrap' }, ...tombolStaff(st))))))));
            }
            const nama  = h('input', { class: 'input', placeholder: 'Nama lengkap pegawai', required: true, minlength: 3 });
            const email = h('input', { class: 'input', type: 'email', placeholder: 'email@instansi.go.id', required: true });
            const form  = h('form', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px', onsubmit: async (ev) => {
                ev.preventDefault();
                try {
                    const out = await regionApi({ action: 'add_staff', region_id: r.region_id, full_name: nama.value.trim(), email: email.value.trim() });
                    document.getElementById('staff-cred-email').textContent    = out.email;
                    document.getElementById('staff-cred-password').textContent = out.password;
                    tampilkanKredensialPegawai();
                    showRegionMsg(`Pegawai ${out.full_name} didaftarkan. Kotak kredensial ada di bagian bawah halaman ini.`, true);
                    nama.value = ''; email.value = ''; loadRegions();
                } catch (e) { showRegionMsg(e.message, false); }
            }}, nama, email, h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, '+ Daftarkan pegawai'));
            card.append(form);

            // hapus wilayah: selalu boleh, dengan konfirmasi yang menyebut dampaknya (sekolah dilepas, pegawai dihapus)
            card.append(h('div', { style: 'margin-top:14px;border-top:1px solid var(--color-border, #2b3447);padding-top:10px' },
                h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
                    const dampak = [];
                    if (r.schools.length) dampak.push(`${r.schools.length} sekolah akan dilepas dari wilayah ini dan persetujuan berbagi tingkat ini direset (kepala sekolah harus menyetujui ulang bila wilayah dibuat lagi)`);
                    if (r.staff.length)   dampak.push(`${r.staff.length} pegawai wilayah akan dihapus beserta akun loginnya`);
                    if (!confirm(`Hapus wilayah "${r.name}"?` + (dampak.length ? '\n\n- ' + dampak.join('\n- ') : '\n\nTidak ada sekolah atau pegawai yang terdampak.') + '\n\nTindakan ini tidak dapat dibatalkan.')) return;
                    try {
                        const out = await regionApi({ action: 'delete_region', region_id: r.region_id });
                        showRegionMsg(`Wilayah "${out.dihapus ?? r.name}" dihapus (${out.sekolah_dilepas ?? 0} sekolah dilepas, ${out.pegawai_dihapus ?? 0} pegawai dihapus).`, true);
                        loadSchools();
                        loadRegions();
                    } catch (e) { showRegionMsg(e.message, false); }
                }}, 'Hapus wilayah')));

            listEl.append(card);
        }
    } catch (e) {
        listEl.replaceChildren(h('p', { class: 'hint' }, 'Gagal memuat wilayah: ' + e.message));
    }
}

// Daftar wilayah resmi: superadmin memilih, tidak mengetik. Indeks provinsi ada di
// data/index.json; tiap provinsi punya berkasnya sendiri (dibuat oleh
// tools/buat-daftar-wilayah.mjs) dan dimuat saat provinsinya dipilih.
let _indeksProvinsi = null;
const _refProvinsi = {};
async function loadIndeksProvinsi() {
    if (_indeksProvinsi) return _indeksProvinsi;
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error('Daftar provinsi tidak dapat dimuat');
    _indeksProvinsi = await res.json();
    return _indeksProvinsi;
}
async function loadRefProvinsi(kode) {
    if (_refProvinsi[kode]) return _refProvinsi[kode];
    const entri = (await loadIndeksProvinsi()).find(p => p.kode === kode);
    if (!entri) throw new Error('Provinsi tidak ada dalam daftar');
    const res = await fetch('data/' + entri.berkas);
    if (!res.ok) throw new Error('Daftar wilayah ' + entri.nama + ' tidak dapat dimuat');
    _refProvinsi[kode] = await res.json();
    return _refProvinsi[kode];
}
const namaKab = (k) => (k.jenis === 'KOTA' ? 'Kota ' : 'Kabupaten ') + k.nama;
const namaProv = (p) => 'Provinsi ' + p.nama;

// Mengisi tiga pilihan bertingkat (provinsi, kabupaten/kota, kecamatan). Dipakai oleh
// formulir Wilayah dan pendaftaran sekolah. opsi.tanpaWilayah: tambah "— tanpa wilayah —".
function pasangPilihanWilayah(ids, opsi = {}) {
    const prov = document.getElementById(ids.prov);
    const kab  = document.getElementById(ids.kab);
    const kec  = document.getElementById(ids.kec);
    if (!prov || !kab || !kec) return { segarkan: async () => {} };

    const isiKab = async () => {
        let ref = null;
        if (prov.value) { try { ref = await loadRefProvinsi(prov.value); } catch { ref = null; } }
        const dulu = kab.value;
        kab.replaceChildren(h('option', { value: '' }, '\u2014 pilih kabupaten / kota \u2014'),
            ...(ref ? ref.kabupaten : []).map(k => h('option', { value: k.kode }, namaKab(k))));
        kab.value = ref && ref.kabupaten.some(k => k.kode === dulu) ? dulu : '';
        kab.disabled = !ref;
        const k = ref ? ref.kabupaten.find(x => x.kode === kab.value) : null;
        kec.replaceChildren(h('option', { value: '' }, '\u2014 pilih kecamatan \u2014'),
            ...(k ? k.kecamatan : []).map(c => h('option', { value: c.kode }, c.nama)));
        kec.disabled = !k;
    };

    const inisialisasi = async () => {
        let indeks;
        try { indeks = await loadIndeksProvinsi(); } catch { return; }
        prov.replaceChildren(
            ...(opsi.tanpaWilayah ? [h('option', { value: '' }, '\u2014 tanpa wilayah \u2014')]
                                  : [h('option', { value: '' }, '\u2014 pilih provinsi \u2014')]),
            ...indeks.map(p => h('option', { value: p.kode }, namaProv(p))));
        // Hanya satu provinsi pada daftar dan formulir tanpa opsi "tanpa wilayah": pilih langsung.
        if (!opsi.tanpaWilayah && indeks.length === 1) prov.value = indeks[0].kode;
        prov.addEventListener('change', isiKab);
        kab.addEventListener('change', isiKab);
        await isiKab();
    };
    inisialisasi();
    return { segarkan: isiKab };
}

// Rantai wilayah dari pilihan: provinsi selalu, kabupaten/kota bila dipilih, kecamatan bila dipilih.
async function rantaiDariPilihan(ids) {
    const provKode = document.getElementById(ids.prov).value;
    if (!provKode) return [];
    const ref = await loadRefProvinsi(provKode);
    const kab = ref.kabupaten.find(x => x.kode === document.getElementById(ids.kab).value);
    const kec = kab && kab.kecamatan.find(c => c.kode === document.getElementById(ids.kec).value);
    const rantai = [{ kode: ref.provinsi.kode, name: namaProv(ref.provinsi), level: 'PROVINSI' }];
    if (kab) rantai.push({ kode: kab.kode, name: namaKab(kab), level: 'KABUPATEN' });
    if (kab && kec) rantai.push({ kode: kec.kode, name: 'Kecamatan ' + kec.nama + ', ' + namaKab(kab), level: 'KECAMATAN' });
    return rantai;
}

// ── Formulir tab Wilayah ──
pasangPilihanWilayah({ prov: 'region-prov', kab: 'region-kab', kec: 'region-kec' });

document.getElementById('region-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = document.getElementById('region-create-btn'); btn.disabled = true;
    try {
        const rantai = await rantaiDariPilihan({ prov: 'region-prov', kab: 'region-kab', kec: 'region-kec' });
        if (!rantai.length) throw new Error('Pilih provinsi terlebih dahulu');

        let dibuat = 0, terakhir = null;
        for (const w of rantai) {
            const out = await regionApi({ action: 'ensure_region', kode: w.kode, name: w.name, level: w.level });
            if (out.dibuat) dibuat++;
            terakhir = out.region;
        }
        showRegionMsg(dibuat
            ? `Wilayah "${terakhir.name}" siap (${dibuat} baris baru).`
            : `Wilayah "${terakhir.name}" sudah ada.`, true);
        await loadRegions();
    } catch (e) { showRegionMsg(e.message, false); }
    finally { btn.disabled = false; }
});

document.querySelector('.tab-btn[data-tab="regions"]').addEventListener('click', loadRegions);
// Daftar sekolah memuat ulang saat tab dibuka, agar kotak penghubungan wilayah mengikuti perubahan di tab Wilayah.
document.querySelector('.tab-btn[data-tab="schools"]')?.addEventListener('click', loadSchools);

