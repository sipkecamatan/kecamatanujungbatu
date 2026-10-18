// Uji statis (tanpa jaringan): admin sekolah keluar dari Forum (keputusan Romo 18 Okt 2026), jadi pemilih penerima hanya menyebut "TU", bukan "TU / Admin".
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let lulus = 0, gagal = 0;
const uji = (n, f) => { try { f(); lulus++; console.log('  LULUS  ' + n); } catch (e) { gagal++; console.log('  GAGAL  ' + n + '\n         ' + e.message); } };
const guru = src('guru/js/dashboard.js'), tu = src('tu/js/portal.js');

uji('portal guru dan portal TU tidak lagi menyebut "TU / Admin" pada pemilih penerima Forum', () => {
  for (const [nama, s] of [['guru', guru], ['tu', tu]]) assert.ok(!/TU ?\/ ?Admin/.test(s), nama + ' masih menyebut TU / Admin');
});
uji('kelompok SEMUA_TU diberi label "TU"', () => {
  assert.equal((guru.match(/label: 'TU',\s+group: 'SEMUA_TU'/g) ?? []).length, 3);
  assert.ok(/label: 'TU',\s+group: 'SEMUA_TU'/.test(tu));
  assert.ok(guru.includes("SEMUA_TU:            'Semua TU dipilih'") && tu.includes("SEMUA_TU:            'Semua TU dipilih'"));
});
uji('migrasi 190000 ada dan mencabut admin dari penulis, penerima, moderator, dan akses semua-lampiran', () => {
  const m = src('supabase/migrations/20261018190000_forum_admin_keluar_lampiran_tertutup.sql');
  for (const f of ['fn_get_forum_recipient_candidates_semua', 'fn_create_forum_post', 'fn_delete_forum_post', 'fn_forum_attachment_moderator', 'fn_get_forum_members', 'fn_get_forum_member_details']) assert.ok(m.includes("'" + f + "'"), f);
  assert.ok(/ALTER POLICY forum_attachments_download[\s\S]*?fn_forum_attachment_readable\(name\)[\s\S]*?owner_id/.test(m));
  assert.ok(!/ALTER POLICY forum_attachments_download[^;]*fn_forum_attachment_moderator\(\)/.test(m), 'kebijakan baca masih memakai moderator');
});
console.log(`\nFORUM_ADMIN_UI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
