# Protokol kolaborasi Claude + Codex (SIP Kecamatan)

Berkas ini lokal (`docs/` tidak terlacak git; repo GitHub publik). Tanpa rahasia.
Rujukan isolasi dan cakupan wilayah: `docs/ARSITEKTUR-ISOLASI.md` (SSoT lama dihapus 16 Okt 2026); konteks sesi di `docs/HANDOFF-SESI-2026-10-15.md`.

## Peran

| Pihak | Tugas |
|---|---|
| Romo | Pemilik produk. Memutuskan, menyetujui push dan deploy. Memegang semua rahasia. |
| Claude | Merencanakan, menulis tugas, memanggil Codex, meninjau diff, menjalankan `node --check` dan uji. |
| Codex | Mengerjakan satu tugas terbatas di worktree/cabang sendiri, lalu melapor. |

## Cara Claude memicu Codex

Prompt **dikirim lewat stdin** (tanda `-` di akhir). Jangan lewat argumen: PowerShell 5.1 memecah teks
bertanda kutip/multi-baris dan `codex` menjawab "unexpected argument".

```powershell
$c  = "$env:USERPROFILE\.vscode\extensions\openai.chatgpt-<versi>\bin\windows-x86_64\codex.exe"
$wt = "D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-codex"
$t  = @'
TUJUAN: ...
'@
$t | & $c exec --sandbox workspace-write -C $wt -      # boleh menulis di worktree
"Pertanyaan?" | & $c exec --sandbox read-only -         # hanya membaca
```
`codex.exe` tidak ada di PATH; nomor versi ekstensi dapat berubah (cek `Get-ChildItem` folder ekstensi).
Sandbox `workspace-write` membatasi tulis ke worktree; `approval: never` berarti Codex tidak berhenti
bertanya, jadi batasan tugas wajib tertulis di prompt. Biaya uji: sekitar 4–10 ribu token untuk tugas kecil,
sekitar 50 ribu untuk perbaikan dua berkas.

## Batasan Codex yang sudah ditemui

- Tidak dapat menulis metadata git worktree: `git commit` gagal (`index.lock: Permission denied`). **Claude
  yang `git add` dan `git commit`** (pesan lewat berkas, `-F`) setelah meninjau.
- Tidak dapat menjalankan `deno` (akses ditolak). **Claude menjalankan `deno check --no-lock`** pada fungsi edge.
- Laporan Codex tidak dianggap bukti: Claude mengulang `node --check`, membaca diff, dan memeriksa `git status`.

## Pemasangan ke produksi

- **Deploy fungsi edge dijalankan Romo sendiri** di terminal (`supabase functions deploy <fungsi>
  --no-verify-jwt`). Pengaman izin sistem menolak deploy produksi dari Claude; jangan diakali.
- `git push` oleh Claude hanya setelah Romo menyetujui; gabung ke `main` dengan `--ff-only`
  (`gh auth switch --user sipkecamatan` lebih dulu).
- Urutan biasa: migrasi, fungsi edge, tampilan. Bila tampilan baru aman terhadap server lama (dan tidak
  sebaliknya), balik: push dulu, deploy sesudahnya. Putuskan per perubahan dan sebut alasannya kepada Romo.
- Setelah itu Claude memeriksa situs live. Sesi superadmin tidak ikut ke tab baru dan hilang saat muat ulang
  paksa; Romo login sendiri di tab yang dibuka Claude (Claude tidak mengetik kunci).

## Isolasi

- Codex **tidak pernah** bekerja di folder utama. Ia bekerja di git worktree `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-codex`
  pada cabang `codex/<nama-tugas>`.
- Claude meninjau `git diff main...codex/<nama-tugas>`; penggabungan ke `main` hanya atas persetujuan Romo.

## Larangan mutlak (berlaku untuk Codex juga)

1. Tidak `git push`, tidak `supabase db push`, tidak `supabase functions deploy`.
2. Tidak membaca, meminta, atau menulis rahasia (`SUPERADMIN_KEY`, kata sandi, token, `auth.json`).
3. Tidak menjalankan SQL atau skrip yang mengubah persetujuan berbagi (`share_with_region`, `share_kabupaten`, `share_provinsi`).
4. Tidak menyentuh repo `SIP SMK`; tidak menyentuh kata "AASF".
5. Tidak mengubah keputusan Romo (handoff bagian 4 dan `ARSITEKTUR-ISOLASI.md` bagian 10) dan tidak mengerjakan hal yang diputuskan diabaikan (handoff butir 10; arsitektur bagian 2.6).
6. Tidak menaruh `docs/` atau cadangan data ke repo.
7. Tidak menyentuh data produksi. Uji beban dan data sintetis hanya di proyek uji.

## Aturan teknis

- Berkas `.mjs`/`.js` yang diubah wajib lolos `node --check` sebelum melapor selesai.
- Berkas CRLF: periksa `\r\n` dengan node sebelum mengedit; jangan mengubah akhir baris.
- Komit di cabang tugas, pesan lewat berkas (`git commit -F`), tanpa `--no-verify`.
- Urutan pemasangan (hanya Romo/Claude setelah disetujui): migrasi, fungsi edge, baru `git push`.
- Bahasa pesan komit, komentar, dan laporan: Indonesia, ringkas, mengikuti gaya berkas sekitar.

## Format tugas (Claude menulis di prompt)

```
TUJUAN: <satu kalimat>
BOLEH MENGUBAH: <daftar berkas/folder>
JANGAN MENYENTUH: <daftar>
KRITERIA SELESAI: <yang dapat diperiksa>
LAPORAN: berkas yang diubah, hasil pemeriksaan, hal yang tidak pasti
```

## Format laporan Codex

Bedakan jujur: **terbukti dijalankan**, **hanya dibaca**, **tidak diuji**. Sebut apa yang tidak dikerjakan.

## Tinjauan Claude

Tiap hasil Codex diperiksa: diff hanya menyentuh berkas yang diizinkan, tidak ada rahasia, `node --check` lolos,
tidak melanggar larangan. Hasil dilaporkan kepada Romo sebelum apa pun digabung.
