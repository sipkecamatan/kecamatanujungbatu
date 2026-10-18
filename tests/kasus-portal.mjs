// Uji LIVE migrasi 20261018160000 (siswa/orang tua tidak membaca judul dan deskripsi kasus; fn_portal_cases) dan 20261018170000 (label hubungan pembaca dari server).
// Keputusan Romo 18 Okt 2026 (opsi a): siswa dan orang tua yang ditandai/dibagikan hanya melihat status, tanggal, penangan, dan komentar yang ditandai terlihat.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/kasus-portal.mjs     (UJI_TERAPKAN_MIGRASI=1 menerapkan kedua migrasi di dalam transaksi uji; KONTROL_NEGATIF=1 tanpa pencabutan kebijakan baca siswa/ortu)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const M1 = '20261018160000_kasus_portal_tanpa_judul_dan_deskripsi.sql';
const M2 = '20261018170000_kasus_pembaca_label_hubungan.sql';
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'kasus-portal.sql'), 'utf8');
const NL = String.fromCharCode(10);

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-kportal-'));
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
const negatif = process.env.KONTROL_NEGATIF === '1';
if (!terapkan && !negatif) {
  const ada = jalankan("select (to_regprocedure('public.fn_portal_cases(uuid)') is not null and exists (select 1 from pg_proc where proname = 'fn_case_list_viewers' and pg_get_function_result(oid) like '%relation_label%'))::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log(`SKIP: migrasi ${M1} dan ${M2} belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).`); process.exit(0); }
}
let migrasi = '';
if (terapkan || negatif) {
  migrasi = readFileSync(join(ROOT, 'supabase', 'migrations', M1), 'utf8') + NL + readFileSync(join(ROOT, 'supabase', 'migrations', M2), 'utf8') + NL;
  // Kontrol negatif: kebijakan baca siswa/ortu pada tabel kasus TIDAK dicabut (keadaan sebelum perbaikan)
  if (negatif) migrasi = migrasi.replace(/DROP POLICY IF EXISTS rls_cc_read_[a-z_]+\s+ON public\.coaching_cases;/g, '');
}

const hitung = "select (select count(*) from public.coaching_cases)::text as k, (select count(*) from public.coaching_case_events)::text as e, (select count(*) from public.notifications)::text as n;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;' + NL + migrasi + badan + NL + 'rollback;' + NL);
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));

if (negatif) {
  const bocor = nilai.get('P2b_judul_lewat_kueri_langsung') === 'ortu=1 siswa=1' && nilai.get('P2_tabel_kasus_langsung') === 'ortu=1 siswa=1';
  console.log(`KONTROL NEGATIF (kebijakan baca siswa/ortu tidak dicabut): tabel kasus langsung = ${nilai.get('P2_tabel_kasus_langsung')}; kueri judul = ${nilai.get('P2b_judul_lewat_kueri_langsung')} -> ${bocor ? 'celah terbukti (siswa dan orang tua dapat membaca judul kasus)' : 'TIDAK terbukti'}`);
  process.exit(bocor ? 0 : 1);
}

let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}${NL}         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'creator=true wali=true guruwali=true ortu=true siswa=true ortu_lain=true siswa_lain=true');
sama('P1_belum_ditandai', 'ortu=0 siswa=0');
sama('P2_tabel_kasus_langsung', 'ortu=0 siswa=0'); sama('P2b_judul_lewat_kueri_langsung', 'ortu=0 siswa=0');
const isi = 'kasus=1 status=OPEN ada_judul=f ada_deskripsi=f komentar=1 bocor_judul=f bocor_deskripsi=f bocor_internal=f';
sama('P3_isi_untuk_ortu', isi); sama('P3b_isi_untuk_siswa', isi);
ditolak('P4_ortu_siswa_lain', '42501'); ditolak('P4b_siswa_minta_siswa_lain', '42501'); ditolak('P4c_staf_tak_boleh_memakai', '42501'); ditolak('P4d_ortu_tanpa_siswa', '42501');
sama('P5_dicabut', 'ortu=0 siswa=0'); sama('P5b_dibagikan_ke_ortu', 'ortu=1 siswa=0 ortu_ada_judul=f');
sama('L1_label_pembaca', 'Guru Wali,Orang tua,Siswa,Wali Kelas'); sama('L2_label_wali_kelas_peran_guru', 'Wali Kelas/GURU'); ditolak('L3_bukan_pembuat_tak_boleh_melihat_daftar', '42501');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`${NL}KASUS_PORTAL: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
