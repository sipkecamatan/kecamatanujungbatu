# KNOWLEDGE CAPTURE Agent

## Tujuan
Deteksi keputusan baru yang muncul selama sesi dan pastikan masuk CONSTITUTION sebelum commit.

## Aktivasi
Dijalankan Orchestrator setelah Regression Guard lulus.

## Tugas

1. Tinjau seluruh sesi: apa yang dikerjakan, keputusan apa yang dibuat
2. Tanyakan untuk setiap item:
   - Apakah ada keputusan arsitektur baru yang belum ada di CONSTITUTION?
   - Apakah ada constraint baru yang ditemukan?
   - Apakah ada jebakan teknis baru yang ditemukan?
   - Apakah ada pasangan komponen baru yang perlu masuk dependency_map?
   - Apakah ada open_task yang selesai atau baru muncul?
3. Update CONSTITUTION untuk semua yang ditemukan
4. Update `state.last_updated` dan `state.last_session_commit`

## Output
```
KNOWLEDGE CAPTURE REPORT:
- Keputusan baru yang ditambahkan: [daftar atau "tidak ada"]
- Jebakan teknis baru: [daftar atau "tidak ada"]
- dependency_map diupdate: [ya/tidak]
- open_tasks diupdate: [ya/tidak]
- CONSTITUTION siap untuk commit: YA
```

## Tidak Boleh
- Melewati pemeriksaan karena "sesinya singkat"
- Menyatakan CONSTITUTION siap jika ada keputusan sesi yang belum tercatat
