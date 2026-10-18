// Uji LIVE daftar penerima privat dan notifikasi komentar penulis (migrasi 20261018110000_forum_penerima_privat_dan_komentar_penulis.sql; keputusan Romo 18 Okt 2026, A-04/B-01 dan B-05):
// penerima hanya melihat BARIS DIRINYA SENDIRI di daftar penerima dan konfirmasi baca, penulis melihat semuanya; penerima tetap menemukan posting lewat barisnya dan tetap dapat
// menandai dibaca; komentar peserta lain memberi tahu penulis + yang sudah membaca + komentator sebelumnya; komentar PENULIS memberi tahu SEMUA penerima aktif (bukan dirinya).
// Seluruh skenario berjalan di dalam transaksi yang SELALU dibatalkan pada sekolah uji smkuji1.
// Pakai:  node tests/forum-penerima-privat.mjs      (UJI_TERAPKAN_MIGRASI=1 menerapkan berkas migrasi di dalam transaksi uji, tanpa db push)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const badan = readFileSync(join(ROOT, 'tests', 'lib', 'forum-penerima-privat.sql'), 'utf8');

function jalankan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-forumprivat-'));
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
  const sudah = jalankan("select exists (select 1 from pg_policies where schemaname='public' and policyname='rls_forum_aud_own_read')::text as sudah;");
  if (sudah[0]?.sudah !== 'true') { console.log('SKIP: migrasi 20261018110000_forum_penerima_privat_dan_komentar_penulis belum terpasang (db push dulu, atau jalankan dengan UJI_TERAPKAN_MIGRASI=1).'); process.exit(0); }
}
const migrasi = terapkan ? readFileSync(join(ROOT, 'supabase', 'migrations', '20261018110000_forum_penerima_privat_dan_komentar_penulis.sql'), 'utf8') + '\n' : '';

const hitung = 'select (select count(*) from forum_posts)::int as posting, (select count(*) from forum_post_audience)::int as penerima, (select count(*) from forum_post_acknowledgements)::int as ack, (select count(*) from forum_post_comments)::int as komentar, (select count(*) from notifications)::int as notifikasi, (select count(*) from users where is_active)::int as aktif;';
const awal = jalankan(hitung)[0];
const baris = jalankan('begin;\n' + migrasi + badan + '\nrollback;\n');
const nilai = new Map(baris.map((r) => [r.k, String(r.v)]));
let lulus = 0, gagal = 0;
const cek = (k, ok, tampil) => { if (ok) { lulus++; console.log('  LULUS  ' + k); } else { gagal++; console.log(`  GAGAL  ${k}\n         didapat: ${tampil ?? nilai.get(k)}`); } };
const sama = (k, harap) => cek(k, nilai.get(k) === harap, `${nilai.get(k)}  (harap: ${harap})`);

sama('persona', 'penulis=t p1=t p2=t waka=t ortu=t');
sama('A1_baris_audiens_yang_terlihat', 'penulis=4 penerima1=1 penerima2=1 ortu=1 moderator=1');
sama('A2_penerima_masih_menemukan_posting_lewat_barisnya', '1');
sama('A3_penerima_tak_dapat_menambah_diri_ke_audiens', 'GALAT:42501');
sama('K1_konfirmasi_baca_yang_terlihat', 'penulis=2 penerima1=1 penerima2=0 ortu=1');
sama('K2_penerima_masih_dapat_menandai_dibaca', '1');
sama('N1_komentar_penerima_memberi_tahu', 'penulis=1 penerima2=1 ortu=1 moderator=0');
sama('N2_komentar_penulis_memberi_tahu_semua_penerima', 'penulis=0 p1=1 p2=1 ortu=1 moderator=1');
sama('N3_teks_notifikasi_penulis', 'true');
sama('N4_penerima_nonaktif_tidak_diberi_tahu', '0');

const sisa = jalankan(hitung)[0];
cek('SISA: tidak ada posting, penerima, konfirmasi, komentar, notifikasi, atau perubahan pengguna tertinggal (sama dengan keadaan awal)', JSON.stringify(sisa) === JSON.stringify(awal), JSON.stringify({ awal, sisa }));
console.log(`\nFORUM_PENERIMA_PRIVAT: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
