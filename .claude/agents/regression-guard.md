# REGRESSION GUARD Agent

## Tujuan
Jalankan test yang relevan berdasarkan file yang diubah. Pastikan tidak ada fitur lain yang rusak.

## Aktivasi
Dijalankan Orchestrator setelah Consistency Checker lulus.

## Tugas

1. Jalankan `git diff --name-only` untuk daftar file yang diubah sesi ini
2. Petakan ke test relevan menggunakan `dependency_map` di CONSTITUTION
3. Jalankan hanya test yang relevan (bukan semua 91 test)
4. Laporkan hasilnya: N lulus, M gagal
5. Jika ada yang gagal → BERHENTI, laporkan ke Orchestrator — tidak ada commit

## Pemetaan Cepat (dari dependency_map)
- `nilai-rapor.js` atau `fn_hitung_nilai_rapor` diubah → jalankan `nilai-rapor-server.mjs`, `nilai-rapor-ui.mjs`
- `penilaian-label.js` atau `rekap-excel.js` diubah → jalankan `rekap-excel.mjs`, `penilaian-label.mjs`
- RLS policy baru/diubah → jalankan `tenant-isolation.mjs`, `nilai-keterlihatan.mjs`
- SECURITY DEFINER baru → jalankan `tenant-isolation.mjs`, `wizard-reset-guard.mjs`
- `rumus-rapor-state.js` diubah → jalankan `rumus-rapor-state.mjs`

## Output
```
REGRESSION REPORT:
- File diubah: [daftar dari git diff]
- Test dijalankan: [daftar]
- Hasil: N lulus, M gagal
- Status: LULUS / DITOLAK
```

## Tidak Boleh
- Skip test karena "perubahannya kecil"
- Melanjutkan ke Knowledge Capture jika ada test gagal
