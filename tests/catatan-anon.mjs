// Uji LIVE migrasi 20261018150000_catatan_cabut_hak_anon.sql: pengunjung tanpa login (peran anon) ditolak (42501) pada tabel catatan siswa dan tampilan lamanya;
// guru penulis, siswa, orang tua, dan service_role tidak berubah. Kontrol negatif (KONTROL_NEGATIF=1, hak anon dipulihkan): hak tabel anon terbuka lagi (A6 > 0); anon tetap gagal
// karena fungsi kebijakan RLS tidak boleh dijalankan anon (penghalang lain), sehingga pencabutan adalah lapis ketiga, bukan satu-satunya penghalang.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan (ROLLBACK) pada data sekolah uji smkuji1.
// Pakai:  node tests/catatan-anon.mjs     (UJI_TERAPKAN_MIGRASI=1 menerapkan migrasi di dalam transaksi uji)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRASI = '20261018150000_catatan_cabut_hak_anon.sql';
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'catatan-anon.sql'), 'utf8');
const NL = String.fromCharCode(10);

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-anon-'));
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
  const ada = jalankan("select (not has_table_privilege('anon', 'public.observations', 'select'))::text as ada;");
  if (ada[0]?.ada !== 'true') { console.log(`SKIP: migrasi ${MIGRASI} belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).`); process.exit(0); }
}
// Kontrol negatif: pulihkan hak anon (keadaan sebelum migrasi) di dalam transaksi uji
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', MIGRASI), 'utf8') + NL
  : negatif ? 'GRANT ALL ON TABLE public.observations TO anon;' + NL + 'GRANT ALL ON TABLE public.v_student_portal_positif TO anon;' + NL : '';

const hitung = "select (select count(*) from public.observations)::text as o, (select count(*) from public.notifications)::text as n;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;' + NL + migrasi + badan + NL + 'rollback;' + NL);
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));

if (negatif) {
  const hakTerbuka = Number(nilai.get('A6_hak_anon_tersisa')) > 0;
  console.log(`KONTROL NEGATIF (hak anon dipulihkan): hak tabel anon tersisa = ${nilai.get('A6_hak_anon_tersisa')}; anon select = ${nilai.get('A1_anon_select')} -> ${hakTerbuka ? 'hak tabel terbuka (uji A6 memang mendeteksinya); penghalang lain (fungsi RLS) tetap menahan anon' : 'TIDAK terbukti'}`);
  process.exit(hakTerbuka ? 0 : 1);
}

let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}${NL}         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const ditolak = (k, kode) => cek(k, nilai.get(k) === 'GALAT:' + kode, `${nilai.get(k)}  (harap GALAT:${kode})`);

sama('persona', 'autor=t stu=t siswa=t ortu=t');
ditolak('A1_anon_select', '42501'); ditolak('A2_anon_insert', '42501'); ditolak('A3_anon_update', '42501'); ditolak('A4_anon_delete', '42501'); ditolak('A5_anon_tampilan_lama', '42501');
sama('A6_hak_anon_tersisa', '0');
sama('B1_penulis_membaca', '1'); sama('B2_siswa_membaca', '1'); sama('B3_ortu_membaca', '1'); sama('B4_penulis_menulis', 'ok'); sama('B5_penulis_membatalkan', 'ok'); sama('B6_service_role_tetap', 'true');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada baris uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`${NL}CATATAN_ANON: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
