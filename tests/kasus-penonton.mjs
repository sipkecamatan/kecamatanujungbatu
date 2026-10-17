// Uji LIVE aturan keterlihatan kasus pembinaan (migrasi 20261017040000_kasus_penonton.sql).
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1;
// tidak ada data yang berubah. Butuh login CLI Supabase tertaut dan migrasi sudah terpasang.
// Pakai:  node tests/kasus-penonton.mjs
//   UJI_TERAPKAN_MIGRASI=1 node tests/kasus-penonton.mjs   -> menerapkan berkas migrasi DI DALAM transaksi uji
//   (dibatalkan juga), untuk memeriksa sebelum `supabase db push`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'kasus-penonton.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-kasus-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, sql);
  try {
    const r = spawnSync(`supabase db query --linked -o json -f "${f}"`, { shell: true, encoding: 'utf8', maxBuffer: 64e6, cwd: ROOT });
    if (r.status !== 0) throw new Error(`CLI ${r.status}: ${String(r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|unexpected|Failed/.test(l)).join(' ').slice(0, 400)}`);
    const out = String(r.stdout || '');
    const awal = out.search(/[\[{]/);
    if (awal < 0) throw new Error(`keluaran CLI bukan JSON (${out.length} byte)`);
    const j = JSON.parse(out.slice(awal));
    return Array.isArray(j) ? j : (j.rows ?? []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const terapkan = process.env.UJI_TERAPKAN_MIGRASI === '1';
// Pastikan migrasi terpasang; bila belum, uji tidak bermakna (kecuali diterapkan di dalam transaksi uji).
if (!terapkan) {
  const ada = jalankan("select (to_regprocedure('public.fn_case_add_viewer(uuid,uuid)') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261017040000_kasus_penonton belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261017040000_kasus_penonton.sql'), 'utf8') + '\n' : '';

const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const mulai = (k, awalan) => cek(k, (nilai.get(k) ?? '').startsWith(awalan), `${nilai.get(k)}  (harap diawali: ${awalan})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

mulai('persona', 'creator=true wali=true guruwali=true bk=true lain=true admin=true kepsek=true waka=true ortu=true ortu_lain=true siswa=true');
sama('S1_awal_lihat_kasus', 'pembuat=1 wali=0 guruwali=0 bk=0 lain=0 admin=0 kepsek=1 waka=1 ortu=0 siswa=0');
mulai('S2_kandidat', 'Wali Kelas:1, Guru Wali:1, Guru BK:1, Kaprodi:1, Orang tua:1, Siswa:1, Staf lain:');
sama('S2b_kandidat_tanpa_pembuat', 'true');
ditolak('S2c_kandidat_ditolak_bagi_lain', '42501');
cek('S3_tandai', (nilai.get('S3_tandai').match(/"ditambahkan": true/g) || []).length === 4);
sama('S3b_lihat_setelah_tandai', 'wali=1 guruwali=1 bk=0 lain=0 admin=0 ortu=1 siswa=1');
sama('S4_notifikasi', '4 notifikasi CASE_TAGGED; mengandung judul kasus=false');
cek('S5_event_dilihat_total_2', /^wali=([3-9]) ortu=1 siswa=1$/.test(nilai.get('S5_event_dilihat_total_2') || ''));
for (const k of ['S5b_penonton_tak_bisa_menulis_event', 'S5c_penonton_tak_bisa_menambah_penonton', 'S5d_penonton_tak_bisa_mencabut', 'S5e_bukan_penonton_tak_bisa_melihat_daftar']) ditolak(k, '42501');
sama('S5f_pembuat_melihat_daftar', '4');
sama('S6_sasaran_tidak_sah', 'admin=GALAT:P0001 ortu_siswa_lain=GALAT:P0001');
sama('S7_cabut_oleh_pembuat', '{"ok": true, "dicabut": 1}');
sama('S7b_wali_setelah_dicabut', '0');
sama('S8_setelah_eskalasi', 'pembuat=1 penangan_sebelumnya_wali=1 penangan_baru_bk=1 lain=0');
sama('S8b_penangan_baru_boleh_menandai', '{"ok": true, "ditambahkan": true}');
ditolak('S8c_penangan_baru_tak_boleh_mencabut', '42501');
sama('S8d_pembuat_masih_boleh_mencabut', '{"ok": true, "dicabut": 1}');
sama('S9_log_pengawas', 'kepsek_pertama=true kepsek_kedua=false waka=true pembuat=false penonton=false');
sama('S9b_log_dibaca_pembuat', '2');
ditolak('S9c_log_ditolak_bagi_guru_lain', '42501');
cek('S10_admin', nilai.get('S10_admin') === 'hitungan={"open": 1, "total": 1} aktivitas_baris=5 baca_langsung_kasus=0 baca_langsung_event=0 guru_memanggil_fungsi_admin=GALAT:42501');
sama('S10b_aktivitas_admin_tanpa_judul', 'true');
sama('S10c_hitungan_kasus_admin', 'semua=1 siswa_kasus=1 siswa_lain=0 guru=GALAT:42501');

// Sesudah ROLLBACK tidak boleh ada sisa.
const sisa = jalankan("select (select count(*) from coaching_cases)::int as kasus, (select count(*) from notifications where type = 'CASE_TAGGED')::int as notif;");
cek('SISA: tidak ada kasus dan notifikasi uji tertinggal', sisa[0]?.kasus === 0 && sisa[0]?.notif === 0, JSON.stringify(sisa[0]));

console.log(`\nKASUS_PENONTON: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
