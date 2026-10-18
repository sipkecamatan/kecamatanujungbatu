// Uji LIVE aturan baca forum (migrasi 20261018050000_forum_baca_penerima_saja.sql; aturan produk Romo 18 Okt 2026): posting forum hanya dibaca penulis dan penerimanya,
// untuk lingkup SEKOLAH maupun KELAS; guru lain, wali kelas, Kaprodi, Kepsek, Waka Kesiswaan, TU, admin, orang tua, dan siswa yang BUKAN penerima membaca 0; TU tidak lagi
// membaca semua (posting, komentar, daftar penerima); posting ditarik hanya terlihat penulis; moderator hanya dapat menghapus posting yang ditujukan kepadanya.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-aturan-baca.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-aturan-baca.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumbaca-'));
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
  const sudah = jalankan("select (not exists (select 1 from pg_policies where schemaname='public' and policyname='rls_forum_posts_read_tu'))::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018050000_forum_baca_penerima_saja belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018050000_forum_baca_penerima_saja.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima, (select count(*) from forum_post_comments)::int as komentar;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:42501';

sama('persona', 'guru_kelas=t wali=t kaprodi=t kepsek=t waka_kes=t tu=t admin=t ortu=t siswa=t');
for (const p of ['penulis', 'penerima']) sama('baca_' + p, 'KELAS=1 SEKOLAH=1');
for (const p of ['guru_kelas_lain', 'wali_kelas', 'kaprodi', 'kepsek', 'waka_kesiswaan', 'tu', 'admin', 'ortu', 'siswa']) sama('baca_' + p, 'KELAS=0 SEKOLAH=0');
sama('komentar_dan_penerima_dibaca_tu', 'komentar=0 penerima=0');
sama('ditarik', 'penulis=1 penerima=0');
sama('hapus_kepsek_posting_bukan_untuknya', DITOLAK); sama('hapus_kepsek_posting_untuknya', '1'); sama('hapus_penulis_miliknya', '1'); sama('hapus_guru_lain_ditolak', DITOLAK);

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, penerima, atau komentar uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_ATURAN_BACA: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
