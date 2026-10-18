// Uji LIVE "tarik posting = hapus posting" (migrasi 20261018100000_forum_tarik_sama_dengan_hapus.sql; keputusan Romo 18 Okt 2026): tidak ada lagi tarik/pulihkan sementara;
// menarik posting adalah menghapusnya (fn_delete_forum_post): hanya penulis, atau moderator yang menjadi penerima, yang dapat menghapus; posting, daftar penerima, komentar, dan
// notifikasinya ikut hilang; penerima biasa, orang tua, orang lain, dan moderator non-penerima ditolak (42501). Baris peninggalan berstatus is_withdrawn hanya terlihat penulis.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-tarik-sama-hapus.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-tarik-sama-hapus.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumhapus2-'));
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
  const sudah = jalankan("select (to_regprocedure('public.fn_toggle_forum_post_withdrawn(uuid,boolean)') is null)::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018100000_forum_tarik_sama_dengan_hapus belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018100000_forum_tarik_sama_dengan_hapus.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima, (select count(*) from forum_post_comments)::int as komentar, (select count(*) from notifications where forum_post_id is not null)::int as notifikasi;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:42501';

sama('persona', 'penulis=t penerima=t lain=t kepsek=t waka_kes=t ortu=t');
sama('F0_fungsi_tarik_sudah_dicabut', 'tidak_ada');
sama('H0_sebelum_hapus', 'penulis=1 penerima=1 kepsek=1 ortu=1');
for (const k of ['H1_penerima_biasa_tidak_dapat_menghapus', 'H2_ortu_penerima_tidak_dapat_menghapus', 'H3_orang_lain_tidak_dapat_menghapus', 'H4_moderator_bukan_penerima_tidak_dapat_menghapus']) sama(k, DITOLAK);
sama('H5_penulis_menghapus', '1');
sama('H6_setelah_dihapus_tak_seorang_pun_membaca', 'penulis=0 penerima=0 kepsek=0 ortu=0');
sama('H7_komentar_penerima_notifikasi_ikut_hilang', 'posting=0 penerima=0 komentar=0 notifikasi=0');
sama('H8_hapus_dua_kali', 'GALAT:P0002');
sama('M1_moderator_penerima_dapat_menghapus', '1');
sama('L1_peninggalan_ditarik_hanya_penulis_membaca', 'penulis=1 penerima=0 kepsek=0');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, penerima, komentar, atau notifikasi uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_TARIK_SAMA_HAPUS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
