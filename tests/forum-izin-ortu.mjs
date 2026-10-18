// Uji LIVE izin ketidakhadiran dari orang tua (migrasi 20261018060000_forum_izin_ortu.sql; aturan produk Romo 18 Okt 2026): orang tua hanya dapat menulis izin ketidakhadiran
// anaknya; penerima OTOMATIS = wali kelas anak, guru wali anak, guru piket yang bertugas hari itu, guru yang mengajar anak hari itu (Guru BK tidak termasuk); judul dan isi
// disusun server; orang tua tidak dapat membuat posting dengan cara lain dan hanya dapat berkomentar pada izin miliknya sendiri.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-izin-ortu.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-izin-ortu.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumizin-'));
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
  const sudah = jalankan("select (to_regprocedure('public.fn_create_izin_ortu(uuid,text,text,uuid)') is not null)::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018060000_forum_izin_ortu belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018060000_forum_izin_ortu.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima, (select count(*) from forum_post_comments)::int as komentar, (select count(*) from guru_wali_assignments)::int as guru_wali, (select count(*) from users where wali_kelas_class_id is not null)::int as wali, (select count(*) from users where is_active)::int as aktif;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:42501';

sama('persona', 'anak=t ortu=t wali=t guru=t ortu2=t bk=t');
for (const k of ['P1_wali_termasuk', 'P2_guru_pengajar_hari_itu_semua_termasuk', 'P3_guru_piket_hari_itu_semua_termasuk', 'P7_pengguna_nonaktif_dikeluarkan']) sama(k, 'true');
cek('P4_guru_kelas_lain_tidak_termasuk', ['true', 'tanpa_contoh'].includes(nilai.get('P4_guru_kelas_lain_tidak_termasuk')));
cek('P5_bk_tidak_termasuk', ['true', 'tanpa_contoh'].includes(nilai.get('P5_bk_tidak_termasuk')));
sama('P6_hari_minggu_tanpa_piket_dan_jadwal_hanya_wali_dan_guru_wali', 'true');
sama('I1_ortu_kirim_izin', 'ok'); sama('I2_judul_dan_isi_disusun_server', 'true'); sama('I3_penerima_otomatis_sesuai_aturan', 'true'); sama('I4_anak_tercatat_sebagai_subjek', '1');
sama('I5_wali_menerima_dan_mendapat_notifikasi', 'true'); sama('I6_kirim_ulang_kunci_sama_tidak_ganda', 'true');
sama('I7_alasan_tidak_valid', 'GALAT:22023'); cek('I8_anak_orang_lain_ditolak', ['GALAT:42501', 'tanpa_contoh'].includes(nilai.get('I8_anak_orang_lain_ditolak')));
sama('I9_guru_tidak_dapat_memakai', DITOLAK); sama('I10_siswa_tidak_dapat_memakai', DITOLAK); sama('I11_keterangan_1001_karakter_ditolak', 'GALAT:22001');
sama('J1_rpc_fn_create_forum_post_langsung_ditolak', DITOLAK); sama('J2_insert_langsung_ditolak', DITOLAK); sama('J3_guru_tetap_dapat_membuat_posting_biasa', 'true');
sama('K1_ortu_komentar_pada_izin_sendiri', '1'); sama('K2_wali_membalas_izin', '1'); sama('K3_ortu_tidak_dapat_komentar_di_pesan_guru', DITOLAK); sama('K4_ortu_masih_membaca_pesan_guru_untuknya', '1');
sama('Z1_tanpa_penerima_ditolak_dengan_pesan', 'GALAT:P0002');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, penerima, komentar, atau perubahan wali/guru wali/pengguna tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_IZIN_ORTU: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
