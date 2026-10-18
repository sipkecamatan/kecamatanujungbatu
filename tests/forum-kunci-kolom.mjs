// Uji LIVE kunci kolom forum_posts (migrasi 20261018010000_forum_posts_kunci_kolom.sql; audit Forum A-01 dan A-03): penulis tidak lagi dapat mengisi attachment_url,
// menunjuk lampiran milik orang lain/sekolah lain, atau mengubah is_pinned/is_withdrawn/deleted_at/category_id/author/school langsung; edit judul-isi dan jalur
// fungsi server (tarik/pulihkan/hapus) tetap berfungsi. Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-kunci-kolom.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-kunci-kolom.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumkunci-'));
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
  const ada = jalankan("select exists (select 1 from pg_trigger where tgname = 'trg_forum_posts_guard_update' and not tgisinternal)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261018010000_forum_posts_kunci_kolom belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018010000_forum_posts_kunci_kolom.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from forum_posts)::int as posting, (select count(*) from storage.objects where bucket_id = 'forum-attachments')::int as berkas;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:42501';

sama('persona', 'guru=t guru2=t kepsek=t sekolah_lain=t');
sama('K1_url_javascript_ditolak', DITOLAK); sama('K2_url_https_pun_ditolak', DITOLAK);
sama('K3_path_milik_sendiri_diterima', '1'); sama('K4_path_milik_orang_lain_ditolak', DITOLAK); sama('K5_path_tidak_ada_ditolak', DITOLAK);
sama('K6_path_sekolah_lain_ditolak', DITOLAK); sama('K7_path_titik_titik_ditolak', DITOLAK); sama('K8_lampiran_dikosongkan_boleh', '1');
sama('K9_is_pinned_ditolak', DITOLAK); sama('K10_is_withdrawn_ditolak', DITOLAK); sama('K11_deleted_at_ditolak', DITOLAK); sama('K12_category_id_ditolak', DITOLAK);
sama('K13_author_dan_sekolah_ditolak', `author=${DITOLAK} sekolah=${DITOLAK}`);
sama('K14_edit_judul_isi_boleh', '1'); sama('K15_bukan_penulis_tetap_0_baris', '0'); sama('K16_nama_lampiran_terlalu_panjang', 'GALAT:22001');
sama('K19_penulis_hapus_via_rpc', '1'); sama('K20_baris_terhapus', '0');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting atau berkas uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_KUNCI_KOLOM: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
