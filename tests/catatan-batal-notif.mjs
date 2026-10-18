// Uji LIVE migrasi 20261018130000_catatan_dibatalkan_hapus_notifikasi.sql: notifikasi "Catatan guru baru" tersambung ke catatannya; saat penulis membatalkan
// catatan, notifikasinya ikut dicabut (siswa dan orang tua tidak lagi diberi tahu tentang catatan yang tidak ada); catatan lain dan notifikasi lama tidak tersentuh.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/catatan-batal-notif.mjs     (UJI_TERAPKAN_MIGRASI=1 menerapkan migrasi di dalam transaksi uji; KONTROL_NEGATIF=1 tanpa baris penghapus notifikasi)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRASI = '20261018130000_catatan_dibatalkan_hapus_notifikasi.sql';
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'catatan-batal-notif.sql'), 'utf8');
const NL = String.fromCharCode(10);

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-notifbatal-'));
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
  const ada = jalankan("select (exists (select 1 from information_schema.columns where table_name = 'notifications' and column_name = 'observation_id'))::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log(`SKIP: migrasi ${MIGRASI} belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).`); process.exit(0); }
}
let migrasi = (terapkan || negatif) ? readFileSync(join(ROOT, 'supabase', 'migrations', MIGRASI), 'utf8') + NL : '';
if (negatif) migrasi = migrasi.replace(/DELETE FROM public\.notifications WHERE observation_id = p_observation_id[^;]*;/, '');

const hitung = "select (select count(*) from public.notifications)::text as n, (select count(*) from public.observations)::text as o;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;' + NL + migrasi + badan + NL + 'rollback;' + NL);
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));

if (negatif) {
  const sisa = nilai.get('N5_notifikasi_catatan_batal_hilang');
  console.log(`KONTROL NEGATIF (tanpa penghapusan notifikasi): notifikasi catatan batal yang tersisa = ${sisa} -> ${sisa === '2' ? 'celah terbukti (siswa dan orang tua masih diberi tahu)' : 'TIDAK terbukti'}`);
  process.exit(sisa === '2' ? 0 : 1);
}

let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}${NL}         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'autor=t stu=t ortu=t siswa=t guru_lain=t');
sama('N1_notifikasi_tersambung', 'o1=2 o2=2'); ditolak('N2_guru_lain_tak_dapat_membatalkan', '42501'); sama('N3_notifikasi_tetap_setelah_ditolak', '2');
sama('N4_penulis_membatalkan', 'ok'); sama('N5_notifikasi_catatan_batal_hilang', '0'); sama('N6_catatan_lain_tetap_diberitahu', '2'); sama('N7_notifikasi_lama_tak_tersentuh', '1');
sama('N8_siswa_tak_membaca_catatan_batal', '0'); sama('N9_ortu_tak_membaca_catatan_batal', '0'); sama('N10_siswa_masih_membaca_catatan_lain', '1'); ditolak('N11_batal_dua_kali_ditolak', '42501');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`${NL}CATATAN_BATAL_NOTIF: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
