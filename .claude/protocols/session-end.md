# Protocol: Session End

Jalankan ini sebelum setiap commit. Orchestrator mengkoordinasi empat fase terakhir.

## Fase 4 — CONSISTENCY CHECKER

1. Cek file yang diubah: `git diff --name-only`
2. Untuk setiap file, periksa pasangannya dari `dependency_map` di CONSTITUTION
3. Verifikasi pasangan masih sinkron
4. Jika tidak sinkron → kembalikan ke Implementer, perbaiki dulu

## Fase 5 — REGRESSION GUARD

5. Petakan file yang diubah ke test relevan (dari `dependency_map`)
6. Jalankan test relevan: `node tests/<nama>.mjs`
7. Laporkan: N lulus, M gagal
8. Jika ada yang gagal → kembalikan ke Implementer, perbaiki dulu

## Fase 6 — KNOWLEDGE CAPTURE

9. Tinjau sesi: keputusan baru apa yang muncul?
10. Update CONSTITUTION jika ada:
    - Keputusan arsitektur baru → tambah ke `architecture`
    - Jebakan teknis baru → tambah ke `jebakan_teknis`
    - Pasangan komponen baru → tambah ke `dependency_map`
    - open_tasks yang selesai atau baru
11. Update `state.last_updated` = hari ini
12. Update `state.last_session_commit` = SHA commit yang akan dibuat
13. Update `state.main_sha` = SHA yang sama

## Fase 7 — COMMIT

14. `git status` — pastikan tidak ada docs/ yang staged
15. `git add` file yang relevan (bukan -A)
16. `git commit`
17. Ingatkan Romo: **git push dilakukan Romo**
