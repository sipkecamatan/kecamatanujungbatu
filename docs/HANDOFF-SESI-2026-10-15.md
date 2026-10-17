> **DIGANTIKAN (17 Okt 2026).** Dokumen ini hanya riwayat 15-16 Okt dan **banyak isinya sudah usang** (HEAD, daftar sekolah, status isolasi, aturan izin, perangkat ajar).
> **Sesi baru wajib membaca `docs/HANDOFF-SESI-2026-10-17.md`**, bukan dokumen ini.

# Handoff sesi: SIP (lapisan wilayah) — 15–16 Oktober 2026

Dokumen ini untuk sesi baru yang melanjutkan pekerjaan **tanpa menebak**. Baca seluruhnya sebelum
mengubah apa pun. Berkas ini lokal (folder `docs/` tidak terlacak `git`; repo GitHub publik).
Tidak ada rahasia di dalamnya (kata sandi dan kunci sengaja tidak dicatat).

Nama berkas masih "2026-10-15" agar rujukan memori tetap benar; isinya mencakup 15 dan 16 Oktober.

## 0. Mulai dengan ini (tepat dalam urutan ini)

1. `pwd` harus berakhir `SIP Kecamatan` (bukan `SIP SMK`). Jangan menyentuh repo SIP SMK.
2. `git log --oneline -3` dan `git status --short`. HEAD saat dokumen ini ditulis: **`a0bd198`**,
   sama dengan `origin/main`; hanya `docs/` yang tidak terlacak.
3. `supabase migration list --linked`: harus memuat migrasi sampai **`20261016030000`** (17 migrasi),
   lokal = remote. Bila CLI menolak (401), Romo menjalankan `supabase login` sendiri.
4. Fungsi edge `manage-region` harus **versi 14** (`supabase functions list`).
4a. Kolaborasi dengan Codex: baca `docs/kolaborasi/PROTOKOL.md` (bagian 13 di bawah merangkumnya).
5. Baca `docs/ARSITEKTUR-ISOLASI.md`. **Itu rujukan utama** untuk isolasi dan cakupan wilayah; dokumen itu
   hidup dan berubah mengikuti keadaan nyata. Dokumen SSoT lama dihapus Romo 16 Okt 2026; rujukan "SSoT" di
   bawah ini berarti dokumen arsitektur itu dan kode di repo. Dua dokumen lain:
   `PANDUAN-LAPANGAN.md` (20 pertanyaan petugas), `PANDUAN-CADANGAN.md` (cadangan dan pulih).
6. **Tanyakan** kepada Romo apa tugas berikutnya; jangan memulai perubahan sebelum ia menjawab.
   Tugas yang paling mungkin ada di bagian 7.

## 1. Apa produk ini

**SIP** (nama lama "SIP Kecamatan") adalah dasbor baca-saja yang memperlihatkan **angka agregat**
(kehadiran, cakupan input, keterlambatan, izin keluar, jumlah siswa dan orang tua aktif) dari
sekolah-sekolah dalam satu wilayah, tanpa nama atau identitas siswa. Pegawai kecamatan, kabupaten, atau
provinsi masuk sekali dan melihat sekolah yang bertanda wilayahnya **dan** yang disetujui kepala sekolah.
Status: **uji coba**, belum dipakai publik. Basis kode berasal dari SIP SMK; "SIP" di sini berarti
lapisan wilayah. Romo = pemilik produk sekaligus pengembang.

## 2. Koordinat

| Hal | Nilai |
|---|---|
| Repo lokal | `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan` |
| Repo GitHub (publik) | `https://github.com/sipkecamatan/kecamatanujungbatu`, cabang `main` |
| GitHub Pages | `https://sipkecamatan.github.io/kecamatanujungbatu/` |
| Supabase (Free, Singapore) | ref `lqgzpiohxdzkkmxjtwor` |
| Dasbor pegawai | tiga alamat: `/kecamatan/`, `/kabupaten/`, `/provinsi/` (sejak `20bcb01`, 16 Okt 2026). Kode bersama di `kecamatan/js/app.js` dan `kecamatan/css/`; `kabupaten/index.html` dan `provinsi/index.html` hanya halaman masuk (beda judul, `data-tingkat`, jalur berkas). Akun yang membuka alamat tingkat lain dialihkan otomatis; tingkat tetap ditentukan server. Nama folder dan sesi `sip-kecamatan-auth` sengaja tidak diubah. Penjaga: `tests/halaman-tingkat.mjs` |
| Pengelolaan | `/superadmin/` (kunci superadmin; sesi **hilang bila halaman dimuat ulang**, disengaja) |
| Portal sekolah | `/admin/`, `/guru/` (juga dipakai **kepala sekolah**, hash `#kepsek`), `/student/`, `/parent/`, `/tu/`, `/dudi/`, `/stakeholder/` |
| Login sekolah | `<Pages>/guru/?school=<slug>` (slug = `smauji1`, `smpuji2`, dst.) |
| Akun GitHub untuk push | `sipkecamatan`: `gh auth switch --user sipkecamatan` sebelum `git push` |
| Rahasia | `SUPERADMIN_KEY`, kata sandi, token: milik Romo; **jangan diminta ditempel di chat, jangan diketik sendiri di peramban** |

## 3. Keadaan sistem sekarang (16 Okt 2026, akhir sesi)

**Wilayah** (4 baris di `regions`): Provinsi Riau (kode 14), Kabupaten Rokan Hulu (1407), Kecamatan Ujung
Batu (1407022), Kecamatan Tandun (1407020, **sisa uji, kosong**; boleh dihapus lewat tombol Hapus wilayah).

**Sembilan sekolah uji**, semuanya di Kecamatan Ujung Batu, Kab. Rokan Hulu, Prov. Riau:

| Slug | Jenjang | Data | Terhubung | Berbagi (kec / kab / prov) |
|---|---|---|---|---|
| `smauji1` | SMA | 208 siswa, terisi | kec, kab, prov | ya / ya / ya |
| `smauji2` | SMA | 312 siswa, terisi | kec, kab, prov | ya / ya / ya |
| `smpuji1` | SMP | 180 siswa, terisi | kec, kab, prov | ya / ya / ya |
| `smpuji2` | SMP | 270 siswa, terisi | kec, kab, prov | ya / ya / **tidak** |
| `smkuji1`, `smkuji2` | SMK | **kosong** (hanya akun admin) | kec saja | tidak / tidak / tidak |
| `smpuji3` … `smpuji5` | SMP | **kosong** (hanya akun admin) | kec saja | tidak / tidak / tidak |

Data absensi 28 hari, keterlambatan, dan izin keluar sudah diisi untuk empat sekolah yang terisi.
Tiap sekolah terisi punya kepala sekolah; SMK dan SMP 3–5 **belum punya kepala sekolah**.

**Akun uji** (kata sandi dipegang Romo; sistem tidak menyimpannya dan saya tidak dapat membacanya):

| Akun | Email atau NIP | Wilayah |
|---|---|---|
| Pegawai kecamatan | `pegawai.ujungbatu@contoh.test` | Kecamatan Ujung Batu |
| Pegawai kabupaten | `pegawai.kab@contoh.test` | Kabupaten Rokan Hulu |
| Pegawai provinsi | `pegawai.prov@contoh.test` | Provinsi Riau |
| Kepala SMA Uji 1 | NIP `196809251995021980` (Dr. H. Marwan Siregar, M.Pd) | `smauji1` |
| Kepala SMA Uji 2 | NIP `197004141997031900` (Drs. H. Nasrul Effendi, M.Si) | `smauji2` |
| Kepala SMP Uji 1 | NIP `197108171997031901` (Drs. H. Zulkifli Anwar, M.Pd) | `smpuji1` |
| Kepala SMP Uji 2 | NIP `196903041996031950` (Drs. Syamsul Bahri, M.M.) | `smpuji2` |
| Admin tiap sekolah | `ADM-<SLUG>` huruf besar, mis. `ADM-SMPUJI1` | tiap sekolah |

**Data uji sumber** ada di `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-data-uji\` (di luar repo):
`daftarkan-sekolah-uji.mjs`, `buat-data-smp-uji-1.mjs`, `buat-data-smp-uji-2.mjs`,
`buat-data-sma-uji-1.mjs`, `buat-data-sma-uji-2.mjs`, subfolder `smp-uji-1/`, `smp-uji-2/`, `sma-uji-1/`,
`sma-uji-2/` berisi xlsx langkah 3–10 wizard dan `sql/` (absensi 28 hari, piket 28 hari, ringkasan).
Tiap subfolder memuat `koreksi-waka-humas.csv` (lihat backlog).

## 4. Keputusan Romo (ringkas; butir isolasi dan cakupan wilayah rinci di `ARSITEKTUR-ISOLASI.md`, sisanya di kode dan migrasi)

1. **Wilayah hanyalah penanda, bukan hierarki komando.** Satu sekolah menyimpan **tiga penanda tetap**:
   kecamatan (`region_id`), kabupaten (`kabupaten_id`), provinsi (`provinsi_id`). Pilihan "A: tiga slot",
   bukan label bebas. Tiap penanda **berdiri sendiri**: memutus satu tingkat tidak menyentuh yang lain.
2. **Penanda saja tidak membuka data.** Sekolah terlihat oleh pegawai suatu wilayah hanya bila bertanda
   wilayah itu **dan** kepala sekolah menyetujui berbagi pada tingkat itu (`share_with_region`,
   `share_kabupaten`, `share_provinsi`; bawaan tidak). Superadmin tidak pernah menyetujui atas nama
   kepala sekolah; kode tidak pernah mengubah persetujuan menjadi "ya".
3. **Penghubungan diatur superadmin dari kartu sekolah** (tab Sekolah): pilihan Kabupaten/Kota lalu
   Kecamatan dari daftar resmi, plus tiga kotak centang (dicentang = terhubung). Kabupaten dan provinsi
   **mengikuti kecamatan** yang dipilih dan divalidasi server (awalan kode 7 → 4 → 2 digit). Kotak terkunci
   sampai "Ubah penghubungan" ditekan; simpan meminta konfirmasi yang merinci perubahan. Formulir
   pendaftaran sekolah **tidak lagi** memuat pilihan wilayah.
4. **Hapus wilayah selalu boleh** (menggantikan aturan "ditolak bila dipakai"): sekolah dilepas dari
   penanda itu dan persetujuan tingkat itu direset; pegawai wilayah itu dihapus beserta akun loginnya.
   Dialog konfirmasi menyebut jumlah terdampak.
5. **Dasbor dikelompokkan, tampilan sederhana:** pegawai kecamatan melihat daftar sekolah; pegawai
   kabupaten melihat satu baris per kecamatan lalu sekolah; pegawai provinsi satu baris per
   kabupaten/kota, lalu per kecamatan, lalu sekolah. Tanpa pencarian dan tanpa halaman. Total dan
   subtotal jenjang tetap dari seluruh sekolah yang terlihat.
   **DIREVISI 16 Okt (akhir sesi):** Romo memutuskan pegawai kabupaten/provinsi hanya mengenal nama sekolah,
   tanpa label kecamatan; dasbor menjadi daftar datar dengan pencarian nama dan pengurutan. Rancangan dan
   urutan kerja di `docs/ARSITEKTUR-ISOLASI.md` (belum diimplementasi). Kode saat ini masih mengelompokkan.
6. **Periode waktu** dasbor: 7/14/30 hari terakhir, bulan ini, bulan lalu, semester ini, tahun ajaran
   (mulai 1 Juli), tahun kalender, rentang bebas; maksimum 366 hari. Tampilan harian **sengaja tidak
   dibuat** (di bawah ambang privasi). Batas ada di satu konstanta per tingkat (`v_maks` di
   `fn_region_overview_range`) dan **dapat diubah dengan satu migrasi kecil bila diperlukan**; belum ada
   alasan untuk menurunkannya sebelum uji beban.
7. **Orang tua aktif** = akun `users.role_type = 'ORTU'` yang `is_active` dan belum dihapus
   (terdaftar sebagai user di sekolah), bukan menurut kapan terakhir masuk.
8. **Zona waktu:** "hari ini" pada fungsi wilayah memakai `Asia/Jakarta` (`fn_hari_ini()`).
9. SMA hanya punya waka **Kurikulum dan Kesiswaan** yang berhubungan dengan siswa; Humas dan Sarpras
   dikecualikan. SMP idem (dua waka). Sabtu boleh tampil di jadwal minggu ini tetapi tidak wajib.
10. **Diputuskan diabaikan oleh Romo:** catatan akses wilayah, pembatasan percobaan kunci superadmin,
    perbandingan kunci waktu-konstan, jejak audit tindakan superadmin, CORS terbuka, kata sandi awal
    tampil di layar. Jangan dikerjakan kecuali Romo mengubah keputusannya.
11. Prinsip lama Romo yang tetap berlaku: jangan menciptakan istilah baru demi jenjang tertentu;
    sembunyikan atau lewati, jangan menamai ulang. Pegawai wilayah: satu akun terikat satu wilayah,
    tidak ada ubah nama atau email (hapus lalu daftar ulang), tidak ada pindah wilayah. Akun baru atau
    direset wajib ganti kata sandi (ditegakkan di server).

## 5. Yang dikerjakan 15–16 Okt (commit dan migrasi)

| Hal | Commit atau migrasi |
|---|---|
| Orang tua aktif di dasbor | `dc16c7b`; migrasi `20261015060000` |
| Rentang waktu bebas, tren mingguan atau bulanan | migrasi `20261015070000`; `8773d52`, `f7fab7e` (galat regex diperbaiki), `9fec9a5`, `9b7c2cd`, `4450fca`, `852eb89`, `37fddea` (tampilan dan layar sempit) |
| Subtotal per jenjang, tab Sabtu, teks persetujuan, bug stakeholder | `c786f11`, `f96cc3a`, `ae8734f`, `80fe223` |
| Portal superadmin: tabel pegawai di kartu wilayahnya, daftar sekolah dilipat, tautan portal pegawai, kotak kredensial digulir dan bisa disalin | `9f670d0`, `d136be7`, `dac408b`, `00d664a`, `3ec9051` |
| Penghubungan lewat kotak centang, penanda berdiri sendiri, hapus wilayah selalu boleh | `850d241`, `7a308f9`; `manage-region` v12 |
| Pilihan kecamatan di kartu sekolah, validasi kode di server | `ca99a87`; `manage-region` **v13** |
| Dasbor kabupaten dan provinsi dikelompokkan | `aeb6109`, `4cc95e7` (perbaikan); migrasi `20261016010000` |
| CSV menyebut bagian yang dibuka, nama berkas mengikuti kelompok | `85f229d` |
| Zona waktu Jakarta | `979255b`; migrasi `20261016020000` |
| **Rancangan isolasi langkah 1-3** (matriks serangan, fungsi visibilitas tunggal, daftar sekolah datar dengan pencarian dan urutan; dikerjakan Codex, ditinjau Claude; migrasi dipasang Romo, lalu push) | `4b92442`, `c7828a0`, `a0bd198`; migrasi `20261016030000`; matriks BOCOR 20 menjadi 0; **terbukti live** dengan akun kabupaten (`ARSITEKTUR-ISOLASI.md` bagian 9d); dasbor kabupaten/provinsi **tidak lagi dikelompokkan** |
| Kartu Kabupaten dan Provinsi menghitung sekolah menurut slotnya; daftar baca-saja (dikerjakan Codex, ditinjau Claude, di-push, lalu `manage-region` v14 dipasang Romo) | `7d7c9f1`; **terbukti live**: Kabupaten 4, Provinsi 4, Kecamatan 9, tanpa pilihan dan tombol di dua kartu pertama |

Migrasi sesi ini: `20261015060000`, `20261015070000`, `20261016010000`, `20261016020000`.
Uji PGlite `tests/region-layer.mjs`: **62 lulus**.

## 6. Terbukti dan belum terbukti

**Terbukti di sistem nyata (peramban atau basis data live)**
- Dasbor kecamatan, kabupaten, dan provinsi dengan data empat sekolah; angka antar-tingkat cocok
  (970 siswa, 794 orang tua, 580 terlambat, 163 izin keluar untuk empat sekolah berbagi).
- Penelusuran Kabupaten → Kecamatan → Sekolah, jejak, kembali, dan aturan total ≥ 3 sekolah.
- Unduh CSV di tiga tingkat (bagian KABUPATEN / KOTA, KECAMATAN, SEKOLAH; nama berkas; "Bagian yang dibuka").
- Periode: bulan lalu, tahun ajaran (tren otomatis bulanan), rentang bebas; tata letak 400 piksel
  (kartu angka, Subtotal, Sekolah, Tren menjadi kartu).
- Portal superadmin: kotak penghubungan wilayah (terkunci, buka, simpan, batal), ganti kecamatan,
  hubungkan dan putuskan **satu tingkat** tanpa menyentuh yang lain; wilayah dibuat otomatis.
- Daftarkan dan reset kata sandi pegawai wilayah (kabupaten, provinsi); login berhasil; wajib ganti sandi.
- Zona waktu: periode 30 hari menampilkan "30 hari" pada pukul 04.50 WIB.

**Belum terbukti (jangan dinyatakan lulus)**
1. **Uji beban**: tidak ada pengukuran dengan banyak sekolah (ratusan sampai ribuan). Pegawai provinsi di
   Riau berpotensi melihat ribuan sekolah; `fn_region_overview_range` menghitung per sekolah dengan
   `EXISTS` per sesi dan periode dapat 366 hari.
2. **Tampilan layar sempit untuk kartu kelompok** (tabel Kecamatan/Kabupaten di ponsel) belum dilihat.
3. **Penolakan server** bila kabupaten atau provinsi tidak cocok dengan kecamatan (butuh panggilan
   langsung dengan kunci superadmin).
4. **Memutus tingkat yang persetujuannya "ya"** (persetujuan direset) di layar.
5. **Hapus wilayah yang dipakai sekolah dan punya pegawai** di sistem live (menghapus akun pegawai).
6. `tests/tenant-isolation.mjs` **belum dijalankan ulang** setelah migrasi `060000` dan seterusnya;
   `tests/manage-region-live.mjs` **belum pernah dijalankan** (dan ekspektasinya sudah diubah untuk
   hapus-selalu-boleh; butuh `SUPERADMIN_KEY` dari Romo).
7. Latihan pulih (`pulihkan-data.mjs`) ke proyek uji; cadangan pada data berisi banyak baris.
8. Alur paksa ganti kata sandi pegawai pada penyegaran token di semua kondisi.

## 7. Pekerjaan terbuka (usul urutan; tanyakan Romo)

0. **Rancangan isolasi** (`docs/ARSITEKTUR-ISOLASI.md`): langkah 1-3 SELESAI dan terpasang (16 Okt). Sisa: periksa
   akun provinsi dan kecamatan di peramban, uji skala 1.376 sekolah (langkah 4; butir 1 di bawah menyatu di sini),
   jalur API lain (realtime, storage, endpoint langsung), definisi hadir/sakit/alpa untuk dasbor (bagian 4a),
   (jumlah kecamatan 172 hanya simulasi; tidak perlu dicocokkan dengan 169 di daftar resmi). Superadmin tidak perlu melihat data agregat wilayah (keputusan Romo).
   Cabang `codex/*` dan worktree `SIP Kecamatan-codex` masih ada, isinya sudah di `main`.

1. **Uji beban**: buat data sintetis (misalnya 600 sekolah di beberapa kecamatan dan kabupaten) di proyek
   uji, bukan produksi; ukur `fn_region_overview_range` untuk staf provinsi. Bila lambat, turunkan
   `v_maks` untuk tingkat provinsi lewat migrasi kecil (opsi A) atau kirim hanya kelompok (opsi B).
2. **Tampilan layar sempit** kartu kelompok dan jejak.
3. Isi data SMK Uji 1–2 dan SMP Uji 3–5 (kepala sekolah, waka, guru, kelas, siswa, jadwal, absensi),
   mengikuti generator di folder data-uji.
4. **Backlog data uji:** Waka Humas masih ada di `smauji1` (Rini Marlina, KIM), `smpuji1` (Fitri
   Handayani, BIG), `smpuji2` (Andre Simatupang, BIG2). Koreksi: admin sekolah mengimpor ulang
   `koreksi-waka-humas.csv` (satu baris, jabatan kosong) lewat wizard; UPDATE SQL ditolak pengaman
   kolom terlindungi. Generator data uji sudah diperbaiki.
5. Sembunyikan tab Sabtu di admin Jadwal dan baris SABTU di Guru Piket untuk sekolah 5 hari (ditunda).
6. Label "Program Keahlian"/"Umum" di SMA belum diubah (butuh persetujuan Romo).
7. ~~Kartu Kabupaten dan Provinsi selalu "Sekolah (0)"~~ **Selesai 16 Okt** (`7d7c9f1`, `manage-region` v14).
   Pada dua kartu itu daftar sekolah sengaja baca-saja; penghubungan hanya dari kartu sekolah (tab Sekolah).
8. Sekolah tanpa kecamatan tampil sebagai kelompok "Tanpa kecamatan" (kabupaten) atau "Tanpa kabupaten"
   (provinsi) dengan nilai sentinel nol pada `p_kelompok`; sudah diuji di PGlite saja.
9. Menambah provinsi lain: `node tools/buat-daftar-wilayah.mjs <kode>`, commit, push.
10. Sisa lama dari sesi sebelumnya: templat Jadwal (`admin/template_jadwal_sip_smk_v2.xlsx` masih statis
    SMK dan memuat data sekolah nyata di repo publik); templat Guru Wali; istilah "Kaprodi/Jurusan" di
    portal guru dan TU; SMA masih berlangkah Program; bug pola `auth.uid()` ke kolom FK pada fungsi
    perangkat ajar (fitur disembunyikan); CHECK SKIP lama (7 F2, 16, 17 F7).

## 8. Aturan kerja (wajib)

- **Izin:** Romo memberi izin tetap untuk `supabase db push --linked --yes`, `supabase functions deploy
  manage-region`, dan `git push` pada sesi ini, tetapi pengaman izin sistem (auto mode) **kadang menolak**
  (deploy, `db push`, dan pembacaan `auth.users` produksi). Bila ditolak: **jangan mengakali**;
  jelaskan dan minta Romo menjalankan atau menambah aturan izin Bash. Tanpa perintah baru dari Romo,
  jangan menjalankan deploy atau push untuk hal yang belum ia setujui.
- **Urutan pemasangan:** migrasi database dulu, lalu fungsi edge, baru tampilan (`git push`). Salah
  urutan dapat merusak dasbor yang sedang dipakai.
- Laporkan jujur: bedakan "terbukti di sistem nyata", "dieksekusi dari kode", dan "hanya dibaca". Akui
  kesalahan sendiri (sesi ini dua kali mendorong kode rusak; lihat bagian 9).
- Jawab dalam bahasa Indonesia, ringkas; tabel bila membandingkan. Romo menyukai tampilan sederhana.
- Tindakan menghapus data: tunjukkan targetnya dulu. Jangan menekan Simpan atau Hapus di data uji yang
  masih dipakai Romo tanpa menyebutkannya.
- Jangan membuka atau menyalin dokumen dari repo SIP SMK. Bila menemukan kata "AASF", jangan disentuh.
- Memutus atau menyetujui **persetujuan berbagi** tidak boleh dilakukan lewat SQL atau skrip; itu hak
  kepala sekolah.

## 9. Jebakan alat yang sudah terbukti

- **Shell:** perintah dengan `$(...)` atau `${...}` di dalam string berkutip ganda diperluas oleh bash.
  Tulis skrip Node dengan alat Write (atau heredoc `<<'EOF'` berkutip tunggal) lalu jalankan `node`.
  Selalu jalankan `node --check <salinan .mjs>` pada berkas JS yang diubah **sebelum push**; sesi ini dua
  kali kode rusak ter-push (`$(tableId)` dimakan shell; deklarasi `const jenjangs` tertimpa). Muat ulang
  situs live dan periksa segera setelah push.
- **Commit:** pesan lewat berkas (`git commit -F`), bukan `-m`; di PowerShell gunakan `Set-Content
  -Encoding utf8`. Peringatan "LF will be replaced by CRLF" tidak berbahaya. Git Bash dan PowerShell dapat
  berbeda akses izin; satu kali pengaman memblokir `git status` di Bash tetapi tidak di PowerShell.
- **Akhir baris:** sebagian berkas CRLF; `grep` menyembunyikan `\r`. Periksa dengan
  `node -e "...includes('\r\n')"` sebelum mengedit. `superadmin/js/dashboard.js` dan `kecamatan/*` LF.
- **PGlite** butuh `@electric-sql/pglite`: salin folder `node_modules\@electric-sql` dari
  `D:\ribuan_pengguna\CLAUDE\SIP SMK\node_modules` (baca saja) ke folder sementara di luar repo, salin
  juga `tests/region-layer.mjs`, lalu jalankan dari sana dengan `SIP_ROOT="D:/ribuan_pengguna/CLAUDE/SIP
  Kecamatan"`. Bila muncul `Fatal process out of memory: Zone`, memori komputer habis: restart komputer.
- **Basis data:** `supabase db query --linked -f <berkas.sql>` hanya mengembalikan hasil **pernyataan
  terakhir**; satu file satu SELECT. `db query` berjalan langsung (bukan dry-run). Uji aman: bungkus dalam
  `BEGIN; ...; DO $$ ... RAISE EXCEPTION 'HASIL ...' $$;` agar semuanya dibatalkan otomatis.
  `supabase db dump` butuh Docker (tidak ada). `supabase db push --linked --yes` menerapkan migrasi.
- **Fungsi edge:** `deno check --no-lock supabase/functions/manage-region/index.ts` untuk pemeriksaan
  tipe; deploy dengan `supabase functions deploy manage-region --no-verify-jwt`. Fungsi yang belum
  dideploy tampil sebagai "Failed to fetch".
- **Peramban (Claude in Chrome):**
  - Setiap sesi Claude punya grup tab sendiri; tab sesi lama tidak terlihat. Panggil
    `tabs_context_mcp` dengan `createIfEmpty: true`, lalu buat tab baru.
  - Muat ulang paksa (Ctrl+Shift+R) pada portal superadmin **menghapus sesi**; minta Romo login lagi.
  - Setelah push, tunggu 1–2 menit (cek `curl` pada berkas live) lalu **muat ulang paksa**: modul JS di-cache.
  - Klik mouse sering gagal ("timed out") pada jendela sempit; gunakan `element.click()` lewat
    `javascript_tool`. Ganti `window.confirm` dan `window.alert` dengan fungsi yang mengembalikan nilai
    sebelum menekan tombol, agar peramban tidak terkunci.
  - `javascript_tool` berhenti pada 45 detik per panggilan: pecah perulangan panjang menjadi beberapa
    panggilan. Bila tab tak merespons setelah skrip yang menimpa `URL.createObjectURL`, tutup tab dan
    buka tab baru (sesi tetap, karena penyimpanan per peramban).
  - Portal guru menyimpan **satu sesi per peramban**; parameter `?school=` dikalahkan oleh sesi yang
    tersimpan. Untuk berpindah sekolah: Keluar dulu, atau pakai jendela penyamaran.
  - Menangkap unduhan CSV tanpa menyimpan: ganti `URL.createObjectURL` dan `HTMLAnchorElement.prototype.click`
    sementara, baca `blob.text()`, lalu kembalikan. Tombol unduh juga mereset pengingat 30 hari di peramban.
- **Token Supabase:** Romo membuatnya sementara, menjalankan uji sendiri di PowerShell, lalu mencabutnya.
  `tests/tenant-isolation.mjs` membaca `SUPABASE_ACCESS_TOKEN` dari lingkungan; 403 pada `api-keys`
  berarti izin token kurang. Hasil `pass` yang turun mendadak bisa berarti pembatasan laju (429).

## 10. Alat dan uji (rujukan cepat)

| Berkas | Fungsi | Butuh |
|---|---|---|
| `tests/region-layer.mjs` | Perilaku lapisan wilayah di PGlite (baseline + semua migrasi wilayah), 62 uji | PGlite |
| `tests/tenant-isolation.mjs` | 20 pemeriksaan isolasi pada basis data **live** | `SUPABASE_ACCESS_TOKEN` |
| `tests/manage-region-live.mjs` | `ensure_region`, reset sandi, hapus wilayah (aturan baru: selalu boleh) | `SUPERADMIN_KEY` |
| `tests/cadangan-lib.mjs` | Ekspor lalu pulih di PGlite | PGlite |
| `tools/cadangan-data.mjs` | Cadangan data skema `public` ke folder di luar repo | CLI Supabase login |
| `tools/pulihkan-data.mjs` | Pulih ke proyek uji (pengaman sasaran) | CLI Supabase login |
| `tools/buat-daftar-wilayah.mjs` | Membuat daftar wilayah provinsi dari sumber | jaringan |

## 11. Peta kode wilayah (supaya tidak mencari)

| Hal | Letak |
|---|---|
| Fungsi agregat wilayah | `supabase/migrations/20261016020000_region_wib.sql` (versi terbaru `fn_region_overview_range`, `fn_region_overview`, `fn_region_school_trend_range`, `fn_hari_ini`); `20261016010000_region_group.sql` memuat definisi kelompok |
| Parameter fungsi rentang | `p_from`, `p_to`, `p_kelompok uuid` (NULL = tingkat atas; nol-uuid = sekolah tanpa kecamatan/kabupaten), `p_daftar_penuh` (true = perilaku lama, dipakai `fn_region_overview(p_days)`) |
| Fungsi edge wilayah | `supabase/functions/manage-region/index.ts` (aksi `list`, `ensure_region`, `delete_region`, `add_staff`, `remove_staff`, `reset_staff_password`, `assign_school`) |
| Dasbor pegawai | `kecamatan/index.html`, `kabupaten/index.html`, `provinsi/index.html` (tiga halaman masuk, identik kecuali judul/tingkat/jalur), `kecamatan/js/app.js`, `kecamatan/js/daftar.js`, `kecamatan/css/kecamatan.css` |
| Portal superadmin | `superadmin/index.html`, `superadmin/js/dashboard.js` (fungsi `isiKotakWilayah`, `loadRegions`, `tampilkanKredensialPegawai`) |
| Persetujuan berbagi (kepala sekolah) | `guru/dashboard.html`, `guru/js/dashboard.js` (kartu "Berbagi Ringkasan ke Wilayah") |
| Daftar wilayah resmi | `superadmin/data/index.json`, `superadmin/data/wilayah-riau.json` |

## 12. Hal yang jangan diulang

- Jangan menyelidiki ulang yang sudah terbukti (bagian 6) atau mengubah keputusan Romo (bagian 4).
- Jangan membangun ulang rancangan induk-anak antar wilayah; sudah dibuang (migrasi `20261015040000`).
- Jangan menambah ekspor/catatan akses/audit superadmin tanpa Romo mengubah keputusannya (bagian 4 butir 10).
- Jangan mengembalikan formulir wilayah "ketik nama", dropdown wilayah di formulir pendaftaran sekolah,
  atau aksi `create_region`.
- Jangan menaruh `docs/` atau cadangan data ke repo publik.
- Jangan mengubah persetujuan berbagi lewat SQL atau skrip.

## 13. Kolaborasi dengan Codex (ditambahkan 16 Okt, akhir sesi)

Romo memakai Claude Code dan Codex di VS Code yang sama. Claude memicu Codex lewat shell (jalur B);
aturan lengkap di `docs/kolaborasi/PROTOKOL.md`; pekerjaan pertama yang dirancang untuk alur ini ada di
`docs/ARSITEKTUR-ISOLASI.md` bagian 13. Ringkas:

- Codex bekerja di worktree `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-codex`, cabang `codex/<tugas>`,
  tidak pernah di folder utama. Claude meninjau diff dan menjalankan `node --check` / `deno check` sendiri.
- Prompt dikirim lewat **stdin** (PowerShell 5.1 memecah argumen berkutip): `$t | codex.exe exec
  --sandbox workspace-write -C <worktree> -`. Biner: `codex.exe` di folder ekstensi VS Code
  `openai.chatgpt-*` (tidak ada di PATH).
- Codex tidak dapat menulis metadata git worktree (`index.lock` ditolak) dan tidak dapat menjalankan `deno`;
  Claude yang mengomit dan memeriksa tipe.
- **Deploy fungsi edge dijalankan Romo sendiri** di terminal (`supabase functions deploy manage-region
  --no-verify-jwt`): pengaman izin sistem menolak deploy produksi dari Claude. `git push` Claude boleh
  setelah Romo menyetujui. Jangan mengakali penolakan.
- Bila perubahan menyentuh tampilan dan fungsi edge sekaligus, pikirkan urutan: tampilan baru dengan server
  lama harus aman. Pada perbaikan kartu wilayah, push dulu lalu deploy.
- Pemeriksaan peramban: sesi superadmin tidak ikut ke tab baru; Romo login sendiri di tab yang dibuka
  Claude, dan setelah push muat ulang paksa (itu menghapus sesi, login ulang).
