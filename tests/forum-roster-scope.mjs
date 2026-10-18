// Uji LIVE pembatasan roster dan scope forum (migrasi 20261018020000_forum_roster_scope_dibatasi.sql; audit Forum A-05 dan A-14): siswa, orang tua, dan guru tidak lagi
// dapat memanggil fn_get_forum_member_details / fn_get_forum_members langsung, dan fn_get_user_forum_scope hanya menjawab untuk diri sendiri; membuat posting kelas
// (yang memakai fn_get_forum_members secara internal) tetap berfungsi. Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-roster-scope.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-roster-scope.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumroster-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, sql);
  try {
    const r = spawnSync(`supabase db query --linked -o json -f "${f}"`, { shell: true, encoding: 'utf8', maxBuffer: 64e6, cwd: ROOT });
    if (r.status !== 0) throw new Error(`CLI ${r.status}: ${String(r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|unexpected|Failed/.test(l)).join(' ').slice(0, 400)}`);
    const out = String(r.stdout || '');
    const awal = out.search(/[\[{]/);
    if (awal < 0) return [];
    const j = JSON.parse(out.slice(awal));
    return Array.isArray(j) ? j : (j.rows ?? []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const terapkan = process.env.UJI_TERAPKAN_MIGRASI === '1';
if (!terapkan) {
  const sudah = jalankan("select (not has_function_privilege('authenticated', 'public.fn_get_forum_members(uuid,text,text)', 'execute'))::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018020000_forum_roster_scope_dibatasi belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018020000_forum_roster_scope_dibatasi.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:42501';

sama('persona', 'siswa=t ortu=t guru=t guru2=t kelas_lain=t');
for (const p of ['siswa', 'ortu', 'guru']) sama('R_' + p, `detail=${DITOLAK} members=${DITOLAK}`);
sama('S1_siswa_tanya_scope_guru', '0'); sama('S2_guru_tanya_scope_guru_lain', '0'); sama('S3_guru_tanya_scope_sendiri', 'GURU');
sama('P1_buat_posting_kelas_staf', '1');
cek('P2_penerima_tercatat (posting kelas punya penerima)', Number(nilai.get('P2_penerima_tercatat')) > 0, nilai.get('P2_penerima_tercatat'));

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting atau penerima uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_ROSTER_SCOPE: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
