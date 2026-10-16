// Dashboard Wilayah (kecamatan, kabupaten, atau provinsi) — SPA read-only. Hanya memanggil dua fungsi agregat:
//   fn_region_overview_range(p_from, p_to) dan fn_region_school_trend_range(p_school_id, p_from, p_to, p_granularitas).
// Tidak membaca tabel sekolah mana pun secara langsung.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { saringSekolah, urutkanSekolah, potong } from './daftar.js';
import { nilaiStatus, nilaiStatusCsv } from './format.js';

const SUPABASE_URL      = 'https://lqgzpiohxdzkkmxjtwor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ3pwaW9oeGR6a2tteGp0d29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTA2MjksImV4cCI6MjEwNzQ2NjYyOX0.omL9CGL5Ckcm2SXquYbXHr-aE8mLUe6H9FewDou-Lp4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sip-kecamatan-auth' },
});

const $ = (id) => document.getElementById(id);
const state = { overview: null, jenjang: 'SEMUA', kataSekolah: '', urutanSekolah: 'nama-asc', sekolahTampil: 50, periode: '30', dari: null, sampai: null, pengingatDitunda: false, wajibGanti: false };

// Alamat dasbor per tingkat. Alamat hanya pintu masuk: tingkat pegawai ditentukan server dari akun yang masuk,
// tidak pernah dari alamat. Akun yang membuka alamat tingkat lain dialihkan ke alamat tingkatnya (daftar tetap, bukan
// masukan pengguna). Sesi dipakai bersama karena ketiga alamat satu asal.
const ALAMAT_TINGKAT = { KECAMATAN: '../kecamatan/', KABUPATEN: '../kabupaten/', PROVINSI: '../provinsi/' };
const TINGKAT_HALAMAN = document.body.dataset.tingkat || 'KECAMATAN';

// Pengingat unduh: tanggal terakhir diunduh disimpan di peramban pegawai, tidak di server.
const KUNCI_UNDUH = 'sip-wilayah-terakhir-unduh';
const BATAS_HARI_UNDUH = 30;
function bacaTerakhirUnduh() {
  try { const v = localStorage.getItem(KUNCI_UNDUH); return v ? new Date(v) : null; } catch { return null; }
}
function simpanTerakhirUnduh() {
  try { localStorage.setItem(KUNCI_UNDUH, new Date().toISOString()); } catch { /* tanpa penyimpanan: pengingat tetap muncul */ }
}

// Layar sempit: tiap sel membawa judul kolomnya (data-label) agar baris tabel bisa tampil sebagai kartu.
function labelKolom(tableId) {
  const t = $(tableId);
  const judul = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  for (const tr of t.querySelectorAll('tbody tr')) {
    [...tr.children].forEach((td, i) => { if (!td.hasAttribute('colspan') && judul[i]) td.setAttribute('data-label', judul[i]); });
  }
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
const statusValue = nilaiStatus;
function statusCell(row, key) {
  const value = statusValue(row, key);
  return value === '< 5' ? el('span', { title: 'kurang dari 5 catatan' }, value) : value;
}
const statusCsv = nilaiStatusCsv;
// Nama wilayah di daftar resmi memuat induknya ("Kecamatan Ujung Batu, Kabupaten Rokan Hulu"). Pegawai hanya
// mengenal nama wilayahnya sendiri, jadi yang ditampilkan hanya bagian sebelum koma pertama.
const namaWilayah = (o) => String(o?.wilayah ?? '').split(',')[0].trim();
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

// ── Periode ──────────────────────────────────────────────────────
// Tanggal dihitung di peramban (zona waktu pegawai) lalu dikirim sebagai YYYY-MM-DD.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function hitungRentang() {
  const kini = new Date(); kini.setHours(0, 0, 0, 0);
  const p = state.periode, y = kini.getFullYear(), m = kini.getMonth();
  if (/^[0-9]+$/.test(p)) { const a = new Date(kini); a.setDate(a.getDate() - (Number(p) - 1)); return { dari: iso(a), sampai: iso(kini) }; }
  if (p === 'bulan-ini')   return { dari: iso(new Date(y, m, 1)), sampai: iso(kini) };
  if (p === 'bulan-lalu')  return { dari: iso(new Date(y, m - 1, 1)), sampai: iso(new Date(y, m, 0)) };
  if (p === 'semester')    return { dari: iso(new Date(y, m >= 6 ? 6 : 0, 1)), sampai: iso(kini) };       // Jul–Des atau Jan–Jun
  if (p === 'tahun-ajaran') return { dari: iso(new Date(m >= 6 ? y : y - 1, 6, 1)), sampai: iso(kini) };   // mulai 1 Juli
  if (p === 'tahun')       return { dari: iso(new Date(y, 0, 1)), sampai: iso(kini) };
  if (p === 'bebas') {
    const a = $('tgl-dari').value, b = $('tgl-sampai').value;
    if (!a || !b || a > b || (new Date(b) - new Date(a)) / 86400000 > 365) return null;
    return { dari: a, sampai: b > iso(kini) ? iso(kini) : b };
  }
  return null;
}

async function loadOverview() {
  setError('app-error', '');
  $('app-loading').hidden = false;
  $('cards').hidden = $('jenjang-card').hidden = $('sekolah-card').hidden = $('method-card').hidden = $('trend-card').hidden = true;

  const r = hitungRentang();
  if (!r) { $('app-loading').hidden = true; setError('app-error', 'Rentang tanggal tidak valid: awal harus sebelum akhir, paling lama 366 hari.'); return; }
  state.dari = r.dari; state.sampai = r.sampai;
  const { data, error } = await supabase.rpc('fn_region_overview_range', {
    p_from: r.dari, p_to: r.sampai,
  });
  $('app-loading').hidden = true;
  if (error) {
    const denied = error.code === '42501' || /akses ditolak/i.test(error.message || '');
    setError('app-error', denied
      ? 'Akun ini bukan akun pegawai wilayah, atau belum didaftarkan. Hubungi admin platform.'
      : 'Gagal memuat data. Coba lagi beberapa saat.');
    return;
  }
  if (data?.mode_kelompok != null) {
    state.overview = null;
    setError('app-error', 'Server belum diperbarui. Hubungi operator.');
    return;
  }
  if (data?.tingkat && data.tingkat !== TINGKAT_HALAMAN && ALAMAT_TINGKAT[data.tingkat]) {
    location.replace(new URL(ALAMAT_TINGKAT[data.tingkat], location.href).href);
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
    ['Wilayah', namaWilayah(o)],
    ['Periode', `${o.dari} s.d. ${o.sampai} (${o.jendela_hari} hari)`],
    ['Diunduh', dibuat],
    ['Catatan', `Angka agregat dari sekolah yang disetujui kepala sekolah; satuan absensi adalah catatan siswa x sesi. Tidak memuat nama atau identitas siswa. Total tampil bila minimal 3 sekolah; status absensi 1-4 ditulis "< 5"; persentase kosong bila cakupan input di bawah ${o.ambang_cakupan_pct}%.`],
    [],
  ];
  baris.push(['TOTAL']);
  if (o.total) {
    baris.push(['Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Hadir (%)', 'Sakit (%)', 'Izin (%)', 'Alpa (%)', 'Terlambat', 'Izin keluar']);
    baris.push([o.total.siswa_aktif, o.total.orang_tua_aktif, o.total.cakupan_pct ?? '', statusCsv(o.total, 'kehadiran_pct'), statusCsv(o.total, 'sakit_pct'), statusCsv(o.total, 'izin_pct'), statusCsv(o.total, 'alpa_pct'),
                piketCsv(o.total.terlambat, o.ambang_piket), piketCsv(o.total.izin_keluar, o.ambang_piket)]);
  } else {
    baris.push(['Tidak ditampilkan: kurang dari 3 sekolah membagikan data']);
  }
  baris.push([], ['SUBTOTAL JENJANG']);
  if (o.per_jenjang && o.per_jenjang.length) {
    baris.push(['Jenjang', 'Sekolah', 'Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Hadir (%)', 'Sakit (%)', 'Izin (%)', 'Alpa (%)', 'Terlambat', 'Izin keluar']);
    for (const j of o.per_jenjang) {
      baris.push([j.jenjang, j.jumlah_sekolah, j.siswa_aktif, j.orang_tua_aktif, j.cakupan_pct ?? '', statusCsv(j, 'kehadiran_pct'), statusCsv(j, 'sakit_pct'), statusCsv(j, 'izin_pct'), statusCsv(j, 'alpa_pct'),
                  piketCsv(j.terlambat, o.ambang_piket), piketCsv(j.izin_keluar, o.ambang_piket)]);
    }
  } else {
    baris.push(['Tidak ditampilkan: tidak ada jenjang dengan minimal 2 sekolah yang membagikan data']);
  }
  if (o.sekolah && o.sekolah.length) {
    baris.push([], ['SEKOLAH'],
      ['Sekolah', 'Jenjang', 'Siswa aktif', 'Orang tua aktif', 'Cakupan input (%)', 'Hadir (%)', 'Sakit (%)', 'Izin (%)', 'Alpa (%)', 'Terlambat', 'Izin keluar', 'Status data']);
    for (const s of urutkanSekolah(o.sekolah, 'nama-asc')) {
      baris.push([s.nama, s.jenjang ?? '', s.siswa_aktif, s.orang_tua_aktif, s.cakupan_pct ?? '', statusCsv(s, 'kehadiran_pct'), statusCsv(s, 'sakit_pct'), statusCsv(s, 'izin_pct'), statusCsv(s, 'alpa_pct'),
                  piketCsv(s.terlambat, o.ambang_piket), piketCsv(s.izin_keluar, o.ambang_piket),
                  (STATUS[s.status] || STATUS.TIDAK_ADA_JADWAL).label]);
    }
  }
  return '\uFEFF' + baris.map(barisCsv).join('\r\n') + '\r\n';
}

function unduhCsv() {
  const o = state.overview;
  if (!o) return;
  const nama = 'SIP-' + String(namaWilayah(o) || 'wilayah').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
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
  text($('wilayah'), `${namaWilayah(o) || '—'} · ${tgl(o.dari)} – ${tgl(o.sampai)}`);
  text($('ambang'), o.ambang_cakupan_pct);

  // Kartu ringkasan
  const cards = $('cards'); cards.replaceChildren();
  const stat = (k, v, s, cls = '') => el('div', { class: `stat${cls ? ` ${cls}` : ''}` }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), el('div', { class: 's' }, s));
  cards.append(
    stat('Sekolah menampilkan data', o.jumlah_sekolah_dibagikan, 'sekolah yang membagikan ringkasan kepada wilayah ini'),
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
      ? stat('Hadir', pct(o.total.kehadiran_pct), 'hanya dari sekolah dengan data memadai')
      : stat('Hadir', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    ...[['Sakit', 'sakit_pct'], ['Izin', 'izin_pct'], ['Alpa', 'alpa_pct']].map(([judul, kunci]) => (o.total
      ? stat(judul, statusValue(o.total, kunci), '% dari catatan absensi (siswa x sesi)')
      : stat(judul, '—', 'total tampil bila ≥ 3 sekolah membagikan data'))),
    o.total
      ? stat('Terlambat', piket(o.total.terlambat, o.ambang_piket), 'catatan guru piket pada periode terpilih')
      : stat('Terlambat', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
    o.total
      ? stat('Izin keluar', piket(o.total.izin_keluar, o.ambang_piket), 'catatan guru piket pada periode terpilih')
      : stat('Izin keluar', '—', 'total tampil bila ≥ 3 sekolah membagikan data'),
  );
  cards.hidden = false;

  // Subtotal per jenjang: server hanya mengirim jenjang yang memiliki >= 2 sekolah berbagi.
  const tj = $('tbl-jenjang').querySelector('tbody'); tj.replaceChildren();
  for (const j of o.per_jenjang ?? []) {
    tj.append(el('tr', {},
      el('td', {}, j.jenjang === 'TIDAK_DIKETAHUI' ? '—' : j.jenjang),
      el('td', { class: 'num' }, j.jumlah_sekolah),
      el('td', { class: 'num' }, j.siswa_aktif),
      el('td', { class: 'num' }, j.orang_tua_aktif),
      el('td', { class: 'num' }, pct(j.cakupan_pct)),
      el('td', { class: 'num' }, pct(j.kehadiran_pct)),
      el('td', { class: 'num' }, statusCell(j, 'sakit_pct')),
      el('td', { class: 'num' }, statusCell(j, 'izin_pct')),
      el('td', { class: 'num' }, statusCell(j, 'alpa_pct')),
      el('td', { class: 'num' }, piket(j.terlambat, o.ambang_piket)),
      el('td', { class: 'num' }, piket(j.izin_keluar, o.ambang_piket)),
    ));
  }
  labelKolom('tbl-jenjang');
  $('jenjang-card').hidden = !(o.per_jenjang && o.per_jenjang.length);

  // Filter jenjang
  const jenjangs = ['SEMUA', ...new Set(o.sekolah.map((s) => s.jenjang || 'TIDAK_DIKETAHUI'))];
  const chips = $('filter-jenjang'); chips.replaceChildren();
  for (const j of jenjangs) {
    chips.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.jenjang === j),
      onclick: () => { state.jenjang = j; state.sekolahTampil = 50; render(); },
    }, j === 'SEMUA' ? 'Semua' : j));
  }

  renderSchoolList(o);
  $('sekolah-card').hidden = false;
  $('method-card').hidden = false;
  perbaruiPengingat();
}

function renderSchoolList(o) {
  const tb = $('tbl-sekolah').querySelector('tbody'); tb.replaceChildren();
  const tersaring = saringSekolah(o.sekolah || [], { jenjang: state.jenjang, kata: state.kataSekolah });
  const terurut = urutkanSekolah(tersaring, state.urutanSekolah);
  const rows = potong(terurut, state.sekolahTampil);
  text($('sekolah-count'), `Menampilkan ${rows.length} dari ${terurut.length} sekolah`);
  $('sekolah-empty').hidden = terurut.length !== 0;
  $('sekolah-more').hidden = rows.length >= terurut.length;
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
      el('td', { class: 'num' }, statusCell(s, 'sakit_pct')),
      el('td', { class: 'num' }, statusCell(s, 'izin_pct')),
      el('td', { class: 'num' }, statusCell(s, 'alpa_pct')),
      el('td', { class: 'num' }, piket(s.terlambat, o.ambang_piket)),
      el('td', { class: 'num' }, piket(s.izin_keluar, o.ambang_piket)),
      el('td', {}, el('span', { class: `badge ${st.cls}` }, st.label)),
    ));
  }
  labelKolom('tbl-sekolah');
}

async function loadTrend(s) {
  const card = $('trend-card');
  const bulanan = (new Date(state.sampai) - new Date(state.dari)) / 86400000 > 90;
  text($('trend-title'), `Tren ${bulanan ? 'bulanan' : 'mingguan'} — ${s.nama}`);
  text($('th-periode'), bulanan ? 'Bulan mulai' : 'Minggu mulai');
  const tb = $('tbl-trend').querySelector('tbody');
  tb.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Memuat…')));
  card.hidden = false;
  const { data, error } = await supabase.rpc('fn_region_school_trend_range', {
    p_school_id: s.school_id, p_from: state.dari, p_to: state.sampai, p_granularitas: bulanan ? 'BULAN' : 'MINGGU' });
  tb.replaceChildren();
  if (error || !data || !data.length) {
    tb.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, error ? 'Gagal memuat tren.' : 'Belum ada data pada rentang ini.')));
    return;
  }
  for (const r of data) {
    tb.append(el('tr', {},
      el('td', {}, tgl(r.periode_mulai)),
      el('td', { class: 'num' }, r.sesi_terjadwal),
      el('td', { class: 'num' }, r.sesi_tercatat),
      el('td', { class: 'num' }, pct(r.cakupan_pct)),
      el('td', { class: 'num' }, pct(r.kehadiran_pct)),
    ));
  }
  labelKolom('tbl-trend');
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
  if (error) {
    const batas = error.status === 429 || /rate limit/i.test(error.message || '');
    const jaringan = error.status === 0 || /fetch|network/i.test(error.message || '');
    setError('login-error', batas ? 'Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi.'
      : jaringan ? 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.'
      : 'Email atau kata sandi salah. Kata sandi sementara hanya berlaku bila belum ada reset yang lebih baru.');
    return;
  }
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
$('sekolah-search').addEventListener('input', (e) => {
  state.kataSekolah = e.target.value;
  state.sekolahTampil = 50;
  if (state.overview) renderSchoolList(state.overview);
});
$('sekolah-sort').addEventListener('change', (e) => {
  state.urutanSekolah = e.target.value;
  state.sekolahTampil = 50;
  if (state.overview) renderSchoolList(state.overview);
});
$('sekolah-more').addEventListener('click', () => {
  state.sekolahTampil += 50;
  if (state.overview) renderSchoolList(state.overview);
});
$('window').addEventListener('change', (e) => {
  state.periode = e.target.value;
  const bebas = state.periode === 'bebas';
  $('rentang-bebas').hidden = !bebas;
  if (bebas) {
    if (!$('tgl-dari').value && state.dari) { $('tgl-dari').value = state.dari; $('tgl-sampai').value = state.sampai; }
    return; // menunggu tombol Terapkan
  }
  loadOverview();
});
$('rentang-terapkan').addEventListener('click', loadOverview);

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
