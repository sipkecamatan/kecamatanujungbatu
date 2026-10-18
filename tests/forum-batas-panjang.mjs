// Uji LIVE batas panjang forum di server (migrasi 20261018040000_forum_batas_panjang.sql; audit Forum A-13): judul <= 200, isi <= 5000, komentar <= 2000; batas pas
// diterima, lebih satu karakter ditolak (23514), baik lewat INSERT langsung maupun lewat fn_create_forum_post. Transaksi SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-batas-panjang.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-batas-panjang.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumbatas-'));
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
  const sudah = jalankan("select exists (select 1 from pg_constraint where conname = 'forum_posts_title_len_check')::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018040000_forum_batas_panjang belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018040000_forum_batas_panjang.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_comments)::int as komentar;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:23514';

sama('B1_judul_200_diterima', 'ok'); sama('B2_judul_201_ditolak', DITOLAK); sama('B3_isi_5000_diterima', 'ok'); sama('B4_isi_5001_ditolak', DITOLAK);
sama('B5_komentar_2000_diterima', 'ok'); sama('B6_komentar_2001_ditolak', DITOLAK);
sama('B7_rpc_judul_201_ditolak', DITOLAK); sama('B8_rpc_judul_200_diterima', 'ok');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting atau komentar uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_BATAS_PANJANG: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
