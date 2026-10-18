// Uji LIVE kunci periode nilai (migrasi 20261018120000_kunci_periode_nilai.sql, B-07): setelah semester ditutup guru tidak dapat mengubah asesmen, hasil,
// nilai rapor; Kepala Sekolah / Waka Kurikulum membuka kunci per kelas dengan alasan tertulis (tercatat) dan dapat menguncinya kembali.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/kunci-periode.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRASI = '20261018120000_kunci_periode_nilai.sql';
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'kunci-periode.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-kunci-'));
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
if (!terapkan && process.env.KONTROL_NEGATIF !== '1') {
  const ada = jalankan("select (to_regclass('public.grade_period_unlocks') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log(`SKIP: migrasi ${MIGRASI} belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).`); process.exit(0); }
}
const negatif = process.env.KONTROL_NEGATIF === '1';   // kontrol negatif: migrasi diterapkan TANPA trigger penjaga
let migrasi = (terapkan || negatif) ? readFileSync(join(ROOT, 'supabase', 'migrations', MIGRASI), 'utf8') + '\n' : '';
if (negatif) migrasi = migrasi.replace(/CREATE TRIGGER trg_guard_period_[^;]*;/g, '');

const hitung = "select (select count(*) from public.academic_periods)::text as p, (select count(*) from public.assessments)::text as a, (select count(*) from public.grade_final)::text as g, case when to_regclass('public.grade_period_unlocks') is null then '-1' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.grade_period_unlocks', false, true, '')))[1]::text end as u;";
if (negatif) {
  const b = new Map(jalankan('begin;' + String.fromCharCode(10) + migrasi + badan + String.fromCharCode(10) + 'rollback;' + String.fromCharCode(10)).map((r) => [r.k, String(r.v)]));
  const bocor = ['B1_tutup_ubah_nilai_rapor', 'B2_tutup_hapus_nilai_rapor', 'B3_tutup_ubah_hasil_asesmen', 'B4_tutup_asesmen_baru', 'B5_tutup_hapus_asesmen'].filter((k) => b.get(k) === 'ok');
  console.log(`KONTROL NEGATIF (tanpa trigger penjaga): ${bocor.length} dari 5 penulisan pada periode CLOSED lolos -> ${bocor.length === 5 ? 'celah terbukti, penjaga memang diperlukan' : 'TIDAK terbukti'}`);
  process.exit(bocor.length === 5 ? 0 : 1);
}
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'guru=t kelas=t kelas2=t mapel=t siswa=t guru_lain=t kepsek=t wakur=t wakes=t');
sama('A1_aktif_simpan_nilai_rapor', 'ok'); sama('A2_aktif_hasil_asesmen', 'ok');
ditolak('B1_tutup_ubah_nilai_rapor', 'P0001'); ditolak('B2_tutup_hapus_nilai_rapor', 'P0001'); ditolak('B3_tutup_ubah_hasil_asesmen', 'P0001');
ditolak('B4_tutup_asesmen_baru', 'P0001'); ditolak('B5_tutup_hapus_asesmen', 'P0001'); ditolak('B6_tutup_tak_dapat_memindah_semester', 'P0001');
sama('B7_nilai_tetap_85', '85.00'); sama('B8_baca_tetap_boleh', '1');
ditolak('C1_guru_tak_dapat_membuka', '42501'); ditolak('C2_wakes_tak_dapat_membuka', '42501'); ditolak('C3_alasan_terlalu_pendek', 'P0001'); ditolak('C4_kelas_tidak_dikenal', 'P0001');
sama('C5_kepsek_membuka', 'ok'); ditolak('C6_buka_dua_kali', 'P0001'); sama('C7_kelas_lain_tetap_terkunci', 'kelas=f kelas2=t'); sama('C8_guru_menulis_saat_dibuka', 'ok');
sama('C9_catatan_pembukaan', 'baris=1 alasan_ok=t oleh_ok=t'); sama('C10_baca_catatan', 'guru=0 kepsek=1');
ditolak('D1_guru_tak_dapat_mengunci', '42501'); sama('D2_wakur_mengunci_kembali', '1'); ditolak('D3_terkunci_lagi', 'P0001'); sama('D4_riwayat_tetap_ada', 'baris=1 terkunci_ulang=1');
sama('F1_status_terkunci', 'closed=true unlocked=false'); ditolak('F2_guru_tak_dapat_melihat_status', '42501');
sama('F3_status_dibuka', 'closed=true unlocked=true alasan=koreksi kedua salah input nilai');
ditolak('E1_buka_saat_aktif', 'P0001'); sama('E2_sql_langsung_tidak_terhalang', '1');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nKUNCI_PERIODE: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
