# Protocol: Session End

Jalankan ini sebelum setiap git commit. Tidak ada commit tanpa ini.

## Langkah Wajib (urut)

1. **Verifier: jalankan checklist**
   Baca `.claude/agents/verifier.md` dan jalankan setiap item.
   Nyatakan hasilnya: "VERIFIER: LULUS / DITOLAK — [alasan]"

2. **Jika DITOLAK → perbaiki dulu, baru lanjut ke langkah 3**

3. **Update CONSTITUTION.json**
   - Jika ada keputusan arsitektur baru → tambah ke `architecture`
   - Update `open_tasks` (yang selesai hapus atau tandai, yang baru tambah)
   - Update `state.last_updated` = hari ini
   - Update `state.last_session_commit` = SHA commit yang akan dibuat
   - Update `state.migrasi_terpasang_sampai` jika ada migrasi baru

4. **git status — periksa tidak ada docs/ yang ikut**
   ```
   git status
   ```
   Pastikan tidak ada file di docs/ yang staged.

5. **Baru commit**
   Ingatkan Romo untuk git push setelah commit.
