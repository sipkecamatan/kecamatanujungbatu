// Uji LIVE migrasi 20261018140000_catatan_tutup_kebocoran_visibilitas_dan_siswa.sql (pemeriksaan kebocoran Catatan Siswa 18 Okt 2026):
// L1 jalur Edge hanya menerima visibilitas yang sama dengan formulir guru (RESTRICTED/PUBLIC/INTERNAL_SCHOOL/STUDENT_VISIBLE ditolak; yang sah tetap diterima);
// L2 student_id catatan tidak dapat dipindah ke siswa lain (siswa/orang tua lain tidak membaca); penyuntingan isi dan pembatalan sah tetap berfungsi;
// peran lain (Waka Humas, Kepsek, BK, Waka Kesiswaan, admin) tetap tidak membaca catatan biasa.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/catatan-kebocoran.mjs     (UJI_TERAPKAN_MIGRASI=1 menerapkan migrasi di dalam transaksi uji; KONTROL_NEGATIF=1 TANPA perbaikan untuk membuktikan celahnya)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRASI = '20261018140000_catatan_tutup_kebocoran_visibilitas_dan_siswa.sql';
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'catatan-kebocoran.sql'), 'utf8');
const NL = String.fromCharCode(10);

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-bocor-'));
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
  const ada = jalankan("select (exists (select 1 from pg_trigger where tgname = 'trg_observation_student_immutable'))::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log(`SKIP: migrasi ${MIGRASI} belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).`); process.exit(0); }
}
let migrasi = (terapkan || negatif) ? readFileSync(join(ROOT, 'supabase', 'migrations', MIGRASI), 'utf8') + NL : '';
if (negatif) {
  // Kontrol negatif: tanpa daftar putih dan tanpa pemicu (keadaan sebelum perbaikan)
  migrasi = migrasi.replace(/IF p_visibility IS NULL OR p_visibility NOT IN[\s\S]*?END IF;/, '')
                   .replace(/CREATE TRIGGER trg_observation_student_immutable[^;]*;/, 'DROP TRIGGER IF EXISTS trg_observation_student_immutable ON public.observations;');
}

const hitung = "select (select count(*) from public.observations)::text as o, (select count(*) from public.notifications)::text as n;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;' + NL + migrasi + badan + NL + 'rollback;' + NL);
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));

if (negatif) {
  const bocor1 = nilai.get('L1a_RESTRICTED') === 'ok' && nilai.get('L1e_RESTRICTED_dibaca_waka_humas') === '1';
  const bocor2 = nilai.get('L2a_update_pindah_siswa') === 'ok' && nilai.get('L2b_siswa_lain_membaca') === '1' && nilai.get('L2c_ortu_lain_membaca') === '1';
  console.log(`KONTROL NEGATIF (tanpa perbaikan): L1 ${bocor1 ? 'terbukti (RESTRICTED diterima, Waka Humas membaca)' : 'TIDAK terbukti'}; L2 ${bocor2 ? 'terbukti (catatan pindah, siswa dan orang tua lain membaca)' : 'TIDAK terbukti'}`);
  process.exit(bocor1 && bocor2 ? 0 : 1);
}

let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}${NL}         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'autor=t stu=t stu_lain=t siswa=t ortu=t siswa_lain=t ortu_lain=t wakhum=t');
ditolak('L1a_RESTRICTED', '22023'); ditolak('L1b_PUBLIC', '22023'); ditolak('L1c_INTERNAL_SCHOOL', '22023'); ditolak('L1d_STUDENT_VISIBLE', '22023');
sama('L1e_RESTRICTED_dibaca_waka_humas', '0'); sama('L1f_sah', 'private=ok siswa=ok ortu=ok keduanya=ok'); sama('L1g_sinkron_ulang_sah', 'ok');
ditolak('L2a_update_pindah_siswa', '42501'); sama('L2b_siswa_lain_membaca', '0'); sama('L2c_ortu_lain_membaca', '0'); sama('L2d_siswa_asli_tetap_membaca', '1');
sama('L2e_sunting_isi_sah', 'ok'); sama('L2f_pembatalan_sah', 'ok');
sama('K1_peran_lain_membaca', 'wakhum=0 kepsek=0 bk=0 wakes=0 admin=0 siswa=1 ortu=0 penulis=1');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`${NL}CATATAN_KEBOCORAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
