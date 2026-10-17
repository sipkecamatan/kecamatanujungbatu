/**
 * @file guru/js/nilai-pimpinan-ui.js
 * Kartu "Nilai per Tujuan Pembelajaran" untuk Waka Kurikulum dan Kepala Sekolah (keputusan Romo 17 Okt 2026): nilai setiap TP dihitung OTOMATIS dari
 * penilaian sumatif yang sudah diinput guru (tanpa menunggu guru menyimpan rekap), sebagai dasar menyusun kebijakan. Data lewat fn_nilai_per_tp dan
 * fn_nilai_per_tp_siswa (khusus kedua peran itu, dikenali lewat peran ATAU tanda). Pembuatan HTML dipisahkan sebagai fungsi murni agar dapat diuji.
 */
import { getNilaiPerTp, getNilaiPerTpSiswa } from './api.js';

const fmt = (n) => (n === null || n === undefined ? '—' : String(n).replace('.', ','));

/** Tabel ringkasan per TP, dikelompokkan per kelas dan mata pelajaran. rows = hasil fn_nilai_per_tp. */
export function htmlTabelNilaiPerTp(rows, esc) {
    if (!rows?.length) return '<p class="hint">Belum ada Tujuan Pembelajaran pada periode ini.</p>';
    const grup = new Map();
    for (const r of rows) {
        const k = `${r.class_id}|${r.subject_id}|${r.teacher_id}`;
        if (!grup.has(k)) grup.set(k, { kelas: r.class_name, mapel: r.subject_name, guru: r.teacher_name, tp: [] });
        grup.get(k).tp.push(r);
    }
    return [...grup.values()].map((g) => `
        <div style="margin:0 0 14px">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">${esc(g.kelas)} · ${esc(g.mapel)} <span style="font-weight:400;color:var(--color-text-muted)">· ${esc(g.guru)}</span></div>
          <div style="overflow-x:auto"><table class="rc-table" style="width:100%"><thead><tr>
            <th>TP</th><th style="text-align:center">Siswa dinilai</th><th style="text-align:center">Rata-rata</th><th style="text-align:center">Terendah–tertinggi</th><th style="text-align:center">Tercapai</th><th></th></tr></thead><tbody>
          ${g.tp.map((t) => `<tr>
            <td><strong>${esc(t.kode_tp || '?')}</strong> <span style="color:var(--color-text-muted);font-size:12px">${esc(t.deskripsi_tp || '')}</span></td>
            <td style="text-align:center">${t.jumlah_siswa > 0 ? t.jumlah_siswa : '—'}</td>
            <td style="text-align:center">${t.jumlah_siswa > 0 ? fmt(t.rata_rata) : '—'}</td>
            <td style="text-align:center">${t.jumlah_siswa > 0 ? fmt(t.nilai_min) + '–' + fmt(t.nilai_maks) : '—'}</td>
            <td style="text-align:center">${t.jumlah_siswa > 0 ? (t.ada_kktp ? `${t.tercapai} dari ${t.tercapai + t.belum_tercapai}` : '<span title="Belum ada KKTP">tanpa KKTP</span>') : '—'}</td>
            <td>${t.jumlah_siswa > 0 ? `<button type="button" class="pen-btn pen-btn-sm" data-np-detail="${esc(t.tp_id)}">Rincian siswa</button>` : ''}</td></tr>
            <tr data-np-baris="${esc(t.tp_id)}" style="display:none"><td colspan="6"></td></tr>`).join('')}
          </tbody></table></div></div>`).join('');
}

/** Rincian per siswa untuk satu TP. rows = hasil fn_nilai_per_tp_siswa. */
export function htmlDetailSiswa(rows, esc) {
    if (!rows?.length) return '<p class="hint" style="margin:0">Belum ada nilai siswa untuk TP ini.</p>';
    return `<table class="rc-table" style="width:100%"><thead><tr><th>Nama</th><th>NIS</th><th style="text-align:center">Nilai TP</th><th style="text-align:center">Ketercapaian</th></tr></thead><tbody>` +
        rows.map((s) => `<tr><td>${esc(s.nama)}</td><td>${esc(s.nis || '')}</td><td style="text-align:center">${fmt(s.nilai)}</td>` +
            `<td style="text-align:center">${s.tercapai === null || s.tercapai === undefined ? '—' : s.tercapai ? 'Tercapai' : 'Belum'}</td></tr>`).join('') + '</tbody></table>';
}

let _seq = 0;

/** Memasang kartu pada panel tab (sekali). ctx: { esc, tahun, semester, toast } */
export function pasangNilaiPimpinan(panel, ctx) {
    if (!panel || panel.querySelector('#nilai-pimpinan-card')) return;
    const { esc } = ctx;
    const kartu = document.createElement('div');
    kartu.id = 'nilai-pimpinan-card';
    kartu.className = 'section-card';
    kartu.style.marginTop = '12px';
    kartu.innerHTML = `
        <h3 style="margin:0 0 6px">Nilai per Tujuan Pembelajaran</h3>
        <p class="hint" style="margin:0 0 10px;font-size:12px">Dihitung otomatis dari penilaian <strong>sumatif</strong> yang sudah diinput guru, tanpa menunggu guru menyimpan rekap. Ketercapaian memakai batas KKTP tiap TP.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <label style="font-size:12px;font-weight:normal">Tahun ajaran <input type="text" id="np-tahun" class="input" style="width:110px" value="${esc(ctx.tahun || '')}"></label>
          <label style="font-size:12px;font-weight:normal">Semester <select id="np-semester" class="input"><option value="">Semua</option><option value="1"${String(ctx.semester) === '1' ? ' selected' : ''}>1</option><option value="2"${String(ctx.semester) === '2' ? ' selected' : ''}>2</option></select></label>
          <button type="button" class="btn btn-primary btn-sm" id="np-muat">Tampilkan</button>
        </div>
        <div id="np-hasil"></div>`;
    (panel.querySelector('.page-body') || panel).appendChild(kartu);   // di dalam kolom isi (lebar dan tengah sama dengan kartu lain)
    const hasil = kartu.querySelector('#np-hasil');

    kartu.querySelector('#np-muat').addEventListener('click', async (e) => {
        const seq = ++_seq;
        const tahun = kartu.querySelector('#np-tahun').value.trim() || null;
        const sem = kartu.querySelector('#np-semester').value;
        e.target.disabled = true;
        hasil.innerHTML = '<p class="hint">Memuat…</p>';
        try {
            const rows = await getNilaiPerTp(tahun, sem ? Number(sem) : null);
            if (seq !== _seq) return;
            hasil.innerHTML = htmlTabelNilaiPerTp(rows, esc);
        } catch (err) {
            if (seq !== _seq) return;
            hasil.innerHTML = `<p class="status-err">Gagal memuat nilai per TP. ${esc(err.message || '')}</p>`;
        } finally { e.target.disabled = false; }
    });

    hasil.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-np-detail]');
        if (!btn) return;
        const tpId = btn.dataset.npDetail;
        const baris = hasil.querySelector(`tr[data-np-baris="${CSS.escape(tpId)}"]`);
        if (!baris) return;
        if (baris.style.display !== 'none') { baris.style.display = 'none'; btn.textContent = 'Rincian siswa'; return; }
        const sel = baris.firstElementChild;
        baris.style.display = '';
        sel.innerHTML = '<span class="hint">Memuat…</span>';
        btn.textContent = 'Tutup';
        try {
            sel.innerHTML = htmlDetailSiswa(await getNilaiPerTpSiswa(tpId), esc);
        } catch (err) {
            sel.innerHTML = `<span class="status-err">Gagal memuat rincian. ${esc(err.message || '')}</span>`;
        }
    });
}
