// Uji statis (tanpa jaringan): Kepala Sekolah dikeluarkan dari Pembinaan Siswa dan hanya melihat angka agregat di dashboard-nya (keputusan Romo 18 Okt 2026),
// serta perbaikan tampilan antrean luring (dikirim otomatis saat online harus menyegarkan panel antrean dan daftar kasus).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sumber = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + e.message); } };
const js = sumber('guru/js/dashboard.js'), html = sumber('guru/dashboard.html'), api = sumber('guru/js/api.js');

uji('tab Kepala Sekolah: kartu Monitoring Pembinaan Siswa (daftar kasus) diganti ringkasan agregat', () => {
  assert.ok(!/ks-kasus/.test(html), 'masih ada elemen ks-kasus pada HTML');
  assert.ok(html.includes('id="ks-pembinaan-ringkasan"'));
  assert.ok(!html.includes('Monitoring Pembinaan Siswa'));
});
uji('tab Pembinaan Siswa tidak dibuat untuk Kepala Sekolah', () => {
  assert.ok(/if \(!jabatan\.includes\('kepsek'\)\) tabs\.push\(\{ key: 'kasus'/.test(js));
});
uji('kode daftar kasus Kepsek dihapus; ringkasan memakai fn_kepsek_case_summary lewat API', () => {
  assert.ok(!js.includes('initKepsekKasusSection') && !js.includes('_ksKasusCtx'));
  assert.ok(js.includes('loadKepsekKasusRingkasan()'));
  assert.ok(/export async function getKepsekCaseSummary\(\)[\s\S]*?rpc\('fn_kepsek_case_summary'\)/.test(api));
});
uji('ringkasan hanya merender angka (tidak meminta judul, deskripsi, atau nama siswa)', () => {
  const fn = js.slice(js.indexOf('async function loadKepsekKasusRingkasan'), js.indexOf('async function loadKepsekKasusRingkasan') + 2200);
  assert.ok(!/\.title|\.description|student|full_name/.test(fn), 'ringkasan merujuk data peka');
});
uji('peran Kepsek dicabut dari kontrol kasus di layar (pengawas, buka kembali, aksi, tutup, eskalasi)', () => {
  assert.ok(!/const isKepsek = currentUser\.role_type === 'KEPSEK'/.test(js));
  assert.ok(/const bisaBukaKembali = kasus\.status === 'CLOSED' && currentUser\.role_type === 'WAKA_KESISWAAN'/.test(js));
  assert.ok(/const canClose = !bisaBukaKembali && isHandler;/.test(js));
  assert.ok(/const pengawas = currentUser\.role_type === 'WAKA_KESISWAAN';/.test(js));
  assert.ok(/const isOversight = currentUser\.role_type === 'WAKA_KESISWAAN' && !isCreator && !isHandler;/.test(js));
  for (const baris of js.match(/const (INTERNAL_CASE_ROLES|ESCALATION_CHAIN)[\s\S]*?;/g) ?? []) assert.ok(!baris.includes('KEPSEK'), baris.slice(0, 80));
  assert.ok(!/INTERNAL_ROLES = \[[^\]]*KEPSEK/.test(api));
});
uji('Edge: sync-case tidak menerima Kepsek; tujuan eskalasi sah tanpa Kepsek', () => {
  const sc = sumber('supabase/functions/sync-case/index.ts');
  assert.ok(!/ALLOWED_ROLES = \[[^\]]*KEPSEK/.test(sc));
  assert.ok(!/INTERNAL_CASE_ROLES = \[[^\]]*KEPSEK/.test(sumber('supabase/functions/_shared/validate.ts')));
});
uji('teks panel pembaca tidak lagi menyebut Kepala Sekolah sebagai pengawas', () => {
  assert.ok(!js.includes('Waka Kesiswaan, dan Kepala Sekolah'));
  assert.ok(js.includes('Selain pembuat, penangan, dan Waka Kesiswaan'));
});

// ── Antrean luring ──
uji('antrean luring: pengiriman otomatis (online) menyegarkan panel antrean dan daftar kasus', () => {
  const fn = js.slice(js.indexOf('async function runFlush'), js.indexOf('async function runFlush') + 1200);
  assert.ok(fn.includes('segarkanKasusSetelahKirim()'));
  assert.ok(/async function segarkanKasusSetelahKirim\(\)[\s\S]*?loadKasusList\(false, ctx\)/.test(js));
});
uji('antrean luring: tombol "Coba kirim sekarang" membandingkan sisa antrean, bukan hanya r.synced', () => {
  assert.ok(js.includes('const terkirim = r.synced > 0 || sisa < sebelum;'));
  assert.ok(js.includes('if (terkirim) await loadKasusList(false, ctx);'));
});

console.log(`\nKASUS_KEPSEK_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
