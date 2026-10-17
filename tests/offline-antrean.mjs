// Uji antrean offline portal guru (guru/js/offline.js): DG-05 (server error tidak boleh membuang antrean)
// dan DG-06 (antrean dipisah per pengguna). IndexedDB, fetch, dan api.js ditiru; tanpa jaringan/basis data.
// Pakai: node tests/offline-antrean.mjs [berkas-offline.js]   (kontrol negatif: berikan versi lama dari git)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sumber = process.argv[2] || path.join(ROOT, 'guru', 'js', 'offline.js');

// ── IndexedDB tiruan ──
const gudang = new Map(); // nama store -> Map(kunci -> item)
const kunciPath = { att_queue: 'idempotency_key', obs_queue: 'idempotency_key', jrn_queue: 'idempotency_key', case_queue: 'idempotency_key', jrn_del_queue: 'journal_id' };
const permintaan = (fn) => { const r = {}; setTimeout(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }, 0); return r; };
const store = (n) => { if (!gudang.has(n)) gudang.set(n, new Map()); return gudang.get(n); };
globalThis.indexedDB = {
  open() {
    const req = {};
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: (n) => gudang.has(n) },
        createObjectStore: (n) => { store(n); },
        transaction: (n) => ({ objectStore: () => ({
          getAll: () => permintaan(() => [...store(n).values()].map((v) => structuredClone(v))),
          put: (item) => permintaan(() => { store(n).set(item[kunciPath[n]], structuredClone(item)); }),
          delete: (k) => permintaan(() => { if (k === undefined) throw new Error('DataError: kunci undefined'); store(n).delete(k); }),
          clear: () => permintaan(() => store(n).clear()),
        }) }),
      };
      req.result = db; req.onupgradeneeded && req.onupgradeneeded({}); req.onsuccess && req.onsuccess();
    }, 0);
    return req;
  },
};
let online = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true });
let userSaatIni = 'user-A'; let punyaSesi = true;
let jawaban = () => ({ status: 200, body: { data: {} } }); let panggilan = 0;
globalThis.__sb = { auth: { getSession: async () => ({ data: { session: punyaSesi ? { access_token: 'tok', user: { id: userSaatIni } } : null } }) }, from: () => ({}) };
globalThis.fetch = async () => { panggilan++; const j = jawaban(); if (j.jaringan) throw new TypeError('Failed to fetch'); return { ok: j.status >= 200 && j.status < 300, status: j.status, json: async () => j.body }; };

// ── muat modul dengan api.js ditiru ──
let kode = fs.readFileSync(sumber, 'utf8');
const impor = /import \{ supabase as _supabase, SUPABASE_URL, SUPABASE_ANON_KEY \} from '\.\/api\.js';/;
assert.ok(impor.test(kode), 'baris impor api.js tidak ditemukan; uji perlu disesuaikan');
kode = kode.replace(impor, "const _supabase = globalThis.__sb; const SUPABASE_URL = 'https://x.test'; const SUPABASE_ANON_KEY = 'k';");
const tmp = path.join(os.tmpdir(), `offline-uji-${process.pid}.mjs`); fs.writeFileSync(tmp, kode);
const M = await import(pathToFileURL(tmp).href); fs.rmSync(tmp, { force: true });

let lulus = 0, gagal = 0;
const uji = async (nama, fn) => { gudang.clear(); online = true; userSaatIni = 'user-A'; punyaSesi = true; panggilan = 0; jawaban = () => ({ status: 200, body: { data: {} } });
  try { await fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.message).split('\n')[0]); } };
const antreAbsensi = async (id = 'k1') => { online = false; await M.saveAttendanceBatch({ idempotency_key: id, schedule_id: 's-' + id, session_date: '2026-10-16', records: [] }); online = true; };
const isiStore = () => [...store('att_queue').values()];

await uji('T1 server 500: item DIPERTAHANKAN, tidak dihitung terkirim', async () => {
  await antreAbsensi(); jawaban = () => ({ status: 500, body: { error: { message: 'Terjadi kesalahan pada server' } } });
  const r = await M.flushPending();
  assert.equal(isiStore().length, 1, 'item hilang dari antrean'); assert.equal(r.synced, 0); assert.equal(r.remaining, 1);
});
for (const st of [408, 429, 502, 503, 504]) await uji(`T2 server ${st}: item dipertahankan`, async () => {
  await antreAbsensi(); jawaban = () => ({ status: st, body: {} }); const r = await M.flushPending();
  assert.equal(isiStore().length, 1); assert.equal(r.synced, 0);
});
await uji('T3 jaringan putus: item dipertahankan', async () => {
  await antreAbsensi(); jawaban = () => ({ jaringan: true }); const r = await M.flushPending();
  assert.equal(isiStore().length, 1); assert.equal(r.synced, 0);
});
await uji('T4 penolakan pasti 403: ditahan dan ditandai, tidak dikirim ulang, tidak dihitung terkirim', async () => {
  await antreAbsensi(); jawaban = () => ({ status: 403, body: { error: { message: 'Bukan guru penugas' } } });
  const r = await M.flushPending();
  assert.equal(r.synced, 0, 'ditolak dihitung terkirim'); assert.equal(r.remaining, 0); assert.equal(r.rejected, 1);
  assert.equal(isiStore().length, 1, 'item ditolak dibuang diam-diam'); assert.ok(isiStore()[0]._ditolak, 'tidak ditandai');
  const n = panggilan; await M.flushPending(); assert.equal(panggilan, n, 'item ditolak dikirim ulang');
  assert.equal(await M.pendingCount(), 0); assert.equal(await M.rejectedCount(), 1);
});
await uji('T5 sukses 200: item dihapus dan dihitung terkirim', async () => {
  await antreAbsensi(); const r = await M.flushPending(); assert.equal(isiStore().length, 0); assert.equal(r.synced, 1); assert.equal(r.remaining, 0);
});
await uji('T6 antrean per pengguna: akun B tidak mengirim item akun A; A tetap bisa mengirim kemudian', async () => {
  await antreAbsensi(); userSaatIni = 'user-B'; const n = panggilan; const rb = await M.flushPending();
  assert.equal(panggilan, n, 'item milik A dikirim atas nama B'); assert.equal(isiStore().length, 1, 'item A hilang'); assert.equal(rb.synced, 0);
  assert.equal(await M.pendingCount(), 0, 'B melihat antrean A');
  userSaatIni = 'user-A'; assert.equal(await M.pendingCount(), 1); const ra = await M.flushPending(); assert.equal(ra.synced, 1); assert.equal(isiStore().length, 0);
});
await uji('T7 sesi habis (401): item ditahan dan ditandai sessionExpired', async () => {
  await antreAbsensi(); punyaSesi = false; const r = await M.flushPending();
  assert.equal(r.sessionExpired, true); assert.equal(isiStore().length, 1);
});
await uji('T8 item lama tanpa tanda pemilik tetap terkirim oleh akun mana pun', async () => {
  store('att_queue').set('lama', { idempotency_key: 'lama', schedule_id: 's', session_date: '2026-10-16', records: [] }); userSaatIni = 'user-B';
  const r = await M.flushPending(); assert.equal(r.synced, 1); assert.equal(isiStore().length, 0);
});
await uji('T13 submit awal saat server 500: catatan masuk antrean, tidak hilang (A-02)', async () => {
  jawaban = () => ({ status: 500, body: { error: { message: 'Terjadi kesalahan pada server' } } });
  const r = await M.saveObservation({ idempotency_key: 'o1', student_id: 's1', content: 'isi catatan uji' });
  assert.equal(r.status, 'queued'); assert.equal([...store('obs_queue').values()].length, 1);
});
await uji('T14 submit awal saat server 403: tetap dilaporkan galat, tidak diantre', async () => {
  jawaban = () => ({ status: 403, body: { error: { message: 'ditolak' } } });
  const r = await M.saveObservation({ idempotency_key: 'o2', student_id: 's1', content: 'isi catatan uji' });
  assert.equal(r.status, 'error'); assert.equal([...store('obs_queue').values()].length, 0);
});

await uji('T15 kasus mengantre tampil di daftar milik pembuatnya; akun lain tidak melihat dan tidak bisa menghapusnya', async () => {
  online = false;
  await M.saveCase({ idempotency_key: 'c1', case_id: 'case-1', title: 'Judul uji', track: 'SEKOLAH', _nama_siswa: 'Budi Uji' });
  const a = await M.listQueuedCases();
  assert.equal(a.length, 1); assert.equal(a[0].studentName, 'Budi Uji'); assert.equal(a[0].title, 'Judul uji'); assert.equal(a[0].ditolak, false);
  userSaatIni = 'user-B';
  assert.equal((await M.listQueuedCases()).length, 0, 'akun lain melihat antrean akun A');
  assert.equal(await M.discardQueuedCase('c1'), false, 'akun lain dapat menghapus kasus akun A');
  assert.equal([...store('case_queue').values()].length, 1);
  userSaatIni = 'user-A';
  assert.equal(await M.discardQueuedCase('c1'), true);
  assert.equal([...store('case_queue').values()].length, 0); assert.equal((await M.listQueuedCases()).length, 0);
});
await uji('T16 kasus yang ditolak server tetap tampil (ditandai ditolak, dengan pesan) sampai dihapus dari perangkat', async () => {
  online = false; await M.saveCase({ idempotency_key: 'c2', case_id: 'case-2', title: 'Ditolak', track: 'SEKOLAH', _nama_siswa: 'Siti Uji' });
  online = true; jawaban = () => ({ status: 403, body: { error: { message: 'Bukan guru penugas' } } });
  await M.flushPending();
  const a = await M.listQueuedCases();
  assert.equal(a.length, 1); assert.equal(a[0].ditolak, true); assert.match(a[0].pesan, /Bukan guru penugas/);
  assert.equal(await M.discardQueuedCase('c2'), true); assert.equal((await M.listQueuedCases()).length, 0);
});


console.log(`\nOFFLINE_ANTREAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
