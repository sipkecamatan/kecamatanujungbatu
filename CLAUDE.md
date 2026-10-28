# SIP Kecamatan — Panduan Claude

## WAJIB: Baca di awal setiap sesi

1. Baca `.claude/CONSTITUTION.json` — sumber kebenaran tunggal
2. Jalankan `.claude/protocols/session-start.md` — Orchestrator koordinasi Architect + Scope Guard
3. Baru kerjakan tugas

## WAJIB: Sebelum setiap commit

Jalankan `.claude/protocols/session-end.md` — Orchestrator koordinasi Consistency Checker + Regression Guard + Knowledge Capture

## Struktur agentic

```
.claude/
  CONSTITUTION.json          ← sumber kebenaran tunggal (baca di awal sesi)
  agents/
    orchestrator.md          ← koordinasi semua agent, tidak ada fase yang dilewati
    architect.md             ← jaga CONSTITUTION, petakan dampak perubahan
    scope-guard.md           ← tetapkan batas file yang boleh diubah
    implementer.md           ← tulis kode dalam constraint + scope
    consistency-checker.md   ← verifikasi komponen berpasangan masih sinkron
    data-truth-verifier.md   ← verifikasi angka di layar = angka di database (independen)
    regression-guard.md      ← jalankan test relevan berdasarkan file yang diubah
    knowledge-capture.md     ← update CONSTITUTION dengan keputusan baru sesi
    ui-role-auditor.md       ← audit tampilan dari perspektif setiap role pengguna
  protocols/
    session-start.md         ← Architect + Scope Guard (sebelum mulai)
    session-end.md           ← Consistency Checker + Regression Guard + Knowledge Capture (sebelum commit)
    commit-gate.md           ← ringkas cepat sebelum commit
```

## Aturan tidak boleh dilanggar

- `docs/` TIDAK PERNAH dikomit (repo publik)
- SQL ke live WAJIB dalam BEGIN/ROLLBACK
- `db push` dan `git push` hanya dilakukan Romo
- Fungsi SECURITY DEFINER wajib `IS DISTINCT FROM` untuk penjaga NULL
- `nilai-rapor.js` dan `fn_hitung_nilai_rapor` wajib diubah bersamaan
- Tidak ada fase agent yang boleh dilewati

Detail lengkap: `.claude/CONSTITUTION.json`
