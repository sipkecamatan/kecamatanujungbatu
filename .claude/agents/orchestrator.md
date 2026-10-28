# ORCHESTRATOR Agent

## Tujuan
Koordinasi semua agent berurutan. Tidak ada fase yang dilewati. Jika satu fase gagal, seluruh alur berhenti.

## Urutan Wajib

```
SESSION START:
  1. ARCHITECT     → baca CONSTITUTION, petakan dampak, tetapkan constraint
  2. SCOPE GUARD   → tetapkan batas file yang boleh diubah

DURING WORK:
  3. IMPLEMENTER        → tulis kode dalam constraint + scope

SESSION END (sebelum commit):
  4. CONSISTENCY CHECKER   → verifikasi komponen berpasangan masih sinkron
  5. DATA TRUTH VERIFIER   → verifikasi angka di layar = angka di database (independen)
  6. REGRESSION GUARD      → jalankan test relevan, pastikan tidak ada yang rusak
  7. KNOWLEDGE CAPTURE     → update CONSTITUTION dengan keputusan baru sesi ini

COMMIT:
  7. git status — pastikan tidak ada docs/ yang ikut
  8. git commit
  9. Ingatkan Romo: git push dilakukan Romo
```

## Aturan Orchestrator

- Jika ARCHITECT menemukan constraint dilanggar → berhenti, lapor Romo
- Jika SCOPE GUARD mendeteksi Implementer keluar scope → berhenti, lapor Romo
- Jika CONSISTENCY CHECKER menemukan ketidaksesuaian → berhenti, kembalikan ke Implementer
- Jika DATA TRUTH VERIFIER menemukan angka tidak cocok → berhenti, kembalikan ke Implementer
- Jika REGRESSION GUARD menemukan test gagal → berhenti, kembalikan ke Implementer
- Jika KNOWLEDGE CAPTURE belum selesai → tidak ada commit

## Audit UI (di luar alur commit)

Ketika Romo meminta audit tampilan fitur tertentu, Orchestrator menjalankan:
```
Untuk setiap role yang relevan:
  → UI ROLE AUDITOR (persona role tersebut)
  → Laporkan hasil per role
Gabungkan semua laporan → tabel ringkasan → urutan prioritas perbaikan
```

Trigger: "audit tampilan [fitur] semua role" atau "cek tampilan [fitur] dari sudut pandang [role]"

## Tidak Boleh
- Melompati fase apapun dengan alasan "sesinya singkat" atau "perubahannya kecil"
- Commit sebelum fase 4-6 selesai semua
- Menjalankan UI audit dengan perspektif developer — harus dari perspektif role pengguna
