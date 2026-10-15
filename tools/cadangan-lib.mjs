/**
 * tools/cadangan-lib.mjs
 *
 * Fungsi bersama untuk cadangan dan pemulihan data (skema public).
 * Memakai `supabase db query --linked` (Management API), jadi TIDAK butuh Docker
 * atau pg_dump. Bagian murni (tanpa jaringan) diuji di tests/cadangan-lib.mjs.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const IDENT = (s) => '"' + String(s).replace(/"/g, '""') + '"';

/** Menjalankan SQL pada proyek yang sedang ter-link; mengembalikan array baris. */
export function jalankanSql(sql) {
    const dir = mkdtempSync(join(tmpdir(), 'sip-cadangan-'));
    const berkas = join(dir, 'q.sql');
    try {
        writeFileSync(berkas, sql, 'utf8');
        const argumen = ['db', 'query', '--linked', '-f', berkas];
        // Di Windows, supabase adalah skrip .cmd; dijalankan lewat cmd.exe tanpa opsi shell.
        const [perintah, args] = process.platform === 'win32'
            ? [process.env.ComSpec || 'cmd.exe', ['/c', 'supabase', ...argumen]]
            : ['supabase', argumen];
        const keluar = execFileSync(perintah, args,
            { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        const awal = keluar.indexOf('{');
        if (awal < 0) throw new Error('keluaran tidak berisi JSON: ' + keluar.slice(0, 200));
        const json = JSON.parse(keluar.slice(awal));
        return json.rows ?? [];
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export const sqlDaftarTabel =
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;

/** Satu halaman baris sebagai jsonb (urut tetap berdasarkan ctid untuk paging sederhana). */
export function sqlHalaman(tabel, ukuran, mulai) {
    return `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as isi from (select * from public.${IDENT(tabel)} order by ctid limit ${ukuran} offset ${mulai}) t`;
}
export const sqlHitung = (tabel) => `select count(*)::int as n from public.${IDENT(tabel)}`;
/** Jumlah baris semua tabel dalam SATU panggilan (jauh lebih cepat daripada satu per tabel). */
export const sqlHitungSemua = (tabel) => tabel
    .map((t) => `select '${String(t).replace(/'/g, "''")}' as t, count(*)::int as n from public.${IDENT(t)}`).join(' union all ');

/** Kolom yang dapat diisi (bukan kolom hasil hitung/generated), berurutan. */
export const sqlKolom = (tabel) =>
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = '${String(tabel).replace(/'/g, "''")}' and is_generated = 'NEVER' order by ordinal_position`;

/** Pasangan (anak, induk) dari kunci asing antar tabel public, tanpa self-reference. */
export const sqlKunciAsing =
    `select c.conrelid::regclass::text as anak, c.confrelid::regclass::text as induk
     from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid`;

const bersihNama = (s) => String(s).replace(/^public\./, '').replace(/^"|"$/g, '');

/** Urutan isi: induk lebih dulu. Siklus tidak mungkin diurut; sisanya ditaruh di akhir. */
export function urutkanTabel(tabel, kunciAsing) {
    const ada = new Set(tabel);
    const masuk = new Map(tabel.map((t) => [t, new Set()]));
    for (const { anak, induk } of kunciAsing) {
        const a = bersihNama(anak), i = bersihNama(induk);
        if (ada.has(a) && ada.has(i) && a !== i) masuk.get(a).add(i);
    }
    const hasil = [], selesai = new Set();
    let maju = true;
    while (maju && hasil.length < tabel.length) {
        maju = false;
        for (const t of tabel) {
            if (selesai.has(t)) continue;
            if ([...masuk.get(t)].every((i) => selesai.has(i))) { hasil.push(t); selesai.add(t); maju = true; }
        }
    }
    for (const t of tabel) if (!selesai.has(t)) hasil.push(t);   // siklus
    return hasil;
}

/**
 * SQL pemulihan satu bagian baris. Pemicu pengguna dimatikan selama isi agar tidak
 * membuat notifikasi atau efek samping; baris yang sudah ada dilewati.
 */
export function sqlPulihBaris(tabel, kolom, baris) {
    if (!baris.length) return '';
    const daftar = kolom.map(IDENT).join(', ');
    let tag = 'sipj';
    const isi = JSON.stringify(baris);
    while (isi.includes('$' + tag + '$')) tag += 'x';
    return `begin;
alter table public.${IDENT(tabel)} disable trigger user;
insert into public.${IDENT(tabel)} (${daftar}) overriding system value
  select ${daftar} from jsonb_populate_recordset(null::public.${IDENT(tabel)}, $${tag}$${isi}$${tag}$::jsonb)
  on conflict do nothing;
alter table public.${IDENT(tabel)} enable trigger user;
commit;`;
}
