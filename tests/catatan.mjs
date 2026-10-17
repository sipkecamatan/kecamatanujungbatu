// Uji LIVE aturan Catatan Siswa (migrasi 20261017060000, 070000, 080000, 090000): hubungan guru-siswa ditegakkan server, tidak menimpa catatan penulis lain,
// akun dihapus lunak dan periode ditutup ditolak, notifikasi per visibilitas, hanya penulis/siswa/orang tua yang membaca (admin, Kepsek, BK, Waka, TU: 0),
// pembatalan hanya oleh penulis, admin hanya menghitung.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/catatan.mjs
//   UJI_TERAPKAN_MIGRASI=1 node tests/catatan.mjs  -> menerapkan keempat berkas migrasi DI DALAM transaksi uji (dibatalkan juga).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'catatan.sql'), 'utf8');
const BERKAS = ['20261017060000_fn_sync_observation_hubungan_guru', '20261017070000_notif_catatan_visibilitas_baru', '20261017080000_catatan_kunci_periode_dan_batal', '20261017090000_catatan_siswa_tertutup_bagi_admin'];

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-catatan-'));
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
  const ada = jalankan("select (to_regprocedure('public.fn_admin_observation_count(uuid,uuid,date,date,boolean)') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi Catatan Siswa (…060000 sampai …090000) belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? BERKAS.map((b) => readFileSync(join(ROOT, 'supabase', 'migrations', b + '.sql'), 'utf8')).join('\n') + '\n' : '';

const hitung = "select (select count(*) from observations)::int as obs, (select count(*) from notifications where type = 'OBSERVATION_NEW')::int as notif, (select count(*) from academic_periods)::int as periode;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'autor=t stu=t stu_lain=t ortu=t siswa=t adm=t kep=t bk=t waka=t wakur=t tu=t guru_lain=t');
sama('A1_siswa_yang_diajar', 'ok'); ditolak('A2_siswa_yang_tidak_diajar', '42501');
sama('A3_tidak_menimpa_catatan_penulis_lain', 'isi asli catatan uji');
ditolak('A4_akun_dihapus_lunak', 'P0004'); ditolak('A5_periode_ditutup', 'P0001');
sama('B_notifikasi_PRIVATE', '0'); sama('B_notifikasi_SISWA_SAJA', '1'); sama('B_notifikasi_ORTU_SAJA', '1'); sama('B_notifikasi_SISWA_DAN_ORTU', '2');
sama('C_baca_per_peran', 'penulis=4 siswa=2 ortu=2 admin=0 kepsek=0 bk=0 waka_kesiswaan=0 waka_kurikulum=0 tu=0 guru_lain=0');
ditolak('D1_batal_oleh_guru_lain', '42501'); ditolak('D2_alasan_pendek', 'P0001'); sama('D3_batal_oleh_penulis', '{"ok": true}');
ditolak('D4_batal_dua_kali', '42501'); ditolak('D5_batal_oleh_admin', '42501'); sama('D6_tersembunyi_dari_siswa_dan_ortu_setelah_batal', 'siswa=0 ortu=0');
sama('E1_admin_hitungan', 'true'); sama('E2_admin_ubah_baris', '0'); ditolak('E3_guru_memanggil_fungsi_admin', '42501'); sama('E4_kebijakan_void_admin_tidak_ada', '0');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada catatan, notifikasi, atau periode uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nCATATAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
