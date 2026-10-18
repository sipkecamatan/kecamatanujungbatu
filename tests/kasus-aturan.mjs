// Uji LIVE aturan kasus pembinaan lanjutan (migrasi 20261017100000_kasus_aturan_lanjutan.sql): status maju/mundur satu langkah,
// buka kembali kasus tertutup hanya oleh Waka Kesiswaan/Kepsek, eskalasi hanya ke kandidat, hanya NOTE_ADDED terlihat.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1 dengan kasus buatan sendiri.
// Pakai:  node tests/kasus-aturan.mjs
//   UJI_TERAPKAN_MIGRASI=1 node tests/kasus-aturan.mjs  -> menerapkan berkas migrasi DI DALAM transaksi uji (dibatalkan juga).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'kasus-aturan.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-aturan-'));
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
  const ada = jalankan("select (exists(select 1 from pg_trigger where tgname = 'trg_cce_rules') and to_regprocedure('public.fn_kepsek_case_summary()') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261017100000_kasus_aturan_lanjutan dan 20261018180000_kasus_kepsek_hanya_agregat belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
// Migrasi 20261017100000 sudah terpasang (tidak idempoten); mode terapkan hanya memuat migrasi baru 20261018180000 (Kepsek hanya agregat) di dalam transaksi uji.
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018180000_kasus_kepsek_hanya_agregat.sql'), 'utf8') + '\n' : '';

const awal = jalankan("select count(*)::int as kasus from coaching_cases;")[0] ?? { kasus: 0 };
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ok = (k) => sama(k, 'ok');
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'creator=true wali=true lain=true kepsek=true waka=true wali_kandidat=true');
ok('A1_maju_open_ke_review'); sama('A1b_event_status_dipaksa_tak_terlihat', 'true');
ditolak('A2_mundur_tanpa_catatan', 'P0001'); ok('A2b_mundur_satu_langkah_bercatatan');
ditolak('A3_mundur_dua_langkah', 'P0001'); ditolak('A4_status_sama', 'P0001'); ditolak('A4b_tutup_lewat_status', 'P0001');
ok('A5_note_terlihat_tetap_terlihat'); sama('A5b_note_terlihat_tersimpan', 'true');
ditolak('B1_eskalasi_ke_non_kandidat', 'P0001'); ok('B2_eskalasi_ke_kandidat'); sama('B2b_penangan_sekarang_wali', 'true');
ditolak('B3_bekas_penangan_tak_bisa_ubah_status', '42501');
ok('C1_tutup_oleh_penangan'); sama('C1b_status_tertutup', 'CLOSED');
ditolak('C2_buka_kembali_oleh_penangan', '42501'); ditolak('C3_waka_tanpa_catatan', 'P0001'); ditolak('C3b_waka_ke_status_selain_monitoring', 'P0001');
ok('C4_waka_bercatatan'); sama('C4b_status_dan_penutupan_setelah_buka', 'MONITORING/closed_at=null'); ok('C5_kasus_dibuka_kembali_menerima_catatan');
ditolak('D1_catatan_pada_kasus_tertutup', 'P0001'); ditolak('D2_kepsek_tak_dapat_buka_kembali', '42501'); ok('D2b_waka_buka_kembali');   // Kepsek dikeluarkan dari Pembinaan Siswa (20261018180000); hanya Waka Kesiswaan membuka kembali sama('D3_tutup_dua_kali', 'ok/GALAT:P0001');
sama('E1_student_updates_tanpa_kebijakan_baca', '0');

const sisa = jalankan('select count(*)::int as kasus from coaching_cases;')[0];
cek('SISA: tidak ada kasus uji tertinggal (sama dengan keadaan awal)', sisa?.kasus === awal.kasus, JSON.stringify({ awal, sisa }));
console.log(`\nKASUS_ATURAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
