/**
 * @file guru/js/nilai-rapor-kelas-ui.js
 * Kartu "Nilai Rapor Kelas" (hanya baca) untuk wali kelas, Kepala Sekolah, dan Waka Kurikulum. Nilai rapor DIINPUT guru mata pelajaran
 * (nilai-rapor-ui.js); wali kelas hanya memeriksa dan mencetak, pimpinan mengawasi kelengkapan. Tabel: baris = siswa kelas, kolom = mata pelajaran,
 * sel kosong "—" = guru mapel itu belum mengisi. Hak baca ditegakkan basis data (rls_grade_final_select_wali / _pimpinan); layar ini hanya menampilkan.
 * Pembuatan tabel dipisahkan sebagai fungsi murni agar dapat diuji.
 */
import { getKelasSekolah, getStudentsForClass, getGradeFinalKelas } from './api.js';

const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : String(Number(n)).replace('.', ','));

/**
 * Menyusun matriks siswa x mapel. siswa: [{id, nama, nis}], rows: baris grade_final (+ subject {name}, teacher {full_name}).
 * Bila satu mapel diisi lebih dari satu guru untuk siswa yang sama, dipakai baris yang paling baru diperbarui.
 */
export function susunMatriks(siswa, rows) {
    const mapel = new Map();
    const nilai = new Map();          // `${student}|${subject}` -> baris terbaru
    for (const r of rows ?? []) {
        if (!mapel.has(r.subject_id)) mapel.set(r.subject_id, { id: r.subject_id, nama: r.subject?.name || 'Mapel', guru: new Set() });
        if (r.teacher?.full_name) mapel.get(r.subject_id).guru.add(r.teacher.full_name);
        const k = `${r.student_id}|${r.subject_id}`;
        const lama = nilai.get(k);
        if (!lama || String(r.updated_at ?? '') > String(lama.updated_at ?? '')) nilai.set(k, r);
    }
    const kolom = [...mapel.values()].sort((a, b) => a.nama.localeCompare(b.nama, 'id')).map((m) => ({ ...m, guru: [...m.guru].join(', ') }));
    const baris = (siswa ?? []).map((s) => {
        const sel = {};
        let terisi = 0;
        for (const m of kolom) {
            const r = nilai.get(`${s.id}|${m.id}`);
            sel[m.id] = r ? Number(r.nilai_rapor) : null;
            if (r) terisi++;
        }
        return { id: s.id, nama: s.nama, nis: s.nis, sel, terisi };
    });
    return { kolom, baris };
}

/** Tabel HTML dari matriks. */
export function htmlMatriks(m, esc) {
    if (!m.baris.length) return '<p class="hint">Belum ada siswa terdaftar di kelas ini pada periode ini.</p>';
    if (!m.kolom.length) return '<p class="hint">Belum ada nilai rapor yang disimpan guru mata pelajaran untuk kelas ini pada periode ini.</p>';
    return `<div style="overflow-x:auto"><table class="rc-table" style="width:100%"><thead><tr><th>Nama</th><th>NIS</th>` +
        m.kolom.map((k) => `<th style="text-align:center" title="${esc(k.guru)}">${esc(k.nama)}</th>`).join('') +
        `<th style="text-align:center">Terisi</th></tr></thead><tbody>` +
        m.baris.map((b) => `<tr><td>${esc(b.nama)}</td><td>${esc(b.nis || '')}</td>` +
            m.kolom.map((k) => `<td style="text-align:center">${b.sel[k.id] === null ? '<span style="color:var(--color-text-muted)">—</span>' : fmt(b.sel[k.id])}</td>`).join('') +
            `<td style="text-align:center">${b.terisi}/${m.kolom.length}</td></tr>`).join('') +
        '</tbody></table></div>';
}

/** Baris untuk lembar Excel (header + data). */
export function barisExcel(m) {
    return [['Nama', 'NIS', ...m.kolom.map((k) => k.nama)],
        ...m.baris.map((b) => [b.nama, b.nis || '', ...m.kolom.map((k) => (b.sel[k.id] === null ? '' : b.sel[k.id]))])];
}

let _seq = 0;

/**
 * Memasang kartu pada kolom isi sebuah tab (sekali).
 * ctx: { esc, mode: 'wali' | 'pimpinan', classId (wali), className (wali), tahun, semester }
 */
export function pasangNilaiRaporKelas(panel, ctx) {
    const host = panel?.querySelector?.('.page-body') || panel;
    if (!host || panel.querySelector('#nilai-rapor-kelas-card')) return;
    const { esc } = ctx;
    const wali = ctx.mode === 'wali';
    const kartu = document.createElement('div');
    kartu.id = 'nilai-rapor-kelas-card';
    kartu.className = 'section-card';
    kartu.style.marginTop = '12px';
    kartu.innerHTML = `
        <h3 style="margin:0 0 6px">Nilai Rapor Kelas${wali && ctx.className ? ' — ' + esc(ctx.className) : ''}</h3>
        <p class="hint" style="margin:0 0 10px;font-size:12px">Nilai rapor diinput oleh guru mata pelajaran. ${wali ? 'Anda memeriksa dan mencetak.' : 'Anda mengawasi kelengkapannya.'} Tanda "—" berarti guru mata pelajaran itu belum menyimpan nilai rapor.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          ${wali ? '' : '<label style="font-size:12px;font-weight:normal">Kelas <select id="nrk-kelas" class="input"><option value="">— Pilih Kelas —</option></select></label>'}
          <label style="font-size:12px;font-weight:normal">Tahun ajaran <input type="text" id="nrk-tahun" class="input" style="width:110px" value="${esc(ctx.tahun || '')}"></label>
          <label style="font-size:12px;font-weight:normal">Semester <select id="nrk-semester" class="input"><option value="1"${String(ctx.semester) !== '2' ? ' selected' : ''}>1</option><option value="2"${String(ctx.semester) === '2' ? ' selected' : ''}>2</option></select></label>
          <button type="button" class="btn btn-primary btn-sm" id="nrk-muat">Tampilkan</button>
          <button type="button" class="btn btn-secondary btn-sm" id="nrk-excel" style="display:none">Unduh Excel</button>
          <button type="button" class="btn btn-secondary btn-sm" id="nrk-cetak" style="display:none">Cetak</button>
        </div>
        <div id="nrk-hasil"></div>`;
    host.appendChild(kartu);
    const q = (s) => kartu.querySelector(s);
    const hasil = q('#nrk-hasil');
    let matriks = null, judul = '';

    if (!wali) {
        getKelasSekolah().then((list) => {
            const sel = q('#nrk-kelas');
            for (const c of list) { const o = document.createElement('option'); o.value = c.class_id; o.textContent = c.name; sel.appendChild(o); }
        }).catch(() => { hasil.innerHTML = '<p class="status-err">Gagal memuat daftar kelas.</p>'; });
    }

    const muat = async (e) => {
        const classId = wali ? ctx.classId : q('#nrk-kelas').value;
        if (!classId) { hasil.innerHTML = '<p class="hint">Pilih kelas terlebih dahulu.</p>'; return; }
        const tahun = q('#nrk-tahun').value.trim(), sem = q('#nrk-semester').value;
        if (!tahun) { hasil.innerHTML = '<p class="hint">Isi tahun ajaran terlebih dahulu.</p>'; return; }
        const seq = ++_seq;
        const tombol = e?.target; if (tombol) tombol.disabled = true;
        hasil.innerHTML = '<p class="hint">Memuat…</p>';
        try {
            const [siswa, rows] = await Promise.all([getStudentsForClass(classId, tahun, sem), getGradeFinalKelas(classId, tahun, sem)]);
            if (seq !== _seq) return;
            matriks = susunMatriks(siswa, rows);
            judul = `${wali ? ctx.className : (q('#nrk-kelas').selectedOptions?.[0]?.textContent || '')} · ${tahun} · Semester ${sem}`;
            hasil.innerHTML = htmlMatriks(matriks, esc);
            const ada = matriks.baris.length > 0 && matriks.kolom.length > 0;
            q('#nrk-excel').style.display = ada ? '' : 'none';
            q('#nrk-cetak').style.display = ada ? '' : 'none';
        } catch (err) {
            if (seq !== _seq) return;
            matriks = null;
            hasil.innerHTML = `<p class="status-err">Gagal memuat nilai rapor kelas. ${esc(err.message || '')}</p>`;
        } finally { if (tombol) tombol.disabled = false; }
    };
    q('#nrk-muat').addEventListener('click', muat);

    q('#nrk-excel').addEventListener('click', () => {
        const X = globalThis.XLSX;
        if (!X) { alert('Library Excel belum dimuat. Muat ulang halaman.'); return; }
        if (!matriks) return;
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(barisExcel(matriks)), 'Nilai Rapor');
        X.writeFile(wb, `nilai_rapor_${judul.replace(/[^\w.-]+/g, '_')}.xlsx`);
    });

    q('#nrk-cetak').addEventListener('click', () => {
        if (!matriks) return;
        const w = globalThis.open('', '_blank');
        if (!w) { alert('Jendela cetak diblokir peramban. Izinkan pop-up untuk situs ini.'); return; }
        w.document.write(`<!doctype html><meta charset="utf-8"><title>Nilai Rapor ${esc(judul)}</title>` +
            '<style>body{font:12px Arial,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:4px 6px}th{background:#eee}</style>' +
            `<h3>Nilai Rapor — ${esc(judul)}</h3>` + htmlMatriks(matriks, esc));
        w.document.close(); w.focus(); w.print();
    });

    if (wali && ctx.classId) muat();   // wali kelas: langsung tampil untuk kelasnya
}
