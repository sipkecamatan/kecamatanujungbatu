// Uji LIVE tabel nilai rapor (migrasi 20261017140000_nilai_rapor.sql): hanya guru yang mengajar kelas+mapel yang dapat menyimpan, untuk siswa terdaftar,
// nilai 0-100; yang membaca: guru penyimpan, wali kelas, Kepala Sekolah, Waka Kurikulum (baca saja); BK, Waka Kesiswaan, admin, TU, orang tua, siswa tidak.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/nilai-rapor.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'nilai-rapor.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-rapor-'));
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
  const ada = jalankan("select (to_regclass('public.grade_final') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261017140000_nilai_rapor belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261017140000_nilai_rapor.sql'), 'utf8') + '\n' : '';
const migrasiHitungServer = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261020150000_nilai_rapor_dihitung_server.sql'), 'utf8') + '\n' : '';   // angka nilai rapor kini dihitung server; uji tetap lulus setelah migrasi itu terpasang

// Sebelum migrasi terpasang, tabel belum ada: hitungan awal dilewati.
const hitung = "select case when to_regclass('public.grade_final') is null then -1 else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.grade_final', false, true, '')))[1]::text::int end as baris;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + migrasiHitungServer + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'guru=t kelas=t mapel=t siswa=t siswa_lain=t guru_lain=t wali=t kepsek=t wakur=t wakes=t bk=t admin=t tu=t ortu=t siswa_akun=t');
sama('R1_guru_menyimpan', 'ok'); ditolak('R2_siswa_bukan_di_kelas', '42501'); ditolak('R3_nilai_lebih_dari_100', '23514'); ditolak('R4_tp_optimal_dan_perlu_tumpang_tindih', '23514');
ditolak('R5_guru_yang_tidak_mengajar', '42501'); ditolak('R6_atas_nama_guru_lain', '42501'); sama('R7_koreksi_oleh_penyimpan', 'ok');
sama('B_baca_per_peran', 'guru=1 guru_lain=0 wali=1 kepsek=1 wakur=1 wakes=0 bk=0 admin=0 tu=0 ortu=0 siswa=0');
sama('W_wali_ubah', '0'); sama('W_kepsek_ubah', '0'); sama('W_wakur_hapus', '0'); sama('W_nilai_tetap_88', '88.00'); sama('D_penyimpan_hapus', '1');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris nilai rapor uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nNILAI_RAPOR: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
