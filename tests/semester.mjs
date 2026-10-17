// Uji LIVE pergantian Semester 1 -> 2 (migrasi 20261017110000_buka_semester_2_enrollment.sql, DG-02 diperluas):
// menutup Semester 1 lalu membuka Semester 2 harus menyalin pendaftaran kelas ke Semester 2, sehingga jalur yang memfilter semester berjalan
// (kandidat kasus: wali kelas/BK; validasi absensi di Edge) tetap menemukan siswa dan kelasnya.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/semester.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'semester.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-semester-'));
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
  const ada = jalankan("select (to_regprocedure('public.fn_open_next_semester(date,date)') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261017110000_buka_semester_2_enrollment belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261017110000_buka_semester_2_enrollment.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from class_enrollments)::int as enr, (select count(*) from academic_periods)::int as per, (select current_semester::text from school_config where school_id=(select school_id from schools where slug='smkuji1')) as sem;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const mulai = (k, awalan) => cek(k, (nilai.get(k) ?? '').startsWith(awalan), `${nilai.get(k)}  (harap diawali: ${awalan})`);

sama('kandidat_semester1', 'Guru BK,Kaprodi,Wali Kelas');
sama('semester_berjalan', '2'); sama('enrollment_semester2_setelah_tutup', '0');
mulai('buka_semester2_oleh_guru', 'GALAT:42501'); mulai('buka_semester2_rentang_tidak_valid', 'GALAT:P0001');
cek('buka_semester2_oleh_admin', /^true [1-9]\d*$/.test(nilai.get('buka_semester2_oleh_admin') ?? ''));
sama('enrollment_semester2_sama_dengan_semester1', 'true'); sama('buka_ulang_idempoten', 'false 0');
sama('kandidat_semester2', 'Guru BK,Kaprodi,Wali Kelas');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada pendaftaran, periode, atau perubahan semester tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nSEMESTER: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
