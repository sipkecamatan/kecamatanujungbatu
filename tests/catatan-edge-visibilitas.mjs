// Uji statis (tanpa jaringan): skema validasi Edge sync-observation hanya menerima visibilitas yang sama dengan formulir guru dan kebijakan tulis (L1, 18 Okt 2026).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'validate.ts'), 'utf8');
const html = readFileSync(join(ROOT, 'guru', 'dashboard.html'), 'utf8');
let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + e.message); } };

const daftar = (v.match(/export const OBSERVATION_VISIBILITY = \[([^\]]*)\]/) || [])[1] || '';
const nilai = [...daftar.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();

uji('daftar visibilitas catatan guru: PRIVATE, SISWA_SAJA, ORTU_SAJA, SISWA_DAN_ORTU (tanpa RESTRICTED/PUBLIC/INTERNAL_SCHOOL/STUDENT_VISIBLE)', () => {
  assert.deepEqual(nilai, ['ORTU_SAJA', 'PRIVATE', 'SISWA_DAN_ORTU', 'SISWA_SAJA']);
});
uji('OBSERVATION_SCHEMA memakai daftar itu (bukan VISIBILITY_LEVEL penuh)', () => {
  const baris = (v.match(/\['visibility',[^\n]*\]/) || [''])[0];
  assert.ok(baris.includes('OBSERVATION_VISIBILITY'), baris);
  assert.ok(!baris.includes('VISIBILITY_LEVEL'), baris);
});
uji('formulir guru menawarkan hanya nilai yang ada di daftar (siswa saja, orang tua saja, keduanya, pribadi)', () => {
  const blok = (html.match(/<select id="obs-visibility"[\s\S]*?<\/select>/) || [''])[0];
  const opsi = [...blok.matchAll(/<option value="([A-Z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(opsi, ['ORTU_SAJA', 'PRIVATE', 'SISWA_DAN_ORTU', 'SISWA_SAJA']);
});

console.log(`\nCATATAN_EDGE_VISIBILITAS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
