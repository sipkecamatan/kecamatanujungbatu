// Uji LIVE (migrasi 20261018200000_nilai_rapor_rumus_tersimpan.sql): rumus nilai rapor (metode + bobot persen) tersimpan di kolom grade_final.rumus; guru menyimpan,
// wali kelas membaca, pihak lain tidak; nilai yang bukan objek JSON ditolak. Seluruh skenario di dalam transaksi yang SELALU dibatalkan (sekolah uji smkuji1).
// Pakai:  node tests/nilai-rapor-rumus.mjs   (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'nilai-rapor-rumus.sql'), 'utf8');
function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-rumus-'));
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
if (!terapkan) {
  const ada = jalankan("select exists (select 1 from information_schema.columns where table_schema='public' and table_name='assessments' and column_name='judul')::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261018200000_nilai_rapor_rumus_tersimpan belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? ['20261018200000_nilai_rapor_rumus_tersimpan.sql', '20261018210000_penilaian_judul_dan_saran_tersimpan.sql', '20261018220000_nilai_rapor_otomatis_tanpa_saran.sql'].map((f) => readFileSync(join(ROOT, 'supabase', 'migrations', f), 'utf8') + '\n').join('') : '';
const hitung = "select count(*)::int as baris from grade_final;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
sama('persona', 'guru=t kelas=t siswa=t wali=t waka_kes=t');
sama('R1_guru_menyimpan_rumus', 'BOBOT/60'); sama('R2_rumus_terbaca_ulang_oleh_guru', 'BOBOT/40');
sama('R3_wali_kelas_membaca_baris', '1'); sama('R4_Waka_Kesiswaan_tidak_membaca', '0');
sama('R5_rumus_bukan_objek_ditolak_23514', 'GALAT:23514');
sama('J1_judul_penilaian_tersimpan', 'UH 1 Jurnal Umum'); sama('J2_judul_121_karakter_ditolak', 'GALAT:23514'); sama('J3_judul_kosong_ditolak', 'GALAT:23514'); sama('R6_rumus_boleh_kosong', 'ok');
const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris nilai rapor uji tertinggal', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nNILAI_RAPOR_RUMUS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
