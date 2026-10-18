// Uji LIVE migrasi 20261018180000_kasus_kepsek_hanya_agregat.sql (keputusan Romo 18 Okt 2026): Kepala Sekolah dikeluarkan dari Pembinaan Siswa dan hanya melihat angka agregat.
// Kepsek tidak membaca kasus/peristiwa/daftar pembaca/log akses, tidak menulis peristiwa apa pun, tidak dapat ditandai atau dituju eskalasi, tidak membuka kembali kasus tutup;
// Waka Kesiswaan tetap pengawas (membaca, jejak pengawas, buka kembali); fn_kepsek_case_summary hanya angka dan hanya untuk Kepsek.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/kasus-kepsek.mjs     (UJI_TERAPKAN_MIGRASI=1 menerapkan migrasi di dalam transaksi uji; KONTROL_NEGATIF=1 TANPA migrasi untuk membuktikan keadaan sebelumnya)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRASI = '20261018180000_kasus_kepsek_hanya_agregat.sql';
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'kasus-kepsek.sql'), 'utf8');
const NL = String.fromCharCode(10);

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-kepsek-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, sql);
  try {
    const r = spawnSync(`supabase db query --linked -o json -f "${f}"`, { shell: true, encoding: 'utf8', maxBuffer: 64e6, cwd: ROOT });
    if (r.status !== 0) throw new Error(`CLI ${r.status}: ${String(r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|unexpected|Failed/.test(l)).join(' ').slice(0, 500)}`);
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
  const ada = jalankan("select (to_regprocedure('public.fn_kepsek_case_summary()') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log(`SKIP: migrasi ${MIGRASI} belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).`); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', MIGRASI), 'utf8') + NL : '';

const hitung = "select (select count(*) from public.coaching_cases)::text as k, (select count(*) from public.coaching_case_events)::text as e, (select count(*) from public.notifications)::text as n, (select count(*) from public.coaching_case_access_log)::text as l;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;' + NL + migrasi + badan + NL + 'rollback;' + NL);
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));

if (negatif) {
  const bocor = nilai.get('K1_baca')?.startsWith('kepsek_kasus=1 kepsek_peristiwa=') && nilai.get('K2_tulis')?.includes('komentar=') && !nilai.get('K2_tulis')?.startsWith('komentar=GALAT');
  console.log(`KONTROL NEGATIF (tanpa migrasi): ${nilai.get('K1_baca')} | ${nilai.get('K2_tulis')} | K3f_status_setelah_percobaan_kepsek=${nilai.get('K3f_status_setelah_percobaan_kepsek')} -> ${bocor ? 'terbukti: Kepsek membaca dan menulis pada kasus orang lain' : 'TIDAK terbukti'}`);
  process.exit(bocor ? 0 : 1);
}

let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}${NL}         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'creator=true kepsek=true waka=true wali=true guru_lain=true');
sama('K1_baca', 'kepsek_kasus=0 kepsek_peristiwa=0 pembuat=1 waka=1 guru_lain=0');
cek('K1b_daftar_pembaca_dan_log', /^kepsek_pembaca=GALAT:42501 kepsek_log=GALAT:42501 waka_pembaca=\d+ waka_log=\d+ pembuat_pembaca=\d+$/.test(nilai.get('K1b_daftar_pembaca_dan_log') || ''));
sama('K1c_jejak_pengawas', 'kepsek=false waka=true');
cek('K2_tulis', /^komentar=GALAT:42501 eskalasi=GALAT:\w+ status=GALAT:42501 tutup=GALAT:42501 tandai=GALAT:42501$/.test(nilai.get('K2_tulis') || ''));
ditolak('K3_tandai_kepsek', 'P0001');
sama('K3b_kandidat_penanda', '0'); sama('K3c_kandidat_eskalasi', '0');
cek('K3d_eskalasi_ke_kepsek', /^GALAT:P0001$/.test(nilai.get('K3d_eskalasi_ke_kepsek') || ''));
sama('K3e_kandidat_lain_tetap_ada', 'true');
sama('K3f_status_setelah_percobaan_kepsek', 'OPEN');   // percobaan tutup oleh Kepsek tidak mengubah kasus
cek('K4_buka_kembali', /^kepsek=GALAT:(42501|P0001) waka=ok$/.test(nilai.get('K4_buka_kembali') || ''));
sama('K5_ringkasan_kepsek', 'total_ada=t per_status=t per_track=t bocor_judul=f bocor_deskripsi=f kunci=dibuka_30_hari,ditutup_30_hari,per_status,per_track,rata_hari_penyelesaian,total');
sama('K5b_ringkasan_ditolak_bagi_lain', 'waka=GALAT:42501 guru=GALAT:42501 pembuat=GALAT:42501');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`${NL}KASUS_KEPSEK: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
