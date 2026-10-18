// Uji LIVE tarik/pulihkan posting forum (migrasi 20261018090000_forum_tarik_posting.sql; keputusan Romo 18 Okt 2026: fitur tarik posting perlu ada): posting yang ditarik hilang dari
// semua penerima tetapi tetap terlihat penulis; penulis menarik dan memulihkan miliknya; moderator (Kepsek/Waka Kesiswaan/admin) yang MENJADI PENERIMA dapat menarik, memulihkan, dan
// tetap membaca; penerima biasa/orang lain/moderator non-penerima ditolak (42501); komentar tak dapat ditulis pada posting yang ditarik.
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-tarik-posting.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-tarik-posting.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumtarik-'));
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
  const sudah = jalankan("select (pg_get_functiondef('public.fn_toggle_forum_post_withdrawn(uuid,boolean)'::regprocedure) like '%moderator yang menerima posting ini%')::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018090000_forum_tarik_posting belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018090000_forum_tarik_posting.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima, (select count(*) from forum_post_comments)::int as komentar;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);
const DITOLAK = 'GALAT:42501';

sama('persona', 'penulis=t penerima=t lain=t kepsek=t waka_kes=t ortu=t');
sama('T0_sebelum_tarik', 'penulis=1 penerima=1 kepsek=1 ortu=1');
sama('T1_penerima_biasa_tidak_dapat_menarik', DITOLAK); sama('T2_orang_lain_tidak_dapat_menarik', DITOLAK); sama('T3_moderator_bukan_penerima_tidak_dapat_menarik', DITOLAK);
sama('T4_penulis_menarik', 'true');
sama('T5_setelah_ditarik', 'penulis=1 penerima=0 ortu=0 kepsek_moderator_penerima=1');
sama('T6_penerima_tak_dapat_berkomentar_pada_posting_ditarik', DITOLAK); sama('T7_penerima_tak_dapat_memulihkan', DITOLAK);
sama('T8_penulis_memulihkan', 'false');
sama('T9_setelah_dipulihkan', 'penulis=1 penerima=1 ortu=1');
sama('M1_moderator_penerima_menarik', 'true'); sama('M2_moderator_penerima_tetap_membaca_yang_ditarik', '1'); sama('M3_moderator_penerima_memulihkan', 'false');
sama('D1_penulis_ubah_kolom_langsung_tetap_ditolak', DITOLAK); sama('D2_posting_tidak_ada', 'GALAT:P0002');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, penerima, atau komentar uji tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_TARIK_POSTING: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
