// Uji logika murni Excel REKAP (guru/js/rekap-excel.js) — model pivot: kolom=penilaian, baris=siswa.
// Tiga baris header: judul penilaian, keterangan, No/Nama/NIS + sub-kolom.
// Sub-kolom: Sumatif→Nilai/Predikat/TL; DiagK→Nilai/Predikat; beraspek→per aspek; lainnya→Hasil.
// Keputusan Romo 23 Okt 2026 (model pivot diputuskan sesi lanjutan).
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, 'guru', 'js', p)).href);
const X = await imp('rekap-excel.js');
const L = await imp('penilaian-label.js');
const N = await imp('nilai-rapor.js');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => { try { fn(); lulus++; console.log('  LULUS  ' + nama); } catch (e) { gagal++; console.log('  GAGAL  ' + nama + '\n         ' + String(e.message).slice(0, 400)); } };

const roster = [{ id: 's1', nama: 'Adelia', nis: '0012' }, { id: 's2', nama: 'Budi', nis: '0013' }, { id: 's3', nama: 'Citra', nis: '0014' }];
const tpById = { t7: { kode_tp: 'TP7', deskripsi_tp: 'Fungsi aplikasi' }, t8: { kode_tp: 'TP8', deskripsi_tp: 'Data master' }, t9: { kode_tp: 'TP9', deskripsi_tp: 'Transaksi' } };
const dasar = { tanggal: '2026-10-19', tujuan: '', refleksi_guru: null, konten: null, tpIds: [] };
const A = (o) => ({ ...dasar, ...o });

// Penilaian uji
const asmtSumatifTes  = A({ id: 'a1', jenis: 'SUMATIF',      teknik: 'TES',         instrumen: 'PG',     judul: 'UH 1',    tpIds: ['t7'], tujuan: 'Menguji TP7' });
const asmtSumatifProj = A({ id: 'a2', jenis: 'SUMATIF',      teknik: 'PROYEK',      instrumen: 'Rubrik', judul: 'Proyek',  tpIds: ['t9', 't7', 't8'] });
const asmtDiagK       = A({ id: 'a3', jenis: 'DIAGNOSTIK_K', teknik: 'TES',         instrumen: 'Uraian', konten: { deskriptor: [{ label: 'Paham', siswa: ['s3'] }, { label: 'Belum', siswa: ['s2'] }] } });
const asmtObs         = A({ id: 'a4', jenis: 'FORMATIF',     teknik: 'OBSERVASI',   instrumen: 'Lembar Observasi', konten: { aspeks: [{ nama: 'Kesiapan', indikator: 'Menyalakan', terlihat_jelas: ['s1'], terlihat: ['s2'], belum_terlihat: [] }, { nama: 'Kerapian', terlihat_jelas: [], terlihat: [], belum_terlihat: ['s3'] }] } });
const asmtChecklist   = A({ id: 'a5', jenis: 'FORMATIF',     teknik: 'PORTOFOLIO',  instrumen: 'Checklist', konten: { items: [{ nama: 'Jurnal', siswa: ['s1'] }, { nama: 'Buku besar', siswa: ['s1', 's2'] }] } });
const asmtKosong      = A({ id: 'a6', jenis: 'FORMATIF',     teknik: 'UNJUK_KERJA', instrumen: 'Rubrik', konten: null });

const hasil = {
    a1: { s1: { nilai: 92, status: 'SB', tindak_lanjut: 'PENGAYAAN' }, s2: { nilai: 55, status: 'BB', tindak_lanjut: null } },
    a2: { s1: { nilai: 93, status: 'SB', tindak_lanjut: null }, s3: { nilai: 27, status: 'BB', tindak_lanjut: 'PENDAMPINGAN' } },
    a3: {},   // diagnostik K: data dari konten, bukan hasil angka
};

// Helper: ambil nilai sel pada baris siswa berdasarkan offset sub-kolom
// rows[0]=judul, rows[1]=ket, rows[2]=sub-header, rows[3+]=siswa
const { rows: R, merges: M } = X.susunLembarRekap({ asmts: [asmtSumatifTes, asmtSumatifProj, asmtDiagK, asmtObs, asmtChecklist, asmtKosong], roster, hasil, tpById });
const subH = R[2];   // baris sub-header
const siswaRows = R.slice(3);

const colOf = (label, dari = 3) => subH.indexOf(label, dari);   // offset kolom sub-header
const selSiswa = (namaS, kolLabel) => siswaRows.find((r) => r[1] === namaS)?.[colOf(kolLabel)];

uji('tiga baris header; baris pertama berisi judul penilaian; baris ketiga berisi No/Nama/NIS lalu sub-kolom', () => {
    assert.equal(R[0][3], 'UH 1');
    assert.equal(R[1][3], 'Sumatif · TES TERTULIS · TP7 · Menguji TP7');
    assert.deepEqual(R[2].slice(0, 3), ['No', 'Nama', 'NIS']);
});

uji('Sumatif: tiga sub-kolom Nilai/Predikat/Tindak Lanjut', () => {
    const i = subH.indexOf('Nilai');
    assert.equal(subH[i], 'Nilai'); assert.equal(subH[i + 1], 'Predikat'); assert.equal(subH[i + 2], 'Tindak Lanjut');
});

uji('Diagnostik Kognitif: dua sub-kolom Nilai/Predikat (tanpa Tindak Lanjut)', () => {
    // DiagK kolom dimulai setelah 2 sumatif (3+3=6 sub-kolom) + No/Nama/NIS
    const start = 3 + 3 + 3;   // No/Nama/NIS + UH1(3) + Proyek(3)
    assert.equal(subH[start], 'Nilai'); assert.equal(subH[start + 1], 'Predikat');
    assert.equal(subH[start + 2], 'Kesiapan', 'kolom ke-3 dari DiagK harusnya aspek Obs, bukan TL');
});

uji('Observasi beraspek: satu sub-kolom per aspek', () => {
    assert.ok(subH.includes('Kesiapan') && subH.includes('Kerapian'));
});

uji('Penilaian lainnya (checklist, kosong): satu sub-kolom Hasil', () => {
    const hasilCols = subH.map((v, i) => [v, i]).filter(([v]) => v === 'Hasil');
    assert.equal(hasilCols.length, 2, 'harus ada 2 kolom Hasil (checklist + kosong)');
});

uji('baris siswa: nomor urut dari 1, nama, NIS; diurutkan A-Z', () => {
    assert.deepEqual(siswaRows.map((r) => r[1]), ['Adelia', 'Budi', 'Citra']);
    assert.deepEqual(siswaRows.map((r) => r[0]), [1, 2, 3]);
    assert.equal(siswaRows[0][2], '0012');
});

uji('baris diurutkan A-Z meski roster masuk urutan acak', () => {
    const rAcak = [{ id: 's3', nama: 'Citra', nis: '0014' }, { id: 's1', nama: 'Adelia', nis: '0012' }, { id: 's2', nama: 'Budi', nis: '0013' }];
    const { rows } = X.susunLembarRekap({ asmts: [asmtSumatifTes], roster: rAcak, hasil, tpById });
    assert.deepEqual(rows.slice(3).map((r) => r[1]), ['Adelia', 'Budi', 'Citra']);
});

uji('nilai sumatif: ada bila ada, kosong bila tidak ada; predikat dan TL ikut', () => {
    assert.equal(selSiswa('Adelia', 'Nilai'), 92);
    assert.equal(selSiswa('Adelia', 'Predikat'), 'SB');
    assert.equal(selSiswa('Adelia', 'Tindak Lanjut'), 'PENGAYAAN');
    assert.equal(selSiswa('Citra', 'Nilai'), '', 'Citra tidak punya hasil UH1');
    assert.equal(selSiswa('Citra', 'Tindak Lanjut'), '');
});

uji('nilai Proyek: Citra ada (27/BB/PENDAMPINGAN), Budi kosong', () => {
    const iProj = subH.indexOf('Nilai', 3 + 3);   // Proyek mulai setelah UH1(3 sub-kol)
    const row = (nama) => siswaRows.find((r) => r[1] === nama);
    assert.equal(row('Citra')[iProj], 27);
    assert.equal(row('Citra')[iProj + 1], 'BB');
    assert.equal(row('Citra')[iProj + 2], 'PENDAMPINGAN');
    assert.equal(row('Budi')[iProj], '');
});

uji('observasi beraspek: label keterlihatan per aspek per siswa', () => {
    const iKes = subH.indexOf('Kesiapan');
    const iKer = subH.indexOf('Kerapian');
    const row = (nama) => siswaRows.find((r) => r[1] === nama);
    assert.equal(row('Adelia')[iKes], 'Terlihat Jelas');
    assert.equal(row('Budi')[iKes], 'Terlihat');
    assert.equal(row('Citra')[iKes], '');
    assert.equal(row('Citra')[iKer], 'Belum Terlihat');
    assert.equal(row('Adelia')[iKer], '');
});

uji('penilaian tanpa data: kolom Hasil kosong untuk semua siswa', () => {
    const iHasil = subH.lastIndexOf('Hasil');   // penilaian kosong = kolom Hasil terakhir
    assert.ok(siswaRows.every((r) => r[iHasil] === ''));
});

uji('merges: No/Nama/NIS di-merge 3 baris; penilaian multi-sub-kol di-merge baris 0 dan 1', () => {
    // No/Nama/NIS: merge r0c0..r2c0, r0c1..r2c1, r0c2..r2c2
    for (let c = 0; c < 3; c++) {
        const m = M.find((x) => x.s.r === 0 && x.s.c === c);
        assert.ok(m && m.e.r === 2 && m.e.c === c, 'merge No/Nama/NIS col ' + c);
    }
    // UH 1 (3 sub-kol): merge r0c3..r0c5 dan r1c3..r1c5
    const mJudul = M.find((x) => x.s.r === 0 && x.s.c === 3);
    assert.ok(mJudul && mJudul.e.c === 5, 'merge judul UH1');
    const mKet = M.find((x) => x.s.r === 1 && x.s.c === 3);
    assert.ok(mKet && mKet.e.c === 5, 'merge keterangan UH1');
});

uji('penilaian dengan 1 sub-kolom tidak menghasilkan merge (tidak perlu)', () => {
    const { rows, merges } = X.susunLembarRekap({ asmts: [asmtChecklist], roster, tpById });
    assert.ok(!merges.some((m) => m.s.r === 0 && m.s.c === 3), 'tidak ada merge judul untuk 1 sub-kol');
});

uji('susunCatatanRekap menyebut cakupan, jumlah, dan pengingat Pelaksanaan', () => {
    const c = X.susunCatatanRekap({ jenis: 'SUMATIF', teknik: 'TES_LISAN', tpKode: 'TP7', jumlahPenilaian: 2, jumlahSiswa: 32, waktu: 'W' });
    const teks = JSON.stringify(c);
    for (const x of ['Sumatif', 'TES LISAN', 'TP7', '"Jumlah penilaian",2', '"Jumlah siswa",32', 'hanya dapat diubah di bagian Pelaksanaan', 'Nilai rapor tidak ada di berkas ini']) assert.ok(teks.includes(x), x);
});

uji('namaBerkasRekap menyebut cakupan; karakter terlarang diganti', () => {
    assert.equal(X.namaBerkasRekap({ mapel: 'Komputerisasi Akuntansi', kelas: 'XI AKL 2', jenis: 'SUMATIF', teknik: 'TES_LISAN', tpKode: 'TP7' }), 'Komputerisasi_Akuntansi_XI_AKL_2_Rekap_Sumatif_TES_LISAN_TP7.xlsx');
    assert.equal(X.namaBerkasRekap({ mapel: 'A/B:C', kelas: 'X', jenis: 'FORMATIF' }), 'A_B_C_X_Rekap_Formatif.xlsx');
});

uji('ekspor Rekap di penilaian.js: memakai susunLembarRekap (pivot), ws1.merges, tidak ada HEADER_REKAP/e-Rapor/getGradeFinal', () => {
    const s = src('guru/js/penilaian.js');
    const ekspor = s.slice(s.indexOf('async function downloadPenilaianExcel'), s.indexOf('// ── Collapse helpers'));
    assert.ok(!/HEADER_REKAP/.test(s), 'HEADER_REKAP masih diimpor');
    assert.ok(!/e-Rapor|susunLembarERapor|getGradeFinal/.test(ekspor), 'ekspor Rekap masih memuat lembar/nilai rapor');
    assert.ok(/ws1\['!merges'\]/.test(ekspor), 'merges belum dipasang ke worksheet');
    assert.ok(/susunLembarRekap/.test(ekspor) && /{ rows, merges }/.test(ekspor));
});

uji('Excel Nilai Rapor: status penyimpanan jelas dan dicatat di lembar Catatan', () => {
    assert.deepEqual(N.statusSimpanRapor({}), { aman: true, teks: 'Semua angka pada berkas ini sudah tersimpan.' });
    const a = N.statusSimpanRapor({ belumSimpan: 2 }); assert.equal(a.aman, false); assert.match(a.teks, /^PERHATIAN: 2 siswa belum disimpan\. Angka pada berkas ini sama dengan layar.*BUKAN yang tersimpan/);
    assert.match(N.statusSimpanRapor({ rumusBelumSimpan: true }).teks, /rumus diubah di Rekap dan belum disimpan/);
    const c = JSON.stringify(N.susunCatatanRapor({ metode: 'BOBOT', status: a, waktu: 'W' }));
    for (const x of ['Pembobotan per penilaian sumatif', '"Diunduh","W"', 'Status penyimpanan', 'PERHATIAN', 'BERKAS KERJA', 'BELUM dicocokkan']) assert.ok(c.includes(x), x);
});

console.log(`\nREKAP_EXCEL: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
