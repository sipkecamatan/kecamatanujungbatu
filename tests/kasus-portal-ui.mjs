// Uji statis (tanpa jaringan) untuk perubahan klien keputusan Romo 18 Okt 2026: siswa/orang tua tidak membaca judul dan deskripsi kasus; panel pembaca guru diperbarui dan berlabel dari server.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sumber = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + e.message); } };

uji('portal siswa: membaca kasus lewat fn_portal_cases, tidak lagi dari tabel coaching_cases', () => {
  const a = sumber('student/js/api.js');
  const fn = a.slice(a.indexOf('export async function getMyCases'), a.indexOf('export async function getMyObservations'));
  assert.ok(fn.includes("rpc('fn_portal_cases'"));
  assert.ok(!fn.includes("from('coaching_cases')"));
  assert.ok(!/title|description/.test(fn.replace(/\/\/.*$/gm, '')), 'fungsi tidak boleh meminta title/description');
});
uji('portal orang tua: membaca kasus lewat fn_portal_cases, tidak lagi dari tabel coaching_cases', () => {
  const a = sumber('parent/js/api.js');
  const fn = a.slice(a.indexOf('export async function fetchCases'), a.indexOf('export async function fetchPklPlacement'));
  assert.ok(fn.includes("rpc('fn_portal_cases'"));
  assert.ok(!fn.includes("from('coaching_cases')"));
  assert.ok(!/title|description/.test(fn.replace(/\/\/.*$/gm, '')), 'fungsi tidak boleh meminta title/description');
});
uji('tampilan siswa dan orang tua: tidak merender judul maupun deskripsi kasus', () => {
  for (const p of ['student/js/dashboard.js', 'parent/js/portal.js']) {
    const s = sumber(p);
    assert.ok(!/esc\(c\.title\)/.test(s), p + ' masih merender judul');
    assert.ok(!/esc\(c\.description\)/.test(s), p + ' masih merender deskripsi');
    assert.ok(s.includes('Kasus pembinaan'), p + ' tidak memakai judul netral');
  }
});
uji('panel pembaca guru: refreshKasusDetail ikut menggambar ulang panel pembaca (nomor urut baru)', () => {
  const d = sumber('guru/js/dashboard.js');
  const fn = d.slice(d.indexOf('async function refreshKasusDetail'), d.indexOf('// ─── TAB PIKET'));
  assert.ok(fn.includes('renderKasusViewers(kasus, ctx, seq)'));
});
uji('panel pembaca guru: label hubungan dari server (relation_label) diprioritaskan', () => {
  const d = sumber('guru/js/dashboard.js');
  assert.ok(/const labelPembaca = v => v\.relation_label \?\?/.test(d));
});
uji('teks panel pembaca jujur: status, nama penangan, komentar terlihat; judul dan deskripsi tidak', () => {
  const d = sumber('guru/js/dashboard.js');
  assert.ok(d.includes('judul dan deskripsi kasus tidak'));
  assert.ok(!d.includes('orang tua dan siswa hanya melihat komentar yang ditandai terlihat.'));
});

console.log(`\nKASUS_PORTAL_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
