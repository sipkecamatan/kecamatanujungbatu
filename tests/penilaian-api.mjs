// Uji lapisan API penilaian portal guru (guru/js/api.js): roster per periode tanpa duplikat dan dengan NIS (A-01, A-10), hasil asesmen/rekap
// dipaginasi melewati batas 1000 baris PostgREST (A-11), serta penghapusan hasil/rekap yang dikosongkan atau basi (A-04, A-05).
// Klien Supabase DITIRU dalam memori (mesin kueri mini yang meniru PostgREST: filter eq/is/in, order, range, batas 1000 baris, delete),
// jadi tidak butuh jaringan atau basis data. Kode api.js yang diuji adalah berkas asli.
// Pakai: node tests/penilaian-api.mjs [berkas-api.js]   (kontrol negatif: berikan versi lama dari git)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = process.env.SIP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sumber = process.argv[2] || path.join(ROOT, 'guru', 'js', 'api.js');

// ── Mesin kueri mini ──
let db = {};
let catatan = [];   // jejak filter terakhir tiap kueri (untuk memeriksa bahwa filter yang diharapkan benar-benar dikirim)
class Kueri {
  constructor(tabel) { this.t = tabel; this.f = []; this.op = 'select'; this.ord = []; this.rng = null; this.jejak = { tabel, filter: [] }; catatan.push(this.jejak); }
  select() { return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.f.push((r) => String(r[k]) === String(v)); this.jejak.filter.push(['eq', k, v]); return this; }
  is(k, v) { this.f.push((r) => (r[k] ?? null) === v); this.jejak.filter.push(['is', k, v]); return this; }
  in(k, arr) { this.f.push((r) => arr.includes(r[k])); this.jejak.filter.push(['in', k]); return this; }
  order(k) { this.ord.push(k); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  then(res, rej) { return Promise.resolve(this.jalan()).then(res, rej); }
  jalan() {
    const semua = db[this.t] ?? [];
    if (this.op === 'delete') {
      const sisa = semua.filter((r) => !this.f.every((fn) => fn(r)));
      db[this.t] = sisa;
      return { data: null, error: null };
    }
    let baris = semua.filter((r) => this.f.every((fn) => fn(r)));
    for (const k of [...this.ord].reverse()) baris = [...baris].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0));
    const [a, b] = this.rng ?? [0, 999];          // PostgREST: tanpa range, respons dipotong 1000 baris
    return { data: baris.slice(a, Math.min(b, a + 999) + 1).map((r) => structuredClone(r)), error: null };
  }
}
globalThis.__sb = { from: (t) => new Kueri(t), auth: {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

// ── Muat api.js dengan klien ditiru; offline.js dan impor jaringan dilewati ──
let kode = fs.readFileSync(sumber, 'utf8');
kode = kode.replace(/import \{ createClient \} from 'https:\/\/esm\.sh\/@supabase\/supabase-js@2';/, 'const createClient = () => globalThis.__sb;');
kode = kode.replace(/import \{[^}]*\} from '\.\/offline\.js';/, 'const saveObservation = async () => ({}), saveJournalEntry = async () => ({}), saveCase = async () => ({}), deleteJournalEntryOffline = async () => ({});');
const tmp = path.join(os.tmpdir(), `api-uji-${process.pid}.mjs`); fs.writeFileSync(tmp, kode);
const M = await import(pathToFileURL(tmp).href); fs.rmSync(tmp, { force: true });

let lulus = 0, gagal = 0;
const uji = async (nama, fn) => {
  db = {}; catatan = [];
  try { await fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.message).split('\n')[0]); }
};
const enr = (id, sid, cls, yr, sem, wd = null) => ({ enrollment_id: id, student_id: sid, class_id: cls, academic_year: yr, semester: sem, withdrawn_at: wd,
  students: { student_id: sid, nis: 'N' + sid, full_name: 'Siswa ' + sid, student_status: 'AKTIF' } });

await uji('A-01/A-10 roster: satu siswa muncul sekali walau punya pendaftaran Semester 1 dan 2; NIS ikut terbawa', async () => {
  db.class_enrollments = [enr(1, 'a', 'C', '2026/2027', '1'), enr(2, 'a', 'C', '2026/2027', '2'), enr(3, 'b', 'C', '2026/2027', '2')];
  const r = await M.getStudentsForClass('C', '2026/2027', '2');
  assert.deepEqual(r.map((s) => s.id), ['a', 'b']);
  assert.equal(r[0].nis, 'Na', 'NIS tidak terbawa (A-10)');
  const semua = await M.getStudentsForClass('C');   // tanpa periode: tetap tanpa duplikat
  assert.deepEqual(semua.map((s) => s.id), ['a', 'b']);
});
await uji('A-01 roster: pendaftaran tahun/semester lain dan yang sudah ditarik tidak ikut', async () => {
  db.class_enrollments = [enr(1, 'a', 'C', '2025/2026', '2'), enr(2, 'b', 'C', '2026/2027', '1'), enr(3, 'c', 'C', '2026/2027', '2', '2026-09-01'), enr(4, 'd', 'C', '2026/2027', '2'),
    { ...enr(5, 'e', 'C', '2026/2027', '2'), students: { student_id: 'e', nis: 'Ne', full_name: 'Keluar', student_status: 'KELUAR' } }];
  const r = await M.getStudentsForClass('C', '2026/2027', '2');
  assert.deepEqual(r.map((s) => s.id), ['d']);
});
await uji('A-11 hasil asesmen untuk banyak asesmen dipaginasi: 2.500 baris tidak terpotong di 1.000', async () => {
  db.assessment_results = Array.from({ length: 2500 }, (_, i) => ({ assessment_id: 'A' + (i % 50), student_id: 's' + String(i).padStart(4, '0'), school_id: 'S', nilai: 80 }));
  const r = await M.getResultsForAssessments(Array.from({ length: 50 }, (_, i) => 'A' + i), 'S');
  assert.equal(r.length, 2500);
  assert.equal(new Set(r.map((x) => x.assessment_id + x.student_id)).size, 2500, 'ada baris ganda/terlewat antar halaman');
});
await uji('A-11 rekap kelas untuk ekspor dipaginasi', async () => {
  db.grade_recap = Array.from({ length: 1500 }, (_, i) => ({ id: i, student_id: 's' + i, learning_objective_id: 'T', class_id: 'C', school_id: 'S', academic_year: '2026/2027', semester: 1, nilai_akhir: 70 }));
  assert.equal((await M.getGradeRecapRows('S', 'C', 1, '2026/2027')).length, 1500);
  assert.equal((await M.getGradeRecap('S', 'C', 1, '2026/2027')).length, 1500);
});
await uji('A-04 menghapus hasil satu siswa pada satu asesmen saja', async () => {
  db.assessment_results = [{ assessment_id: 'X', student_id: 's1', nilai: 90 }, { assessment_id: 'X', student_id: 's2', nilai: 80 }, { assessment_id: 'Y', student_id: 's1', nilai: 70 }];
  await M.deleteAssessmentResult('X', 's1');
  assert.deepEqual(db.assessment_results.map((r) => r.assessment_id + r.student_id).sort(), ['Xs2', 'Ys1']);
});
await uji('A-05 menghapus rekap siswa tanpa nilai pada satu TP/kelas/periode saja', async () => {
  const b = (sid, tp, cls = 'C', sem = 1) => ({ school_id: 'S', class_id: cls, student_id: sid, learning_objective_id: tp, semester: sem, academic_year: '2026/2027' });
  db.grade_recap = [b('s1', 'T1'), b('s2', 'T1'), b('s1', 'T2'), b('s1', 'T1', 'C2'), b('s1', 'T1', 'C', 2)];
  await M.deleteGradeRecapForStudents('S', 'C', 'T1', 1, '2026/2027', ['s1']);
  assert.equal(db.grade_recap.length, 4); assert.ok(!db.grade_recap.some((r) => r.student_id === 's1' && r.learning_objective_id === 'T1' && r.class_id === 'C' && r.semester === 1));
  await M.deleteGradeRecapForStudents('S', 'C', 'T1', 1, '2026/2027', []);   // daftar kosong = tidak menghapus apa pun
  assert.equal(db.grade_recap.length, 4);
});
await uji('A-05 menghapus seluruh rekap satu TP (asesmen sumatif dihapus) tanpa menyentuh TP/kelas/semester lain', async () => {
  const b = (sid, tp, cls = 'C', sem = 1) => ({ school_id: 'S', class_id: cls, student_id: sid, learning_objective_id: tp, semester: sem, academic_year: '2026/2027' });
  db.grade_recap = [b('s1', 'T1'), b('s2', 'T1'), b('s1', 'T2'), b('s1', 'T1', 'C2'), b('s1', 'T1', 'C', 2)];
  await M.deleteGradeRecapForTp('S', 'C', 'T1', 1, '2026/2027');
  assert.equal(db.grade_recap.length, 3); assert.ok(db.grade_recap.every((r) => !(r.learning_objective_id === 'T1' && r.class_id === 'C' && r.semester === 1)));
});
await uji('A-09 ekspor satu mapel: rekap TP mapel lain pada kelas yang sama tidak ikut', async () => {
  const rekap = [
    { student_id: 's1', learning_objective_id: 'TP-MTK-1', nilai_akhir: 80 },
    { student_id: 's1', learning_objective_id: 'TP-IND-1', nilai_akhir: 90 },   // mapel lain milik guru yang sama
    { student_id: 's2', learning_objective_id: 'TP-IND-2', nilai_akhir: 70 },
    { student_id: 's2', learning_objective_id: 'TP-MTK-2', nilai_akhir: 60 },
  ];
  const r = M.rekapUntukMapel(rekap, ['TP-MTK-1', 'TP-MTK-2']);
  assert.deepEqual(r.map((x) => x.learning_objective_id), ['TP-MTK-1', 'TP-MTK-2']);
  assert.deepEqual(M.rekapUntukMapel(rekap, []), [], 'tanpa daftar TP mapel, tidak ada rekap yang dapat dipastikan miliknya');
  assert.deepEqual(M.rekapUntukMapel(null, ['x']), []);
});


console.log(`\nPENILAIAN_API: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
