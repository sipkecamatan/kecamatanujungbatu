// Uji LIVE nilai rapor DIHITUNG SERVER (migrasi 20261020150000_nilai_rapor_dihitung_server.sql): database sendiri menetapkan nilai_rapor dan metode dari rumus yang ikut tersimpan dan
// nilai penilaian SUMATIF; angka kiriman klien diabaikan; tanpa rumus atau tanpa data = ditolak; hanya sumatif milik guru itu yang ikut. Seluruh skenario berjalan di dalam transaksi yang
// SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1, memakai guru + kelas + mapel yang belum punya penilaian sumatif supaya hitungan tangan tidak tercampur data lain.
// Pakai:  node tests/nilai-rapor-server.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'nilai-rapor-server.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-nrserver-'));
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
  const ada = jalankan("select (to_regprocedure('public.fn_hitung_nilai_rapor(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb)') is not null)::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log('SKIP: migrasi 20261020150000 belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261020150000_nilai_rapor_dihitung_server.sql'), 'utf8') + '\n' : '';
const hitung = "select (select count(*) from learning_objectives)::int as tp, (select count(*) from assessments)::int as asesmen, (select count(*) from grade_final)::int as rapor, (select count(*) from assessment_results)::int as hasil;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const diawali = (k, awalan) => cek(k, (nilai.get(k) ?? '').startsWith(awalan), `${nilai.get(k)}  (harap diawali: ${awalan})`);

if (nilai.get('persona') !== 'guru_bersih=true') { console.log('SKIP: tidak ada guru + kelas + mapel tanpa penilaian sumatif pada periode ini; uji tidak dapat berjalan tanpa tercampur data lain.'); process.exit(0); }
// Angka kiriman klien selalu 100 dan metode MANUAL; yang tersimpan harus hasil hitung database dengan metode dari rumus.
sama('S1_rata_stu', '83/RATA');          // (80+60+90+100)/4 = 82,5 -> 83
sama('S1_bobot_stu', '85/BOBOT');        // 16 + 12 + 27 + 30
sama('S1_persen_stu', '50/PERSEN');      // TP A = 70 (tercapai, batas 70), TP B = 75 (belum, batas 80) -> 1 dari 2
sama('S1_terakhir_stu', '75/TERAKHIR');  // TP terakhir yang punya penilaian = B (C tanpa penilaian): rata-rata (60 + 90) / 2
sama('S2_rata_stu2', '60/RATA');         // (50+70)/2; penilaian tanpa nilai tidak dihitung
sama('S2_bobot_stu2', '62/BOBOT');       // bobot 20 dan 30 dinormalkan: 20 + 42
sama('S2_persen_stu2', '0/PERSEN');      // A = 50 (belum), B = 70 (belum)
sama('S2_terakhir_stu2', '70/TERAKHIR');
diawali('T1_bobot_90_ditolak', 'GALAT:P0001:nilai_rapor_tidak_dapat_dihitung');
diawali('T2_siswa_tanpa_nilai_ditolak', 'GALAT:P0001:nilai_rapor_tidak_dapat_dihitung');
diawali('T3_tanpa_rumus_ditolak', 'GALAT:P0001:nilai_rapor_tanpa_rumus');
diawali('T4_metode_asing_ditolak', 'GALAT:P0001:nilai_rapor_tanpa_rumus');
sama('U1_ubah_angka_langsung_diabaikan', '83');
sama('U2_izin_tampil_tak_hitung_ulang', '55');
sama('V1_jalur_tanpa_pengguna_tidak_dipaksa', '99/MANUAL');
sama('W1_hanya_sumatif_milik_guru_ini', '83');

const akhir = jalankan(hitung)[0];
cek('SISA: tidak ada TP, penilaian, hasil, atau nilai rapor uji tertinggal (sama dengan keadaan awal)', JSON.stringify(awal) === JSON.stringify(akhir), JSON.stringify(akhir) + ' vs ' + JSON.stringify(awal));
console.log(`\nNILAI_RAPOR_SERVER: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
