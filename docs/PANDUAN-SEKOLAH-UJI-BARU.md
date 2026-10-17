# Panduan: menambah satu sekolah uji baru (SMK Uji 3 Ujung Batu)

Tujuan: sekolah SMK baru yang **tampil di Kecamatan Ujung Batu dan Provinsi Riau** (tidak di kabupaten).
Diperbarui 16 Oktober 2026 · salinan lokal (tidak di-commit). Tanpa rahasia.

## Mengapa Romo yang menjalankan

Pendaftaran sekolah memakai **kunci superadmin** dan membuat akun admin dengan kata sandi sementara. Keduanya bukan hal yang
boleh Claude lakukan atau pegang. Persetujuan berbagi adalah **hak kepala sekolah**, bukan superadmin dan bukan Claude.
Claude sudah menyiapkan skrip dan berkas data; Romo yang menjalankannya.

## Berkas yang sudah disiapkan (di luar repo)

Folder `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-data-uji\`:

| Berkas | Isi |
|---|---|
| `daftarkan-smk-uji-3.mjs` | Mendaftarkan satu sekolah dan menghubungkannya ke kecamatan dan provinsi (bukan kabupaten) |
| `smk-uji-3\1-program.csv` | Satu program keahlian: TKJ |
| `smk-uji-3\2-kelas.csv` | Satu kelas: X TKJ 1 |
| `smk-uji-3\3-staf-kepsek.csv` | Satu kepala sekolah: Kepsek Uji SMK 3, NIP `196703031992031003` |

Identitas sekolah: nama **SMK Uji 3 Ujung Batu**, slug `smkuji3`, jenjang SMK, admin `ADM-SMKUJI3`.

## Bagian A. Daftarkan sekolah (sekitar 2 menit)

1. Buka PowerShell, lalu:
   ```
   cd "D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-data-uji"
   $env:SUPERADMIN_KEY = Read-Host "Kunci superadmin"
   node daftarkan-smk-uji-3.mjs
   Remove-Item Env:SUPERADMIN_KEY
   ```
2. Hasil yang diharapkan di layar: dua baris wilayah ("sudah ada" untuk Provinsi Riau dan Kecamatan Ujung Batu), lalu
   `OK     SMK Uji 3 Ujung Batu  (smkuji3)`.
3. Kata sandi sementara admin tertulis di `hasil-smk-uji-3.json` (folder yang sama). Catat, lalu simpan berkas itu di tempat
   aman; jangan dimasukkan ke repo.
4. Bila muncul `GAGAL ... slug sudah ada`, sekolah itu sudah pernah dibuat: lanjut ke Bagian B dan abaikan kata sandi baru.

*Cara lewat portal (bila lebih suka):* portal superadmin, tab **Sekolah**, **+ Daftarkan Baru**: nama, slug `smkuji3`, jenjang SMK,
admin `ADM-SMKUJI3`. Lalu pada kartu sekolah tekan **Ubah penghubungan**, pilih Kabupaten Rokan Hulu lalu Kecamatan Ujung Batu,
**centang kecamatan dan provinsi, kosongkan kabupaten**, simpan, dan setujui konfirmasi.

## Bagian B. Isi data minimum lewat wizard admin sekolah

Tujuannya hanya agar sekolah punya **kepala sekolah** (yang berhak menyetujui berbagi).

1. Buka `https://sipkecamatan.github.io/kecamatanujungbatu/admin/?school=smkuji3`. Masuk dengan `ADM-SMKUJI3` dan kata sandi
   sementara; sistem meminta kata sandi baru (catat).
2. Wizard: **1 Profil Sekolah** dan **2 Tahun Ajaran**: isi seperlunya dan samakan dengan sekolah uji lain (2026/2027).
3. **3 Program Keahlian**: unggah `smk-uji-3\1-program.csv`.
4. **4 Kelas & Rombel**: unggah `smk-uji-3\2-kelas.csv`.
5. **5 Staf & Peran**: unggah `smk-uji-3\3-staf-kepsek.csv`. **Catat kata sandi awal kepala sekolah.**
   Catatan jujur: Claude belum memverifikasi apakah impor berkas menampilkan kata sandi awal. Bila tidak tampil, di langkah yang
   sama gunakan **Tambah** manual (nama dan NIP/NIK yang sama, jabatan KEPSEK); cara itu menampilkan kata sandi awal sekali.
6. Langkah 6 dan seterusnya (siswa, orang tua, jadwal, dll.) **boleh dilewati** untuk uji tampil. Sekolah akan tampil dengan
   siswa 0 dan status data "Tidak ada jadwal". Bila ingin angka berisi, isi data siswa dan absensi seperti sekolah uji lain.

## Bagian C. Kepala sekolah menyetujui berbagi (ini yang membuatnya tampil)

1. Gunakan **jendela penyamaran** atau tekan **Keluar** dulu (portal guru menyimpan satu sesi per peramban).
2. Buka `https://sipkecamatan.github.io/kecamatanujungbatu/guru/?school=smkuji3`. Masuk dengan NIP `196703031992031003` dan
   kata sandi awal; buat kata sandi baru.
3. Buka tab **Kepsek**, lalu kartu **Berbagi Ringkasan ke Wilayah**.
4. **Aktifkan Kecamatan dan Provinsi.** Biarkan Kabupaten mati: sekolah ini sengaja tidak terhubung ke kabupaten.

## Hasil yang diharapkan (Claude yang akan memeriksa di peramban)

| Dasbor | Sebelum | Sesudah |
|---|---|---|
| Kecamatan Ujung Batu | 4 sekolah | **5 sekolah** (ditambah SMK Uji 3) |
| Provinsi Riau | 3 sekolah | **4 sekolah** (ditambah SMK Uji 3) |
| Kabupaten Rokan Hulu | 4 sekolah | **4 sekolah** (tidak berubah) |

Ketiga angka itu sekaligus bukti isolasi per tingkat. Sekolah baru tampil di dua dasbor saja.

## Bila ingin membatalkan

Portal superadmin, tab **Sekolah**: **Nonaktifkan** (sekolah hilang dari semua dasbor, data aman, bisa diaktifkan lagi), atau
**Hapus Permanen** (harus nonaktif; mengetik nama sekolah; tidak bisa dibatalkan).

## Setelah selesai

Kabari Claude. Claude memeriksa ketiga dasbor di peramban dengan akun pegawai uji (Romo login sendiri) dan mencatat hasilnya di
`docs/ARSITEKTUR-ISOLASI.md`.
