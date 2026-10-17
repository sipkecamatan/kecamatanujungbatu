# Panduan: menjalankan uji isolasi LIVE (tests/tenant-isolation.mjs)

Untuk Romo. Diperbarui 16 Oktober 2026 · salinan lokal (tidak di-commit). Tanpa rahasia.
Dokumen terkait: `docs/ARSITEKTUR-ISOLASI.md` (bagian 9h: audit jalur API), `docs/HANDOFF-SESI-2026-10-15.md`.

## Apa ini dan mengapa Romo yang menjalankan

`tests/tenant-isolation.mjs` memeriksa **basis data produksi sungguhan** lewat Management API Supabase (21 pemeriksaan: RLS, hak
EXECUTE anon, isolasi antar sekolah, lapisan wilayah, dan penjaga fungsi hapus-data wizard). Ia butuh **token akses pribadi
Supabase** milik Romo. Token itu rahasia: Claude tidak meminta dan tidak memegangnya. Romo menjalankan sendiri, lalu menyalin
keluarannya ke Claude untuk ditafsirkan.

Semua pemeriksaan yang menulis data berjalan di dalam **transaksi yang selalu dibatalkan (ROLLBACK)** dengan data sintetis, jadi tidak
ada data nyata yang berubah. (Sudah dibuktikan di PGlite untuk CHECK 21: `tests/wizard-guard-check-pglite.mjs`.)

## Cara tanpa token (mode CLI): sudah dipakai

Uji ini punya **mode CLI** yang tidak memerlukan token sama sekali: `SIP_MGMT_MODE=cli node tests\tenant-isolation.mjs`. SQL dijalankan lewat
`supabase db query --linked` memakai login CLI Supabase yang sudah tertaut di komputer ini; pemuat `.env` dilewati. Claude menjalankannya
pada **16 Okt 2026**: **134 lulus, 0 gagal, 2 peringatan SKIP** (tidak ada catatan siswa; tidak ada siswa aktif di kelas uji), termasuk
CHECK 19, 20, dan 21. Sesudahnya data produksi diperiksa utuh (siswa SMA Uji 1/2 dan SMP Uji 1/2 tetap 208/312/180/270; tanpa sisa data
sintetis). Cara dengan token di bawah tetap berlaku bila Romo ingin menjalankannya sendiri.

## Langkah (cara dengan token)

1. Buat token sementara: dashboard Supabase, **Account, Access Tokens, Generate new token**. Beri nama `uji-isolasi`. Salin satu kali.
2. Buka PowerShell di folder proyek, lalu:
   ```
   cd "D:\ribuan_pengguna\CLAUDE\SIP Kecamatan"
   $env:SUPABASE_ACCESS_TOKEN = Read-Host "Token"
   node tests\tenant-isolation.mjs
   Remove-Item Env:SUPABASE_ACCESS_TOKEN
   ```
3. **Cabut token** di dashboard (Access Tokens, Revoke) setelah selesai.
4. Salin seluruh keluaran terminal ke Claude (tanpa token; token tidak dicetak).

## Cara membaca hasil

- Akhir keluaran: `LULUS — invarian isolasi tenant utuh.` (kode 0) atau `GAGAL — N pelanggaran` (kode 1).
- `⚠ ... SKIP` bukan kegagalan: data sintetis untuk pemeriksaan itu tidak dapat dibuat (dicatat, tidak menggagalkan).
- **Jumlah lulus yang turun mendadak** bisa berarti **batas laju (HTTP 429)** pada Management API, bukan celah. Tunggu beberapa
  menit dan ulangi sebelum menyimpulkan ada masalah.
- Perubahan hari ini yang memengaruhi hasil: CHECK 19 `P2b` kini mengharapkan `2/2` (jumlah "terdaftar" sama dengan jumlah terlihat);
  CHECK 21 baru (W1 sampai W8) memeriksa penjaga fungsi hapus-data wizard.

## Bila ada yang GAGAL

Jangan perbaiki sendiri dan jangan jalankan SQL perbaikan. Kirim keluarannya ke Claude: kemungkinan penyebabnya (a) ekspektasi uji
yang usang, (b) pembatasan laju, atau (c) celah nyata. Claude menentukan dengan membaca kode, bukan menebak.
