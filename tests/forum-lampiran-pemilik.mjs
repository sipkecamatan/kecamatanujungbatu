// Uji LIVE lampiran forum (migrasi 20261018030000_forum_lampiran_pemilik_dapat_hapus.sql): pemilik berkas dapat melihat dan menghapus berkas lampirannya sendiri
// walau tidak ada posting yang merujuknya lagi (posting dihapus/lampiran diganti); orang lain tidak dapat melihat/menghapusnya; moderator tetap bisa.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1 (objek storage uji hanya baris di dalam transaksi).
// Pakai:  node tests/forum-lampiran-pemilik.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-lampiran-pemilik.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumlamp-'));
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
  const sudah = jalankan("select exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='forum_attachments_download' and qual ilike '%owner_id%')::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018030000_forum_lampiran_pemilik_dapat_hapus belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018030000_forum_lampiran_pemilik_dapat_hapus.sql'), 'utf8') + '\n' : '';

const hitung = "select (select count(*) from storage.objects where bucket_id = 'forum-attachments')::int as berkas;";
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);

sama('persona', 'guru=t guru2=t kepsek=t');
sama('L1_pemilik_melihat_berkas_yatim_sendiri', '1'); sama('L2_guru_lain_tidak_melihat_berkas_itu', '0');
sama('L3_pemilik_lain_melihat_berkasnya_sendiri', '1'); sama('L4_guru_tidak_melihat_berkas_guru_lain', '0'); sama('L5_moderator_tetap_melihat_semua', '2');
const sisa = jalankan(hitung)[0];
cek('SISA: jumlah berkas di bucket tidak berubah (transaksi dibatalkan)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_LAMPIRAN_PEMILIK: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
