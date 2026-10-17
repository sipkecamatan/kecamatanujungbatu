// Uji LIVE validasi server jurnal dan nilai (migrasi 20261017120000_jurnal_nilai_validasi_server.sql): hasil asesmen hanya untuk siswa yang terdaftar di
// kelas asesmen pada periodenya (A-02), dan tanggal jurnal tidak di masa depan serta tidak lebih dari setahun ke belakang (A-06).
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1 dengan asesmen buatan sendiri.
// Pakai:  node tests/jurnal-nilai.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'jurnal-nilai.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-jurnal-'));
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
  const ada = jalankan("select exists(select 1 from pg_trigger where tgname = 'trg_assessment_result_validate')::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261017120000_jurnal_nilai_validasi_server belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261017120000_jurnal_nilai_validasi_server.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from assessments)::int as asesmen, (select count(*) from assessment_results)::int as hasil, (select count(*) from teacher_journals)::int as jurnal;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'guru=t kelas=t siswa=t siswa_lain_kelas=t siswa_sekolah_lain=t mapel=t asesmen=t');
sama('N1_siswa_di_kelas', 'ok'); ditolak('N2_siswa_bukan_di_kelas', '42501'); ditolak('N3_kelas_hasil_tidak_sama_dengan_asesmen', '42501'); ditolak('N4_siswa_sekolah_lain', '42501');
sama('N5_koreksi_nilai_baris_yang_ada', 'ok'); sama('N6_koreksi_setelah_siswa_pindah', 'ok'); sama('N7_hasil_tersimpan', '1');
sama('J1_hari_ini', 'ok'); ditolak('J2_besok', 'P0001'); ditolak('J3_dua_tahun_lalu', 'P0001'); sama('J4_sebelas_bulan_lalu', 'ok');
sama('J5_ubah_isi_tanpa_ubah_tanggal', 'ok'); ditolak('J6_ubah_tanggal_ke_masa_depan', 'P0001');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada asesmen, hasil, atau jurnal uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nJURNAL_NILAI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
