# Protocol: Session Start

Jalankan ini di awal SETIAP sesi. Orchestrator mengkoordinasi dua fase pertama.

## Fase 1 — ARCHITECT

1. Baca `.claude/CONSTITUTION.json` (seluruh file)
2. Verifikasi keadaan repo:
   ```
   git fetch && git status -sb
   ```
   Bandingkan HEAD dengan `state.main_sha` di CONSTITUTION. Laporkan jika berbeda.
3. Petakan dampak berdasarkan tujuan sesi yang akan ditetapkan
4. Nyatakan constraint aktif sesi ini

## Fase 2 — SCOPE GUARD

5. Terima tujuan sesi dari Romo
6. Tetapkan scope eksplisit: file mana yang BOLEH diubah
7. Nyatakan batas: file mana yang TIDAK BOLEH diubah tanpa konfirmasi Romo

## Output Session Start
```
SESSION START SELESAI:
- Tujuan sesi: [satu kalimat]
- File boleh diubah: [daftar]
- Komponen terdampak: [dari dependency_map]
- Test yang akan dijalankan nanti: [daftar]
- Constraint aktif: [daftar]
```

## Baru mulai kerjakan setelah output ini dinyatakan
