/**
 * @file guru/js/kunci-periode-ui.js
 * Kartu "Kunci Nilai Semester" untuk Kepala Sekolah dan Waka Kurikulum (B-07).
 * Setelah admin menutup semester, guru tidak dapat mengubah nilai. Di sini pimpinan membuka kunci SATU kelas dengan alasan tertulis (tercatat),
 * dan menguncinya kembali. Aturan ditegakkan server (migrasi 20261018120000); kartu ini hanya mengirim perintah dan menampilkan status.
 */
import { getKelasSekolah, getGradePeriodStatus, unlockGradePeriod, relockGradePeriod } from './api.js';

/** Teks status untuk satu keadaan periode (logika murni; diuji tanpa peramban). */
export function ringkasStatusKunci(s) {
    if (!s || !s.closed) return { kode: 'AKTIF', teks: 'Semester ini belum ditutup admin sekolah; guru dapat mengubah nilai seperti biasa.', bisaBuka: false, bisaKunci: false };
    if (s.unlocked) return { kode: 'DIBUKA', teks: 'Terbuka untuk koreksi', bisaBuka: false, bisaKunci: true };
    return { kode: 'TERKUNCI', teks: 'Terkunci: semester sudah ditutup, guru tidak dapat mengubah nilai kelas ini.', bisaBuka: true, bisaKunci: false };
}

/** ctx: { esc, tahun, semester }. Dipasang sekali pada kolom isi sebuah tab. */
export function pasangKunciPeriode(panel, ctx) {
    const host = panel?.querySelector?.('.page-body') || panel;
    if (!host || panel.querySelector('#kunci-periode-card')) return;
    const { esc } = ctx;
    const kartu = document.createElement('div');
    kartu.id = 'kunci-periode-card';
    kartu.className = 'section-card';
    kartu.style.marginTop = '12px';
    kartu.innerHTML = `
        <h3 style="margin:0 0 6px">Kunci Nilai Semester</h3>
        <p class="hint" style="margin:0 0 10px;font-size:12px">Setelah admin sekolah menutup semester, nilai dikunci bagi guru. Bila ada koreksi yang sah, buka kunci satu kelas dengan alasan tertulis; pembukaan dan alasannya tercatat. Kunci kembali setelah koreksi selesai.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <label style="font-size:12px;font-weight:normal">Kelas <select id="kp-kelas" class="input"><option value="">— Pilih Kelas —</option></select></label>
          <label style="font-size:12px;font-weight:normal">Tahun ajaran <input type="text" id="kp-tahun" class="input" style="width:110px" value="${esc(ctx.tahun || '')}"></label>
          <label style="font-size:12px;font-weight:normal">Semester <select id="kp-semester" class="input"><option value="1"${String(ctx.semester) !== '2' ? ' selected' : ''}>1</option><option value="2"${String(ctx.semester) === '2' ? ' selected' : ''}>2</option></select></label>
          <button type="button" class="btn btn-primary btn-sm" id="kp-cek">Lihat Status</button>
        </div>
        <div id="kp-hasil"></div>`;
    host.appendChild(kartu);
    const q = (s) => kartu.querySelector(s);
    const hasil = q('#kp-hasil');
    let seq = 0;

    getKelasSekolah().then((list) => {
        const sel = q('#kp-kelas');
        for (const c of list) { const o = document.createElement('option'); o.value = c.class_id; o.textContent = c.name; sel.appendChild(o); }
    }).catch(() => { hasil.innerHTML = '<p class="status-err">Gagal memuat daftar kelas.</p>'; });

    const kunci = () => ({ classId: q('#kp-kelas').value, tahun: q('#kp-tahun').value.trim(), sem: Number(q('#kp-semester').value) });

    const tampil = async () => {
        const { classId, tahun, sem } = kunci();
        if (!classId) { hasil.innerHTML = '<p class="hint">Pilih kelas terlebih dahulu.</p>'; return; }
        if (!tahun) { hasil.innerHTML = '<p class="hint">Isi tahun ajaran terlebih dahulu.</p>'; return; }
        const mine = ++seq;
        hasil.innerHTML = '<p class="hint">Memuat…</p>';
        try {
            const s = await getGradePeriodStatus(classId, tahun, sem);
            if (mine !== seq) return;
            const r = ringkasStatusKunci(s);
            const warna = r.kode === 'TERKUNCI' ? 'var(--color-danger)' : (r.kode === 'DIBUKA' ? 'var(--color-warning, #b7791f)' : 'var(--color-success)');
            const rinci = r.kode === 'DIBUKA'
                ? `<div style="font-size:12px;margin:4px 0">Dibuka oleh ${esc(s.unlocked_by_name || '—')} pada ${esc(new Date(s.unlocked_at).toLocaleString('id-ID'))}. Alasan: ${esc(s.reason || '')}</div>` : '';
            hasil.innerHTML = `
                <div style="font-weight:600;color:${warna}">${esc(r.teks)}</div>${rinci}
                ${r.bisaBuka ? `<div style="margin-top:8px"><label style="font-size:12px;display:block;margin-bottom:4px">Alasan membuka kunci (wajib, minimal 10 karakter)</label>
                    <textarea id="kp-alasan" class="input" rows="2" style="width:100%;max-width:480px" placeholder="Contoh: koreksi salah input nilai UH 2 atas permintaan guru"></textarea>
                    <div style="margin-top:6px"><button type="button" class="btn btn-primary btn-sm" id="kp-buka">Buka Kunci Kelas Ini</button></div></div>` : ''}
                ${r.bisaKunci ? '<div style="margin-top:8px"><button type="button" class="btn btn-secondary btn-sm" id="kp-kunci">Kunci Kembali</button></div>' : ''}
                <div id="kp-pesan" style="margin-top:6px;font-size:12px"></div>`;
        } catch (err) {
            if (mine !== seq) return;
            hasil.innerHTML = `<p class="status-err">Gagal memuat status kunci. ${esc(err.message || '')}</p>`;
        }
    };
    const pesan = (t, ok) => { const p = q('#kp-pesan'); if (p) { p.style.color = ok ? 'var(--color-success)' : 'var(--color-danger)'; p.textContent = t; } };

    q('#kp-cek').addEventListener('click', tampil);
    hasil.addEventListener('click', async (e) => {
        const tombol = e.target.closest('button'); if (!tombol) return;
        const { classId, tahun, sem } = kunci();
        tombol.disabled = true;
        try {
            if (tombol.id === 'kp-buka') {
                const alasan = (q('#kp-alasan')?.value || '').trim();
                if (alasan.length < 10) { pesan('Alasan wajib diisi, minimal 10 karakter.', false); return; }
                await unlockGradePeriod(classId, tahun, sem, alasan);
                await tampil();
            } else if (tombol.id === 'kp-kunci') {
                await relockGradePeriod(classId, tahun, sem);
                await tampil();
            }
        } catch (err) {
            pesan('Gagal: ' + (err.message || 'terjadi kesalahan'), false);
        } finally { tombol.disabled = false; }
    });
}
