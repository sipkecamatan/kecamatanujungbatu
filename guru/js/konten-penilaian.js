/**
 * @file guru/js/konten-penilaian.js
 * Satu pintu untuk MEMBACA hasil penilaian NON-angka yang tersimpan di kolom konten (JSONB) menjadi label per siswa
 * (instrumen-centric: tiap kategori memuat daftar student_id). Dipakai layar Rekap DAN ekspor Excel Rekap supaya keduanya selalu membaca bentuk
 * data yang sama (sebelumnya ekspor hanya mengenali konten.aspeks sehingga Catatan Anekdot, Checklist, dan tes bergradasi keluar kosong di Excel).
 * Logika murni (tanpa DOM, tanpa jaringan); diuji di tests/rekap-excel.mjs.
 */

export function extractLabelSiswa(konten, teknik, instrumen) {
    // Membaca konten JSONB assessment non-SUMATIF (instrumen-centric:
    // tiap kategori memuat array student_id) dan membaliknya jadi
    // peta { student_id: label } — kategori tertinggi yang dicapai siswa.
    const map = {};
    if (!konten) return map;

    const PRIO_PRED = ['SB', 'BSH', 'MB', 'BB'];
    function setByPredikat(sid, val) {
        if (!map[sid] || PRIO_PRED.indexOf(val) < PRIO_PRED.indexOf(map[sid])) map[sid] = val;
    }
    function setFirstWins(sid, label) {
        // dipakai untuk daftar yang sudah urut prioritas tinggi → rendah
        if (!map[sid]) map[sid] = label;
    }

    if (teknik === 'OBSERVASI') {
        if (instrumen === 'Lembar Observasi') {
            const PRIO  = ['terlihat_jelas', 'terlihat', 'belum_terlihat'];
            const LABEL = {
                terlihat_jelas: 'Terlihat Jelas',
                terlihat:       'Terlihat',
                belum_terlihat: 'Belum Terlihat',
            };
            (konten.aspeks || []).forEach(aspek => {
                PRIO.forEach(key => {
                    (aspek[key] || []).forEach(sid => {
                        if (!map[sid] || PRIO.indexOf(key) < PRIO.indexOf(map[sid])) map[sid] = key;
                    });
                });
            });
            Object.keys(map).forEach(sid => { map[sid] = LABEL[map[sid]] || map[sid]; });
        } else if (instrumen === 'Catatan Anekdot') {
            // mode per_siswa: catatan[].siswa = string; per_kejadian: array
            (konten.catatan || []).forEach(c => {
                const sids = Array.isArray(c.siswa) ? c.siswa : [c.siswa];
                sids.filter(Boolean).forEach(sid => { map[sid] = 'Tercatat'; });
            });
        } else if (instrumen === 'Checklist') {
            (konten.items || []).forEach(item => {
                (item.siswa || []).forEach(sid => { map[sid] = 'Tercapai'; });
            });
        }
    } else if (teknik === 'TES' || (teknik === 'TES_LISAN' && instrumen === 'Wawancara')) {
        // deskriptor[] sudah urut: 0 = tertinggi, 2 = terendah
        (konten.deskriptor || []).forEach((d, i) => {
            (d.siswa || []).forEach(sid => setFirstWins(sid, d.label || ('Deskriptor ' + (i + 1))));
        });
    } else if (teknik === 'TES_LISAN') {
        (konten.predikat || []).forEach(p => {
            (p.siswa || []).forEach(sid => setByPredikat(sid, p.val));
        });
    } else if (['PENUGASAN', 'PROYEK', 'PORTOFOLIO', 'UNJUK_KERJA'].includes(teknik)) {
        if (instrumen === 'Rubrik') {
            (konten.aspeks || []).forEach(aspek => {
                (aspek.predikat || []).forEach(p => {
                    (p.siswa || []).forEach(sid => setByPredikat(sid, p.val));
                });
            });
        } else if (instrumen === 'Checklist') {
            (konten.items || []).forEach(item => {
                (item.siswa || []).forEach(sid => { map[sid] = 'Tercapai'; });
            });
        }
    }
    return map;
}
