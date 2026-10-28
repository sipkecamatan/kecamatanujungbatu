# Commit Gate

Satu halaman ringkas untuk dicek cepat sebelum commit.
Detail ada di verifier.md dan session-end.md.

## STOP jika salah satu ini benar:

- [ ] Ada file docs/ yang staged → `git reset HEAD docs/`
- [ ] Ada SQL yang dijalankan ke live tanpa BEGIN/ROLLBACK
- [ ] Ada fungsi SECURITY DEFINER baru dengan penjaga <> (harus IS DISTINCT FROM)
- [ ] Nilai-rapor.js diubah tapi fn_hitung_nilai_rapor tidak (atau sebaliknya)
- [ ] CONSTITUTION.json belum diupdate (last_session_commit masih SHA lama)
- [ ] open_tasks belum direfleksikan (task selesai masih listed, task baru belum masuk)

## GO jika semua kotak di atas kosong (tidak ada yang benar)

Lanjut commit. Ingatkan Romo: **git push dilakukan Romo, bukan Claude.**
