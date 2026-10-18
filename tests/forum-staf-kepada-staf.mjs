// Uji LIVE staf-kepada-staf (migrasi 20261018190000_forum_admin_keluar_lampiran_tertutup.sql; aturan produk Romo 18 Okt 2026): semua staf dapat membuat posting kepada staf mana pun yang
// dituju KECUALI dirinya sendiri (mis. wali kelas kepada wali kelas lain). Matriks 10 peran (wali kelas, guru, BK, Kaprodi, Waka Kurikulum/Kesiswaan/Humas, Kepsek, TU, admin)
// x 10 peran: 90 pasangan antarperan diterima, 10 pengiriman ke diri sendiri ditolak (22023); pengirim tidak lagi otomatis menjadi penerima postingnya sendiri (A-15) dan
// dikeluarkan bila ikut terpilih lewat kelompok; daftar kandidat tidak memuat pengirim. Transaksi SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-staf-kepada-staf.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-staf-kepada-staf.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumstaf-'));
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
  const sudah = jalankan("select (pg_get_functiondef('public.fn_forum_attachment_moderator()'::regprocedure) not like '%ADMINISTRATIVE%')::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018190000_forum_admin_keluar_lampiran_tertutup belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018190000_forum_admin_keluar_lampiran_tertutup.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima, (select count(*) from notifications)::int as notifikasi;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);

sama('persona', 'wali_kelas=true guru_biasa=true bk=true kaprodi=true waka_kurikulum=true waka_kesiswaan=true waka_humas=true kepsek=true tu=true');
cek('M1_antar_peran_diterima', /^72 ok, 0 gagal\s*$/.test(nilai.get('M1_antar_peran_diterima') ?? ''));
sama('M2_ke_diri_sendiri_ditolak_22023', '9 ditolak, 0 lainnya');
sama('M3_pengirim_tidak_ada_di_audiens_sendiri', '0');
sama('M4_posting_tercipta_hanya_antar_peran', '72');
sama('G1_kelompok_memuat_diri_diri_dikeluarkan', 'false/2');
sama('G2_penerima_lain_menerima_notifikasi', '2');
sama('G3_penerima_membaca_pengirim_membaca', 'penerima=1 pengirim=1');
sama('G4_posting_terkirim_tidak_muncul_di_masuk_pengirim', '0');
sama('C1_kandidat_tanpa_diri', 'wali_dlm_SEMUA_WALI_KELAS=0 guru_dlm_SEMUA_GURU=0 kepsek_dlm_KEPSEK=0');
sama('C2_wali_kelas_masih_melihat_wali_kelas_lain', 'true'); sama('C3_guru_masih_melihat_guru_lain', 'true');
sama('C4_fungsi_mentah_tidak_dapat_dipanggil_langsung', 'GALAT:42501'); sama('C5_siswa_tetap_ditolak', 'GALAT:42501');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, penerima, atau notifikasi uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_STAF_KEPADA_STAF: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
