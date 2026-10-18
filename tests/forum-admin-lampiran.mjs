// Uji LIVE (migrasi 20261018190000_forum_admin_keluar_lampiran_tertutup.sql): (1) lampiran Forum hanya dibaca penulis dan penerima posting, tidak lagi oleh
// Kepsek/Waka Kesiswaan/admin yang bukan penerima; moderator hanya menghapus lampiran yang dapat ia baca (dan berkasnya ikut terhapus saat ia menghapus posting); (2) admin sekolah keluar dari Forum
// (tidak dapat menulis, menjadi penerima, atau memoderasi); peran TU tetap penuh. Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (sekolah uji smkuji1).
// Pakai:  node tests/forum-admin-lampiran.mjs
//   UJI_TERAPKAN_MIGRASI=1 node tests/forum-admin-lampiran.mjs  -> menerapkan berkas migrasi DI DALAM transaksi uji (dibatalkan juga).
//   KONTROL_NEGATIF=1 node tests/forum-admin-lampiran.mjs        -> menjalankan tanpa migrasi untuk membuktikan celahnya ada (harap ada yang GAGAL).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-admin-lampiran.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumadm-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, sql);
  try {
    const r = spawnSync(`supabase db query --linked -o json -f "${f}"`, { shell: true, encoding: 'utf8', maxBuffer: 64e6, cwd: ROOT });
    if (r.status !== 0) throw new Error(`CLI ${r.status}: ${String(r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|unexpected|Failed/.test(l)).join(' ').slice(0, 500)}`);
    const out = String(r.stdout || '');
    const awal = out.search(/[\[{]/);
    if (awal < 0) return [];
    const j = JSON.parse(out.slice(awal));
    return Array.isArray(j) ? j : (j.rows ?? []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const terapkan = process.env.UJI_TERAPKAN_MIGRASI === '1';
const negatif = process.env.KONTROL_NEGATIF === '1';
if (!terapkan && !negatif) {
  const sudah = jalankan("select (pg_get_functiondef('public.fn_forum_attachment_moderator()'::regprocedure) not like '%ADMINISTRATIVE%')::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018190000_forum_admin_keluar_lampiran_tertutup belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018190000_forum_admin_keluar_lampiran_tertutup.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from forum_posts)::int as posting, (select count(*) from storage.objects where bucket_id = 'forum-attachments')::int as berkas, (select count(*) from forum_post_audience)::int as audiens;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);

sama('persona', 'penulis=t guru2=t waka=t kepsek=t bk=t admin=t tu=t');
sama('B1_penulis_baca_lampiran_sendiri', '1'); sama('B2_penerima_Waka_baca', '1');
sama('B3_Kepsek_bukan_penerima_tidak_baca', '0'); sama('B4_admin_bukan_penerima_tidak_baca', '0');
sama('B5_BK_tidak_baca', '0'); sama('B6_TU_tidak_baca', '0');
sama('B7_Kepsek_penerima_posting2_baca', '1'); sama('B8_Waka_bukan_penerima_posting2_tidak_baca', '0');
sama('B9_Kepsek_tidak_lihat_berkas_yatim_orang_lain', '0');
sama('H1_Kepsek_tak_dapat_hapus_lampiran_yang_bukan_ditujukan_kepadanya', '0'); sama('H2_admin_tak_dapat_hapus', '0'); sama('H3_guru_lain_tak_dapat_hapus', '0');
sama('H4_Waka_penerima_dapat_hapus', '1');
sama('H5_Kepsek_bukan_penerima_tak_dapat_hapus_posting', 'ditolak'); sama('H5b_pemilik_berkas_tidak_berubah_setelah_penolakan', '1/1');
sama('H6_Kepsek_penerima_hapus_posting_lalu_berkasnya', '1/1'); sama('H7_guru_lain_tak_dapat_hapus_berkas_yatim', '0'); sama('H8_pemilik_dapat_hapus_berkas_sendiri', '1');
sama('A1_menulis_ke_admin_ditolak', 'ditolak'); sama('A2_admin_menulis_ditolak', 'ditolak');
sama('A3_kandidat_kelompok_TU_tanpa_admin', '0/true');
sama('A4_admin_bukan_moderator_lampiran', 'false'); sama('A5_Kepsek_tetap_moderator_lampiran', 'true');
sama('A6_admin_tak_ada_di_audiens_manapun', '0'); sama('A7_TU_tetap_bisa_menerima', 'ok');
const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, berkas, atau audiens uji tertinggal (transaksi dibatalkan)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_ADMIN_LAMPIRAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
