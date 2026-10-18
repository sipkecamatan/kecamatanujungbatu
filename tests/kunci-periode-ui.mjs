// Uji asap tanpa peramban untuk kartu "Kunci Nilai Semester" (guru/js/kunci-periode-ui.js): logika status murni dan pemasangan pada tab Kepsek + Waka Kurikulum.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sumber = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + e.message); } };

// Modul memuat api.js (butuh peramban); logika murni diuji dengan menyalin fungsinya dari sumber.
const kode = sumber('guru/js/kunci-periode-ui.js');
const potong = kode.slice(kode.indexOf('export function ringkasStatusKunci'), kode.indexOf('/** ctx:')).replace('export function', 'function');
const ringkasStatusKunci = new Function(potong + '; return ringkasStatusKunci;')();

uji('status: semester belum ditutup -> AKTIF, tanpa tombol', () => {
  const r = ringkasStatusKunci({ closed: false, unlocked: false });
  assert.equal(r.kode, 'AKTIF'); assert.equal(r.bisaBuka, false); assert.equal(r.bisaKunci, false);
});
uji('status: ditutup dan belum dibuka -> TERKUNCI, tombol buka', () => {
  const r = ringkasStatusKunci({ closed: true, unlocked: false });
  assert.equal(r.kode, 'TERKUNCI'); assert.equal(r.bisaBuka, true); assert.equal(r.bisaKunci, false);
});
uji('status: ditutup dan dibuka -> DIBUKA, tombol kunci kembali', () => {
  const r = ringkasStatusKunci({ closed: true, unlocked: true });
  assert.equal(r.kode, 'DIBUKA'); assert.equal(r.bisaBuka, false); assert.equal(r.bisaKunci, true);
});
uji('status kosong/null tidak melempar galat', () => { assert.equal(ringkasStatusKunci(null).kode, 'AKTIF'); });
uji('api.js: tiga pembungkus RPC dengan nama fungsi server yang benar', () => {
  const a = sumber('guru/js/api.js');
  for (const f of ['fn_get_grade_period_status', 'fn_unlock_grade_period', 'fn_relock_grade_period']) assert.ok(a.includes(`rpc('${f}'`), f);
  for (const f of ['getGradePeriodStatus', 'unlockGradePeriod', 'relockGradePeriod']) assert.ok(a.includes(`export async function ${f}(`), f);
});
uji('dashboard.js: kartu dipasang di tab Kepsek dan Waka Kurikulum saja', () => {
  const d = sumber('guru/js/dashboard.js');
  assert.ok(d.includes("pasangKunciPeriode(document.getElementById('tab-kepsek')"));
  assert.ok(d.includes("pasangKunciPeriode(document.getElementById('tab-waka_kurikulum')"));
  assert.equal((d.match(/pasangKunciPeriode\(/g) || []).length, 2);
});
uji('alasan kosong/pendek ditolak di layar sebelum dikirim (minimal 10 karakter)', () => {
  assert.ok(/alasan\.length < 10/.test(kode));
});

console.log(`\nKUNCI_PERIODE_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
