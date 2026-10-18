// Uji asap tanpa peramban (temuan uji nyata 18 Okt 2026): (1) label sentimen sama di tiga portal; (2) pembatalan catatan memakai isian alasan di halaman, bukan window.prompt,
// dengan batas waktu agar tombol tidak terkunci selamanya.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sumber = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + e.message); } };

uji('portal siswa: NEGATIF tampil "Perlu Perhatian" (bukan "Negatif")', () => {
  const s = sumber('student/js/dashboard.js');
  assert.ok(/NEGATIF:\s*'Perlu Perhatian'/.test(s));
  assert.ok(!/NEGATIF:\s*'Negatif'/.test(s));
});
uji('portal orang tua: label sentimen ada dan sama ("Perlu Perhatian"), tampil pada kartu catatan', () => {
  const s = sumber('parent/js/portal.js');
  assert.ok(/SENTIMENT_LABELS\s*=\s*\{[^}]*NEGATIF:\s*'Perlu Perhatian'/.test(s));
  assert.ok(/SENTIMENT_LABELS\[r\.sentiment\]/.test(s));
});
uji('portal guru: label yang sama dengan pilihan pada formulir', () => {
  const d = sumber('guru/js/dashboard.js'); const h = sumber('guru/dashboard.html');
  assert.ok(/NEGATIF:'Perlu Perhatian'/.test(d));
  assert.ok(/<option value="NEGATIF">Perlu Perhatian<\/option>/.test(h));
});
uji('pembatalan catatan: tanpa window.prompt (hanya disebut di komentar)', () => {
  const d = sumber('guru/js/dashboard.js');
  assert.equal((d.match(/window\.prompt\(/g) || []).length, 0);
});
uji('pembatalan catatan: isian alasan di halaman, alasan minimal 5 karakter diperiksa sebelum dikirim', () => {
  const d = sumber('guru/js/dashboard.js');
  assert.ok(d.includes('obs-void-form') && d.includes('data-void-confirm') && d.includes('data-void-close'));
  assert.ok(/alasan\.length < 5/.test(d));
});
uji('pembatalan catatan: batas waktu 20 detik dan tombol aktif kembali setelah galat', () => {
  const d = sumber('guru/js/dashboard.js');
  assert.ok(/Promise\.race\(\[\s*voidObservation\(/.test(d));
  assert.ok(/20000/.test(d));
  assert.ok(/ok\.disabled = false;/.test(d));
});

console.log(`\nCATATAN_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
