// Uji LIVE keterlihatan nilai (migrasi 20261017150000_nilai_keterlihatan_dan_pimpinan.sql): (1) pengajar berperan ganda (mis. BK) dapat membuat TP dan membaca
// penilaiannya sendiri; (2) Waka Kurikulum dan Kepala Sekolah otomatis melihat nilai setiap TP (peran ATAU tanda), peran lain ditolak; (3) nilai rapor terlihat siswa
// dan orang tua hanya atas izin guru (siswa saja, orang tua saja, keduanya) baik di tabel maupun di portal (fn_get_all_grades_summary).
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/nilai-keterlihatan.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'nilai-keterlihatan.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-nilaikt-'));
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
  const ada = jalankan("select (to_regprocedure('public.fn_nilai_per_tp(character varying,integer)') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261017150000_nilai_keterlihatan_dan_pimpinan belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261017150000_nilai_keterlihatan_dan_pimpinan.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from learning_objectives)::int as tp, (select count(*) from assessments)::int as asesmen, (select count(*) from grade_final)::int as rapor, (select count(*) from users where is_waka_kurikulum)::int as waka, (select count(*) from users where role_type = 'WAKA_KURIKULUM')::int as role_waka;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);

sama('persona', 'guru=t kelas=t siswa=t siswa2=t ortu=t siswa_akun=t kepsek=t wakur=t wakes=t bk_mengajar=t admin=t guru_lain=t');
sama('M1_pengajar_non_guru_membuat_tp', 'ok'); sama('M2_pengajar_non_guru_membaca_penilaian_sendiri', '1'); sama('M3_guru_lain_tidak_membaca_milik_bk', '0');
sama('P1_kepsek', '70.0/1/1/2/true'); sama('P2_waka_kurikulum', '70.0/1/1/2/true');
sama('P3_peran_lain_ditolak', 'wakes=GALAT:42501 bk=GALAT:42501 guru=GALAT:42501 guru_penyimpan=GALAT:42501 admin=GALAT:42501 ortu=GALAT:42501 siswa=GALAT:42501');
sama('P4_rincian_per_siswa', '60.0:false,80.0:true'); sama('P5_rincian_ditolak_bagi_guru', 'GALAT:42501'); sama('P6_tp_tidak_ada', '0');
sama('P7_guru_dengan_tanda_waka_kurikulum', '70.0/1/1/2/true');
sama('V1_bawaan_tidak_terlihat', 'tabel: siswa=0 ortu=0 | portal: siswa=0 ortu=0');
sama('V2_izin_siswa_saja', 'tabel: siswa=1 ortu=0 | portal: siswa=1 ortu=0');
sama('V3_izin_ortu_saja', 'tabel: siswa=0 ortu=1 | portal: siswa=0 ortu=1');
sama('V4_izin_keduanya', 'tabel: siswa=1 ortu=1 | portal: siswa=1 ortu=1');
sama('V5_siswa_tak_dapat_mengubah_izin', '0'); sama('V6_nilai_tetap', '88.00');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada TP, penilaian, nilai rapor, atau perubahan peran uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nNILAI_KETERLIHATAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
