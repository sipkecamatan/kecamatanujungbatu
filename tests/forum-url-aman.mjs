// Uji tautan lampiran forum (audit Forum A-01, sisi tampilan): fungsi urlAman di portal guru, orang tua, dan siswa hanya meloloskan http/https.
// Fungsinya diambil langsung dari berkas sumber, jadi yang diuji adalah kode sebenarnya. Pakai: node tests/forum-url-aman.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS ', nama); } catch (e) { gagal++; console.log('  GAGAL ', nama, '\n        ', e.message); } };

for (const f of ['guru/js/dashboard.js', 'parent/js/portal.js', 'student/js/dashboard.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r/g, '');
  const m = src.match(/function urlAman\(u\) \{[^\n]*\}/);
  uji(`${f}: urlAman ada`, () => assert.ok(m, 'fungsi tidak ditemukan'));
  if (!m) continue;
  const urlAman = new Function(`${m[0]}; return urlAman;`)();
  uji(`${f}: lolos hanya http/https; menolak javascript:, data:, vbscript:, kosong, null, tanpa skema, dan variasi huruf/spasi`, () => {
    assert.equal(urlAman('https://contoh.id/a.pdf'), 'https://contoh.id/a.pdf');
    assert.equal(urlAman('  HTTP://contoh.id/a  '), 'HTTP://contoh.id/a');
    for (const x of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '//contoh.id/a', 'contoh.id/a', '', null, undefined, '\tjavascript:alert(1)']) {
      assert.equal(urlAman(x), null, `lolos: ${JSON.stringify(x)}`);
    }
  });
}
console.log(`\nFORUM_URL_AMAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
