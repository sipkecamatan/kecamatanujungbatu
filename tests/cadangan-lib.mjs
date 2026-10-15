// Uji tools/cadangan-lib.mjs di PGlite: urutan induk-anak, ekspor lalu pulih tanpa
// kehilangan nilai (uuid, jsonb, array, timestamptz, numeric, kolom hasil hitung, identitas).
//   SIP_ROOT=<folder repo> node tests/cadangan-lib.mjs   (SIP_ROOT opsional)
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { urutkanTabel, sqlPulihBaris, sqlHalaman, sqlKolom, sqlKunciAsing, IDENT } from '../tools/cadangan-lib.mjs';

let lulus = 0;
const test = async (nama, fn) => { await fn(); console.log(`PASS CADANGAN ${++lulus}: ${nama}`); };

const skema = `
  create table public.sekolah (id uuid primary key, nama text not null, meta jsonb, tag text[], dibuat timestamptz default now(), skor numeric(6,2));
  create table public.siswa (id uuid primary key, sekolah_id uuid not null references public.sekolah(id), nama text,
                             huruf text generated always as (upper(nama)) stored);
  create table public.catatan (no int generated always as identity primary key, siswa_id uuid references public.siswa(id), isi text);
  create table public."Tabel Aneh" (id int primary key, "kolom ""x""" text);
  create function public.catat() returns trigger language plpgsql as $$ begin raise exception 'pemicu tidak boleh jalan saat pulih'; end $$;
  create trigger trg_catat before insert on public.catatan for each row execute function public.catat();
`;
const sekolah = '00000000-0000-4000-8000-0000000000a1', siswa = '00000000-0000-4000-8000-0000000000b1';

await test('urutkanTabel: induk lebih dulu, siklus dan self-reference tidak menggantung', async () => {
  const urut = urutkanTabel(['catatan', 'siswa', 'sekolah'], [
    { anak: 'public.catatan', induk: 'public.siswa' }, { anak: 'public.siswa', induk: 'public.sekolah' }]);
  assert.deepEqual(urut, ['sekolah', 'siswa', 'catatan']);
  const siklus = urutkanTabel(['a', 'b', 'c'], [{ anak: 'a', induk: 'b' }, { anak: 'b', induk: 'a' }, { anak: 'c', induk: 'c' }]);
  assert.equal(siklus.length, 3);
});

await test('sqlPulihBaris: kosong menghasilkan teks kosong; tag kutip dolar menghindari bentrok', async () => {
  assert.equal(sqlPulihBaris('t', ['a'], []), '');
  const sql = sqlPulihBaris('t', ['a'], [{ a: 'berisi $sipj$ di dalam' }]);
  assert.ok(sql.includes('$sipjx$'));
});

const asal = await PGlite.create();
await asal.exec(skema.replace(/create trigger[^;]+;/, ''));   // asal tanpa pemicu agar data awal bisa dimasukkan
await asal.exec(`
  insert into sekolah values ('${sekolah}', 'SMA "Uji" Satu', '{"a":[1,2,{"b":null}],"c":"x"}', '{p,"q r"}', '2026-10-15 07:30:00+07', 12.50);
  insert into siswa (id, sekolah_id, nama) values ('${siswa}', '${sekolah}', 'Budi o''Neil');
  insert into catatan (siswa_id, isi) values ('${siswa}', 'baris 1'), (null, 'dengan ''kutip'' dan \\ garis miring');
  insert into "Tabel Aneh" values (1, 'nilai');
`);

const tujuan = await PGlite.create();
await tujuan.exec(skema);   // dengan pemicu: harus dimatikan selama pemulihan

await test('ekspor lalu pulih mengembalikan seluruh nilai, termasuk tabel dengan nama aneh', async () => {
  const kolomDari = async (t) => (await asal.query(sqlKolom(t))).rows.map((r) => r.column_name);
  const fk = (await asal.query(sqlKunciAsing)).rows;
  const tabel = urutkanTabel(['catatan', 'siswa', 'sekolah', 'Tabel Aneh'], fk);
  assert.deepEqual(tabel.slice(0, 2), ['sekolah', 'siswa'].filter((t) => tabel.indexOf(t) < 2).length === 2 ? ['sekolah', 'siswa'] : tabel.slice(0, 2));
  for (const t of tabel) {
    const baris = (await asal.query(sqlHalaman(t, 100, 0))).rows[0].isi;
    const kolom = await kolomDari(t);
    const sql = sqlPulihBaris(t, kolom, baris);
    if (sql) await tujuan.exec(sql);
  }
  const bandingkan = async (t, urut) => {
    const q = `select to_jsonb(x) as r from public.${IDENT(t)} x order by ${urut}`;
    assert.deepEqual((await tujuan.query(q)).rows, (await asal.query(q)).rows, `tabel ${t} berbeda`);
  };
  await bandingkan('sekolah', 'id');
  await bandingkan('siswa', 'id');
  await bandingkan('catatan', 'no');
  await bandingkan('Tabel Aneh', 'id');
});

await test('kolom hasil hitung tidak diisi dan nilainya tetap benar', async () => {
  const kolom = (await asal.query(sqlKolom('siswa'))).rows.map((r) => r.column_name);
  assert.ok(!kolom.includes('huruf'));
  const h = (await tujuan.query(`select huruf from public.siswa`)).rows[0].huruf;
  assert.equal(h, "BUDI O'NEIL");
});

await test('pemulihan kedua kali tidak menggandakan baris (on conflict do nothing)', async () => {
  const kolom = (await asal.query(sqlKolom('sekolah'))).rows.map((r) => r.column_name);
  const baris = (await asal.query(sqlHalaman('sekolah', 100, 0))).rows[0].isi;
  await tujuan.exec(sqlPulihBaris('sekolah', kolom, baris));
  assert.equal((await tujuan.query('select count(*)::int as n from public.sekolah')).rows[0].n, 1);
});

await test('pemicu pengguna aktif kembali setelah pemulihan', async () => {
  let galat = null;
  try { await tujuan.exec(`insert into public.catatan (siswa_id, isi) values (null, 'uji pemicu')`); } catch (e) { galat = e; }
  assert.ok(galat, 'pemicu seharusnya menolak insert');
});

console.log(`CADANGAN_LIB_COMPLETE: ${lulus} lulus`);
