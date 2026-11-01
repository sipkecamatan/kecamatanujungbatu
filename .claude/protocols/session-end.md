# Protocol: Session End

Jalankan ini sebelum setiap commit. Dua fase dijalankan Romo di terminal, dua fase dijalankan Claude.

---

## BAGIAN A — Romo jalankan di terminal (DULU, sebelum panggil Claude)

```bash
# Regression Guard
node tests/tenant-isolation.mjs
node tests/nilai-rapor-server.mjs

# Data Truth Verifier (setelah skrip selesai dibangun)
node scripts/absensi-konsistensi.mjs

# UI Verifier (setelah skrip selesai dibangun)
node scripts/playwright-login-uji.mjs
```

Laporkan hasilnya ke Claude: berapa PASS, berapa FAIL, skrip mana yang dilewati.

---

## BAGIAN B — Claude jalankan (setelah Romo lapor hasil terminal)

### Fase 4 — CONSISTENCY CHECKER

1. Cek file yang diubah: `git diff --name-only`
2. Untuk setiap file, periksa pasangannya dari `dependency_map` di CONSTITUTION
3. Verifikasi pasangan masih sinkron
4. Jika tidak sinkron → kembalikan ke Implementer, perbaiki dulu

### Fase 7 — KNOWLEDGE CAPTURE

5. Tinjau sesi: keputusan baru apa yang muncul?
6. Update CONSTITUTION jika ada:
   - Keputusan arsitektur baru → tambah ke `architecture`
   - Jebakan teknis baru → tambah ke `jebakan_teknis`
   - Pasangan komponen baru → tambah ke `dependency_map`
   - open_tasks yang selesai atau baru
7. Update `state.last_updated` = hari ini
8. Update `state.last_session_commit` = SHA commit yang akan dibuat
9. Update `state.main_sha` = SHA yang sama

### Fase 8 — COMMIT

10. `git status` — pastikan tidak ada docs/ yang staged
11. `git add` file yang relevan (bukan -A)
12. `git commit`
13. Ingatkan Romo: **git push dilakukan Romo**
