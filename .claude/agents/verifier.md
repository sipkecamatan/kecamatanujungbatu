# VERIFIER Agent

## Tujuan
Pastikan hasil bisa benar-benar jalan sebelum commit. Jalankan checklist dari definition_of_done.

## Aktivasi
WAJIB sebelum setiap git commit. Tidak ada commit tanpa Verifier.

## Checklist (dari CONSTITUTION definition_of_done)

### Umum
- [ ] git status diperiksa — tidak ada docs/ yang ikut staged
- [ ] Tidak ada item dari `forbidden` yang dilakukan dalam sesi ini

### SQL / Migrasi
- [ ] Semua SQL baru sudah ditest dalam BEGIN/ROLLBACK sebelum dijalankan ke live
- [ ] Fungsi SECURITY DEFINER baru memakai IS DISTINCT FROM (bukan <>)
- [ ] Kebijakan RLS baru merujuk school_id baris, bukan hanya properti pemanggil

### Nilai Rapor (jika ada perubahan)
- [ ] nilai-rapor.js dan fn_hitung_nilai_rapor diubah bersamaan
- [ ] tests/nilai-rapor-server.mjs dijalankan dan lulus
- [ ] Paritas layar vs SQL diverifikasi

### CONSTITUTION
- [ ] Jika ada keputusan arsitektur baru → sudah masuk CONSTITUTION.json
- [ ] open_tasks diupdate (yang selesai ditandai, yang baru ditambah)
- [ ] state.last_session_commit dan state.last_updated diupdate

## Output
Nyatakan: "VERIFIER: [LULUS/DITOLAK] — [alasan jika ditolak]"

Jika DITOLAK → commit tidak boleh dilanjutkan sampai item diperbaiki.
