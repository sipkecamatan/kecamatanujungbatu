// Dashboard Wilayah (kecamatan, kabupaten, atau provinsi) — SPA read-only. Hanya memanggil dua fungsi agregat:
//   fn_region_overview(p_days) dan fn_region_school_trend(p_school_id, p_weeks).
// Tidak membaca tabel sekolah mana pun secara langsung.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://lqgzpiohxdzkkmxjtwor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ3pwaW9oeGR6a2tteGp0d29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTA2MjksImV4cCI6MjEwNzQ2NjYyOX0.omL9CGL5Ckcm2SXquYbXHr-aE8mLUe6H9FewDou-Lp4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sip-kecamatan-auth' },
});

const $ = (id) => document.getElementById(id);
const state = { overview: null, jenjang: 'SEMUA', days: 30, pengingatDitunda: false, wajibGanti: false };

// Pengingat unduh: tanggal terakhir diunduh disimpan di peramban pegawai, tidak di server.
const KUNCI_UNDUH = 'sip-wilayah-terakhir-unduh';
const BATAS_HARI_UNDUH = 30;
function bacaTerakhirUnduh() {
  try { const v = localStorage.getItem(KUNCI_UNDUH); return v ? new Date(v) : null; } catch { return null; }
}
function simpanTerakhirUnduh() {
  try { localStorage.setItem(KUNCI_UNDUH, new Date().toISOString()); } catch { /* tanpa penyimpanan: pengingat tetap muncul */ }
}

function text(el, value) { el.textContent = value == null ? '' : String(value); return el; }
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
  return n;
}
const pct = (v) => (v == null ? '—' : `${v}%`);
// Hitungan piket: null berarti 1–4 kejadian yang disembunyikan server (ambang_piket = 5).
const piket = (v, ambang) => (v == null ? `< ${ambang ?? 5}` : String(v));
const tgl = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

const STATUS = {
  MEMADAI:            { label: 'Memadai',           cls: 'ok'   },
  DATA_BELUM_MEMADAI: { label: 'Data belum memadai', cls: 'warn' },
  BELUM_ADA_DATA:     { label: 'Belum ada data',    cls: 'bad'  },
  TIDAK_ADA_JADWAL:   { label: 'Tidak ada jadwal',  cls: 'none' },
};

function showView(name) {
  $('view-login').hidden = name !== 'login';
  $('view-app').hidden   = name !== 'app';
}
function setError(id, msg) { const e = $(id); text(e, msg); e.hidden = !msg; }

async function loadOverview() {
  setError('app-error', '');
  $('app-loading').hidden = false;
  $('cards').hidden = $('sekolah-card').hidden = $('method-card').hidden = $('trend-card').hidden = true;

  const { data, error } = await supabase.rpc('fn_region_overview', { p_days: state.days });
  $('app-loading').hidden = true;
  if (error) {
    const denied = error.code === '42501' || /akses ditolak/i.test(error.message || '');
    setError('app-error', denied
      ? 'Akun ini bukan akun pegawai wilayah, atau belum didaftarkan. Hubungi admin platform.'
      : 'Gagal memuat data. Coba lagi beberapa saat.');
    return;
  }
  state.overview = data;
  render();
}

// ── Unduh CSV ────────────────────────────────────────────────────
// Sel yang diawali = + - @ atau tab dipaksa menjadi teks agar tidak dibaca sebagai rumus.
function selCsv(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const barisCsv = (arr) => arr.map(selCsv).join(',');
const piketCsv = (v, ambang) => (v == null ? `< ${ambang ?? 5}` : v);

function bangunCsv(o) {
  const dibuat = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
  const baris = [
    ['SIP - Dashboard Wilayah'],
    ['Wilayah', o.wilayah ?? ''],
    ['Jendela waktu', `${o.dari} s.d. ${o.sampai} (${o.jendela_hari} hari)`],
    ['Diunduh', dibuat],
    ['Catatan', 'Angka agregat dari sekolah yang disetujui kepala sekolah; tidak memuat nama atau identitas siswa. Total tampil bila minimal 3 sekolah; keterlambatan dan izin keluar 1-4 ditulis "< 5"; kehadiran kosong bila cakupan input di bawah ' + o.ambang_cakupan_pct + '%.'],
    [],
  ];
  baris.push(['TOTAL']);
  if (o.total) {
    baris.push(['Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Kehadiran (%)', 'Terlambat', 'Izin keluar']);
    baris.push([o.total.siswa_aktif, o.total.orang_tua_aktif, o.total.cakupan_pct ?? '', o.total.kehadiran_pct ?? '',
                piketCsv(o.total.terlambat, o.ambang_piket), piketCsv(o.total.izin_keluar, o.ambang_piket)]);
  } else {
    baris.push(['Tidak ditampilkan: kurang dari 3 sekolah membagikan data']);
  }
  baris.push([], ['SEKOLAH'],
    ['Sekolah', 'Jenjang', 'Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Kehadiran (%)', 'Terlambat', 'Izin keluar', 'Status data']);
  for (const s of o.sekolah) {
    baris.push([s.nama, s.jenjang ?? '', s.siswa_aktif, s.orang_tua_aktif, s.cakupan_pct ?? '', s.kehadiran_pct ?? '',
                piketCsv(s.terlambat, o.ambang_piket), piketCsv(s.izin_keluar, o.ambang_piket),
                (STATUS[s.status] || STATUS.TIDAK_ADA_JADWAL).label]);
  }
  return '\uFEFF' + baris.map(barisCsv).join('\r\n') + '\r\n';
}

function unduhCsv() {
  const o = state.overview;
  if (!o) return;
  const nama = 'SIP-' + String(o.wilayah ?? 'wilayah').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
             + `-${o.dari}_${o.sampai}.csv`;
  const url = URL.createObjectURL(new Blob([bangunCsv(o)], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: nama });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  simpanTerakhirUnduh();
  perbaruiPengingat();
}

function perbaruiPengingat() {
  const kotak = $('pengingat');
  const terakhir = bacaTerakhirUnduh();
  const hari = terakhir ? Math.floor((Date.now() - terakhir.getTime()) / 86400000) : null;
  const perlu = !!state.overview && !state.pengingatDitunda && (hari === null || hari >= BATAS_HARI_UNDUH);
  kotak.hidden = !perlu;
  if (perlu) {
    text($('pengingat-teks'), hari === null
      ? 'Anda belum pernah mengunduh salinan data. Unduh secara berkala agar Anda memiliki arsip angka wilayah.'
      : `Terakhir diunduh ${hari} hari lalu. Unduh salinan data terbaru agar arsip Anda tetap mutakhir.`);
  }
}

function render() {
  const o = state.overview;
  if (!o) return;
  text($('wilayah'), `${o.wilayah ?? '—'} · ${tgl(o.dari)} – ${tgl(o.sampai)}`);
  text($('ambang'), o.ambang_cakupan_pct);

  // Kartu ringkasan
  const cards = $('cards'); cards.replaceChildren();
  const stat = (k, v, s) => el('div', { class: 'stat' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), el('div', { class: 's' }, s));
  cards.append(
    stat('Sekolah menampilkan data', `${o.jumlah_sekolah_dibagikan} dari ${o.jumlah_sekolah_terdaftar}`, 'sekolah terdaftar di wilayah ini'),
    o.total
      ? stat('Siswa aktif', o.total.siswa_aktif, 'seluruh sekolah yang tampil')
      : stat('Siswa aktif', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    o.total
      ? stat('Orang tua aktif', o.total.orang_tua_aktif, 'akun orang tua terdaftar di sekolah yang tampil')
      : stat('Orang tua aktif', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    o.total
      ? stat('Cakupan input', pct(o.total.cakupan_pct), 'sesi terjadwal yang sudah dicatat')
      : stat('Cakupan input', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    o.total
      ? stat('Kehadiran', pct(o.total.kehadiran_pct), 'hanya dari sekolah dengan data memadai')
      : stat('Kehadiran', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    o.total
      ? stat('Terlambat', piket(o.total.terlambat, o.ambang_piket), 'catatan guru piket pada jendela waktu')
      : stat('Terlambat', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    o.total
      ? stat('Izin keluar', piket(o.total.izin_keluar, o.ambang_piket), 'catatan guru piket pada jendela waktu')
      : stat('Izin keluar', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
  );
  cards.hidden = false;

  // Filter jenjang
  const jenjangs = ['SEMUA', ...new Set(o.sekolah.map((s) => s.jenjang || 'TIDAK_DIKETAHUI'))];
  const chips = $('filter-jenjang'); chips.replaceChildren();
  for (const j of jenjangs) {
    chips.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.jenjang === j),
      onclick: () => { state.jenjang = j; render(); },
    }, j === 'SEMUA' ? 'Semua' : j));
  }

  // Tabel sekolah (tanpa pengurutan menurut metrik: urutan tetap jenjang lalu nama)
  const tb = $('tbl-sekolah').querySelector('tbody'); tb.replaceChildren();
  const rows = o.sekolah.filter((s) => state.jenjang === 'SEMUA' || (s.jenjang || 'TIDAK_DIKETAHUI') === state.jenjang);
  if (!rows.length) {
    tb.append(el('tr', {}, el('td', { colspan: 9, class: 'muted' }, 'Belum ada sekolah yang membagikan data pada filter ini.')));
  }
  for (const s of rows) {
    const st = STATUS[s.status] || STATUS.TIDAK_ADA_JADWAL;
    const cov = s.cakupan_pct;
    tb.append(el('tr', { class: 'row-sekolah', onclick: () => loadTrend(s) },
      el('td', {}, el('button', { class: 'link', type: 'button' }, s.nama)),
      el('td', {}, s.jenjang || '—'),
      el('td', { class: 'num' }, s.siswa_aktif),
      el('td', { class: 'num' }, s.orang_tua_aktif),
      el('td', { class: 'num' },
        cov == null ? '—' : [el('span', { class: 'bar' }, el('span', { style: `width:${Math.min(cov, 100)}%` })), `${cov}%`]),
      el('td', { class: 'num' }, pct(s.kehadiran_pct)),
      el('td', { class: 'num' }, piket(s.terlambat, o.ambang_piket)),
      el('td', { class: 'num' }, piket(s.izin_keluar, o.ambang_piket)),
      el('td', {}, el('span', { class: `badge ${st.cls}` }, st.label)),
    ));
  }
  $('sekolah-card').hidden = false;
  $('method-card').hidden = false;
  perbaruiPengingat();
}

async function loadTrend(s) {
  const card = $('trend-card');
  text($('trend-title'), `Tren mingguan — ${s.nama}`);
  const tb = $('tbl-trend').querySelector('tbody');
  tb.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Memuat…')));
  card.hidden = false;
  const { data, error } = await supabase.rpc('fn_region_school_trend', { p_school_id: s.school_id, p_weeks: 6 });
  tb.replaceChildren();
  if (error || !data || !data.length) {
    tb.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, error ? 'Gagal memuat tren.' : 'Belum ada data pada rentang ini.')));
    return;
  }
  for (const r of data) {
    tb.append(el('tr', {},
      el('td', {}, tgl(r.minggu_mulai)),
      el('td', { class: 'num' }, r.sesi_terjadwal),
      el('td', { class: 'num' }, r.sesi_tercatat),
      el('td', { class: 'num' }, pct(r.cakupan_pct)),
      el('td', { class: 'num' }, pct(r.kehadiran_pct)),
    ));
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Login / logout ───────────────────────────────────────────────
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('login-error', '');
  const btn = $('login-btn'); btn.disabled = true; text(btn, 'Masuk…');
  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(), password: $('password').value,
  });
  btn.disabled = false; text(btn, 'Masuk');
  if (error) { setError('login-error', 'Email atau kata sandi salah.'); return; }
  $('password').value = '';
  enterApp();
});

$('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  state.overview = null;
  showView('login');
});
$('unduh-btn').addEventListener('click', unduhCsv);
$('pengingat-unduh').addEventListener('click', unduhCsv);
$('pengingat-nanti').addEventListener('click', () => { state.pengingatDitunda = true; perbaruiPengingat(); });
$('window').addEventListener('change', (e) => { state.days = Number(e.target.value); loadOverview(); });

// ── Ganti kata sandi ─────────────────────────────────────────────
// Kata sandi lama diverifikasi dulu lewat signInWithPassword agar sesi yang
// tertinggal di komputer bersama tidak bisa dipakai mengganti kata sandi.
function resetPwForm() {
  $('pw-form').reset();
  setError('pw-error', '');
  $('pw-ok').hidden = true;
}
$('pw-open-btn').addEventListener('click', () => { resetPwForm(); $('pw-dialog').showModal(); });
$('pw-cancel').addEventListener('click', () => $('pw-dialog').close());
// Saat penggantian wajib, dialog tidak boleh ditutup dengan Esc.
$('pw-dialog').addEventListener('cancel', (e) => { if (state.wajibGanti) e.preventDefault(); });

// Akun baru atau yang baru direset membawa penanda must_change_password. Selama penanda
// ada, server menolak data (fn_region_staff_region mengembalikan NULL), dan dasbor
// memaksa dialog ini sebelum memuat apa pun.
function perluGantiSandi(user) {
  const v = user?.user_metadata?.must_change_password;
  return v === true || v === 'true';
}
function bukaGantiWajib() {
  state.wajibGanti = true;
  resetPwForm();
  $('pw-wajib').hidden = false;
  $('pw-cancel').hidden = true;
  $('app-loading').hidden = true;
  if (!$('pw-dialog').open) $('pw-dialog').showModal();
}
function tutupGantiWajib() {
  state.wajibGanti = false;
  $('pw-wajib').hidden = true;
  $('pw-cancel').hidden = false;
  if ($('pw-dialog').open) $('pw-dialog').close();
}
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('pw-error', '');
  $('pw-ok').hidden = true;
  const cur = $('pw-current').value, nw = $('pw-new').value, cf = $('pw-confirm').value;
  if (nw.length < 10)  { setError('pw-error', 'Kata sandi baru minimal 10 karakter.'); return; }
  if (nw !== cf)       { setError('pw-error', 'Pengulangan kata sandi tidak sama.'); return; }
  if (nw === cur)      { setError('pw-error', 'Kata sandi baru harus berbeda dari yang lama.'); return; }

  const btn = $('pw-submit'); btn.disabled = true;
  try {
    const { data: s } = await supabase.auth.getSession();
    const email = s.session?.user?.email;
    const chk = await supabase.auth.signInWithPassword({ email, password: cur });
    if (chk.error) { setError('pw-error', 'Kata sandi saat ini salah.'); return; }
    const { error } = await supabase.auth.updateUser({ password: nw, data: { must_change_password: false } });
    if (error) { setError('pw-error', 'Gagal menyimpan: ' + error.message); return; }
    // Token lama masih membawa penanda; segarkan agar server menerima permintaan berikutnya.
    await supabase.auth.refreshSession();
    $('pw-form').reset();
    if (state.wajibGanti) {
      tutupGantiWajib();
      await loadOverview();
      return;
    }
    text($('pw-ok'), 'Kata sandi berhasil diganti.');
    $('pw-ok').hidden = false;
    setTimeout(() => $('pw-dialog').close(), 1500);
  } finally {
    btn.disabled = false;
  }
});

async function enterApp() {
  showView('app');
  const { data } = await supabase.auth.getSession();
  if (perluGantiSandi(data.session?.user)) { bukaGantiWajib(); return; }
  await loadOverview();
}

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) enterApp(); else showView('login');
})();
