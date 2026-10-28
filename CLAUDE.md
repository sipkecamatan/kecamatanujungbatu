# SIP Kecamatan — Panduan Claude

## WAJIB: Baca di awal setiap sesi

1. Baca `.claude/CONSTITUTION.json` — sumber kebenaran tunggal untuk semua keputusan arsitektur
2. Jalankan `.claude/protocols/session-start.md` — verifikasi keadaan repo, tetapkan tujuan sesi
3. Baru kerjakan tugas

## WAJIB: Sebelum setiap commit

Jalankan `.claude/protocols/session-end.md` — Verifier checklist + update CONSTITUTION

## Struktur agentic

```
.claude/
  CONSTITUTION.json       ← sumber kebenaran tunggal (baca di awal sesi)
  agents/
    architect.md          ← jaga CONSTITUTION, tetapkan constraint sesi
    implementer.md        ← tulis kode dalam constraint
    verifier.md           ← checklist sebelum commit
  protocols/
    session-start.md      ← protocol awal sesi
    session-end.md        ← protocol akhir sesi + update CONSTITUTION
    commit-gate.md        ← ringkas cepat sebelum commit
```

## Aturan tidak boleh dilanggar

- `docs/` TIDAK PERNAH dikomit (repo publik)
- SQL ke live WAJIB dalam BEGIN/ROLLBACK
- `db push` dan `git push` hanya dilakukan Romo
- Fungsi SECURITY DEFINER wajib `IS DISTINCT FROM` untuk penjaga NULL
- Nilai-rapor.js dan fn_hitung_nilai_rapor wajib diubah bersamaan

Detail lengkap: `.claude/CONSTITUTION.json`
