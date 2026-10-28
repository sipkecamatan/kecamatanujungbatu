# Commit Gate

Ringkasan cepat. Detail ada di session-end.md dan masing-masing agent.

## STOP jika salah satu ini benar:

CONSISTENCY
- [ ] Ada komponen berpasangan yang tidak sinkron (nilai-rapor.js vs fn_hitung_nilai_rapor, dll.)

REGRESSION
- [ ] Ada test relevan yang gagal
- [ ] Ada SQL yang dijalankan ke live tanpa BEGIN/ROLLBACK

SCOPE
- [ ] Ada file di luar scope yang diubah tanpa konfirmasi Romo

CONSTITUTION
- [ ] Ada keputusan sesi yang belum masuk CONSTITUTION
- [ ] state.last_session_commit belum diupdate
- [ ] Ada docs/ yang staged

## GO jika semua kotak di atas kosong

Lanjut commit. Ingatkan Romo: **git push dilakukan Romo, bukan Claude.**
