// Uji LIVE kunci asing forum saat pengguna dihapus (audit Forum A-06): forum_posts.author_user_id dan forum_post_comments.author_user_id berkunci RESTRICT, jadi
// DELETE pada users ditolak bila pengguna pernah menulis komentar/posting. Uji ini membuktikan (1) penolakan itu nyata sebelum pembersihan, (2) langkah pembersihan yang
// dipakai delete-user dan purge-user (cerminan SQL dari _shared/forum-cleanup.ts) membuat penghapusan lolos tanpa menyentuh data orang lain, (3) posting aktif tetap
// menghalangi pada mode delete-user. Pengguna uji hanya baris di dalam transaksi yang SELALU dibatalkan (tanpa akun Auth). Logika TypeScript-nya diuji terpisah:
// deno test --no-lock tests/forum-cleanup.test.ts. Tidak memerlukan migrasi.
// Pakai:  node tests/forum-hapus-pengguna.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-hapus-pengguna.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumhapus-'));
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

const hitung = 'select (select count(*) from users)::int as pengguna, (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_comments)::int as komentar, (select count(*) from forum_post_audience)::int as penerima;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const cocok = (k, re) => cek(k, re.test(nilai.get(k) ?? ''), nilai.get(k));

cocok('H1_sebelum_pembersihan_ditolak_FK_komentar_atau_posting', /^GALAT:23503 forum_post(s|_comments)_author_user_id_fkey$/);
cek('H1b_notifikasi_penerima_juga_menghalangi', /^GALAT:23503 /.test(nilai.get('H1b_notifikasi_penerima_juga_menghalangi') ?? '') && nilai.get('H1b_notifikasi_penerima_juga_menghalangi') !== '' , nilai.get('H1b_notifikasi_penerima_juga_menghalangi'));
cocok('H2_sesudah_pembersihan_penghapusan_pengguna_lolos', /^dihapus:1$/);
cek('H3_data_orang_lain_utuh', nilai.get('H3_data_orang_lain_utuh') === 'posting_Y=1 komentar_Y=1 komentar_X=0 posting_X=0', nilai.get('H3_data_orang_lain_utuh'));
cocok('H4_posting_aktif_tetap_menghalangi', /^GALAT:23503 forum_posts_author_user_id_fkey$/);
cocok('H5_mode_purge_lolos', /^dihapus:1$/);

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada pengguna, posting, komentar, atau penerima uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_HAPUS_PENGGUNA: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
