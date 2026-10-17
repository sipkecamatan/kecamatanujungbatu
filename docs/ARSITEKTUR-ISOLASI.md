# Arsitektur isolasi: SIP lapisan wilayah (revisi 2, 16 Okt 2026)

Status: **rancangan disetujui Romo, belum diimplementasi.** Berkas lokal (`docs/` tidak terlacak git). Tanpa rahasia.
Dokumen ini berdiri sendiri dan kini menjadi rujukan utama untuk isolasi dan cakupan wilayah. Dokumen lama
`SIP-sumber-kebenaran-tunggal.md` (SSoT) **dihapus Romo pada 16 Okt 2026**; bagian yang selaras sudah dimasukkan di
sini. Label "SSoT" di bawah hanya menunjukkan asal sebuah butir, bukan rujukan ke berkas yang masih ada.

> **Dokumen ini hidup, bukan hukum tetap.** Isinya dapat dan boleh berubah mengikuti keadaan nyata: hasil uji,
> temuan di sistem live, keterbatasan teknis, dan keputusan baru Romo. Bila kenyataan berbeda dengan tulisan di
> sini, **kenyataan yang dibuktikan yang menang**, lalu dokumen ini diperbaiki dengan tanggal dan alasannya. Bagian
> "keadaan sekarang" harus selalu mencerminkan sistem yang terbukti, dan bagian "rancangan" ditandai sebagai
> rancangan sampai terbukti. Perubahan dicatat di bagian Riwayat revisi di bawah.

## Dokumen terkait

| Dokumen | Peran |
|---|---|
| `docs/PANDUAN-SEKOLAH-UJI-BARU.md` | Langkah Romo menambah satu sekolah uji (SMK Uji 3) yang tampil di kecamatan dan provinsi |
| `docs/ARSITEKTUR-ISOLASI.md` (ini) | Rancangan dan aturan isolasi dan cakupan wilayah; rujukan utama topik itu |
| `docs/HANDOFF-SESI-2026-10-15.md` | Keadaan sistem, koordinat, keputusan Romo secara umum, jebakan alat, pekerjaan terbuka. Mulai dari sini di sesi baru |
| `docs/kolaborasi/PROTOKOL.md` | Cara Claude memicu Codex, larangan, batasan, dan pemasangan ke produksi; dipakai untuk mengerjakan bagian 13 |
| `docs/PANDUAN-LAPANGAN.md` | Tanya jawab operator untuk petugas wilayah dan sekolah; harus sejalan dengan dokumen ini |
| `docs/PANDUAN-CADANGAN.md` | Cadangan, pemulihan, dan perawatan ruang basis data |

Bila dua dokumen berbeda, urutan pegangan: kenyataan yang terbukti di sistem, lalu dokumen ini untuk isolasi, lalu
handoff untuk hal lainnya.

## 1. Tujuan

Sekolah A yang terhubung ke suatu wilayah hanya dapat dilihat oleh pegawai wilayah itu. Tidak ada pihak lain yang
dapat melihatnya. Berlaku sendiri-sendiri untuk tiga tingkat:

| Sekolah A terhubung ke | Yang dapat melihat | Yang tidak dapat melihat |
|---|---|---|
| Kecamatan X | pegawai Kecamatan X | semua pihak lain |
| Kabupaten Y | pegawai Kabupaten Y | semua pihak lain |
| Provinsi Riau | pegawai Provinsi Riau | semua pihak lain |

Tingkat saling tertutup, tanpa pewarisan.

## 2. Dasar dari SSoT (keadaan sekarang)

### 2.1 Definisi wilayah (SSoT bagian 1)
Wilayah adalah **penanda cakupan sekolah**, bukan penanda komando. Kecamatan, kabupaten, dan provinsi tidak
membentuk rantai atasan-bawahan, tidak saling memiliki, tidak saling mengatur. Hubungannya hanya lewat sekolah.
Kata "tingkat" hanya berarti jenis wilayah administrasi.

| | Kecamatan | Kabupaten / Kota | Provinsi |
|---|---|---|---|
| Isian pada sekolah | `schools.region_id` | `schools.kabupaten_id` | `schools.provinsi_id` |
| Persetujuan kepala sekolah | `share_with_region` | `share_kabupaten` | `share_provinsi` |
| Jenis di data | `KECAMATAN` | `KABUPATEN` (mencakup kota) | `PROVINSI` |
| Kode resmi | 7 digit (1407022) | 4 digit (1407) | 2 digit (14) |
| Wajib diisi pada sekolah | tidak | tidak | tidak |

Ketiganya berdiri sendiri, diisi per sekolah dari daftar resmi, dan disetujui terpisah oleh kepala sekolah.

### 2.1a Definisi pegawai wilayah (asal: SSoT lama, bagian 1)
**Pegawai wilayah adalah akun yang ditugaskan pada satu wilayah untuk melihat angka agregat sekolah di wilayah itu.**
- Akun Supabase Auth tanpa baris di `public.users`, terdaftar di `region_staff` pada satu wilayah.
- **Hanya baca:** tidak dapat mengubah data sekolah apa pun. Satu-satunya yang dapat ia ubah adalah kata sandinya sendiri.
- Hanya menerima angka agregat (tanpa nama dan ID siswa), dari sekolah yang memenuhi aturan visibilitas (bagian 3).
- Dapat mengunduh angka yang tampil sebagai CSV, dengan aturan privasi yang sama seperti layar.
- Dapat ditambah dan dihapus bebas, tanpa keterikatan: tidak ada jumlah minimum per wilayah, dan tidak terkait dengan
  sekolah maupun pegawai lain. Menghapus pegawai langsung memutus aksesnya dan tidak memengaruhi sekolah,
  persetujuan, atau pegawai lain.
- Aturan akun lain (satu wilayah, wajib ganti kata sandi, tidak boleh ganda dengan pengguna sekolah): bagian 2.4.

### 2.2 Sekolah yang tampil (asal: SSoT lama)
Sekolah **aktif**, dan salah satu: `region_id` = wilayah pegawai **dan** `share_with_region`; atau `kabupaten_id` =
wilayah pegawai **dan** `share_kabupaten`; atau `provinsi_id` = wilayah pegawai **dan** `share_provinsi`.

### 2.3 Jalur data (asal: SSoT lama)
- Dasbor wilayah hanya membaca lewat fungsi agregat `SECURITY DEFINER`; tidak ada kueri langsung ke tabel sekolah.
- RLS tabel sekolah menolak akses langsung: `fn_current_school_id()` bernilai NULL bagi pegawai wilayah.
- `regions`, `region_staff`, `region_sharing_log`: semua hak dicabut dari `anon` dan `authenticated`.
- `EXECUTE` fungsi agregat dicabut dari `anon` dan `PUBLIC`; pemanggil tanpa baris `region_staff` ditolak (`42501`).
- Tren sekolah di luar cakupan, tanpa persetujuan, atau tak dikenal mengembalikan hasil kosong yang sama.

### 2.4 Batas yang sengaja (SSoT bagian "Batas yang sengaja")
- Sekolah tampil lewat dua langkah: dicatat pada wilayah oleh superadmin, lalu dibagikan kepala sekolah per tingkat.
  Pencatatan saja tidak membuat data terlihat. Superadmin tidak pernah menyetujui atas nama kepala sekolah.
- Satu identitas tidak boleh sekaligus pegawai wilayah dan pengguna sekolah (pemicu `fn_region_staff_no_dual`).
- Satu pegawai terikat satu wilayah (`region_staff.auth_user_id` kunci utama); tidak ada pindah wilayah, tidak ada
  ubah nama atau email (hapus lalu daftarkan ulang).
- Akun pegawai baru atau baru direset wajib mengganti kata sandi sementara; ditegakkan di server (`must_change_password`).
- Reset kata sandi tidak memutus sesi yang sedang terbuka; bila akun diduga disalahgunakan, hapus lalu daftarkan ulang.
- Wilayah selalu dapat dihapus: sekolah dilepas dari penanda itu dan persetujuan tingkat itu direset; pegawai
  wilayah itu dihapus beserta akunnya. Tiap penanda berdiri sendiri: memutus satu tingkat tidak menyentuh yang lain.
- Persetujuan dipegang kepala sekolah (peran KEPSEK); kepala sekolah baru mewarisi persetujuan lama dan dapat
  mengubahnya kapan saja. Bawaan: tidak dibagikan. Tiap perubahan tercatat di `region_sharing_log`.

### 2.5 Ambang privasi (SSoT bagian 3)
| Aturan | Nilai |
|---|---|
| Total wilayah | tampil bila >= 3 sekolah dibagikan |
| Subtotal jenjang | tampil bila jenjang itu >= 2 sekolah |
| Kehadiran (%) | tampil bila cakupan input >= 80%; di bawahnya `DATA_BELUM_MEMADAI`, kosong dan keluar dari total |
| Keterlambatan dan izin keluar | hitungan 1-4 disembunyikan ("< 5"); 0 dan >= 5 tampil |
Angka per sekolah tetap tampil karena sekolah sudah menyetujui berbagi. Tanpa nama dan tanpa ID siswa.

### 2.6 Diputuskan diabaikan oleh Romo (SSoT bagian 5)
Catatan akses wilayah, pembatasan percobaan kunci superadmin, perbandingan kunci waktu-konstan, jejak audit
tindakan superadmin, CORS terbuka, kata sandi awal tampil di layar. Tidak dikerjakan kecuali Romo berubah pikiran.

## 3. Aturan visibilitas (satu-satunya)

Sekolah A terlihat oleh wilayah W pada tingkat T bila dan hanya bila: (1) A **aktif**; (2) A bertanda W pada
tingkat T; dan (3) kepala sekolah A menyetujui berbagi pada tingkat T. Persetujuan tingkat lain tidak berpengaruh.

## 4. Yang boleh diketahui pegawai wilayah (keputusan Romo, 16 Okt 2026)

Pegawai wilayah hanya mengenal **sekolah**: nama sekolah, jenjang, dan angka agregatnya. Mereka tidak melihat:
- penanda wilayah sekolah mana pun (kecamatan, kabupaten, provinsi);
- pengelompokan menurut wilayah lain;
- fakta bahwa sekolah itu juga terhubung ke wilayah lain;
- persetujuan atau penghubungan pada tingkat selain tingkatnya sendiri.

Contoh: pegawai Kabupaten Rokan Hulu melihat "SMK Negeri 1 Ujung Batu", "SMP Negeri 4 Tandun", dst., tanpa tulisan
kecamatan. Nama sekolah dianggap milik sekolah itu sendiri.

## 4a. Absensi siswa dan tampilannya (kebutuhan Romo, 16 Okt 2026)

**Asal data.** Sekolah, melalui **guru yang hadir di kelas**, melakukan absensi pada siswa. Tiap siswa pada sesi
pelajaran diberi satu dari **empat** status kehadiran (enum `attendance_status`; guru memilihnya di portal guru):

| Status | Arti |
|---|---|
| **Hadir** | siswa hadir di kelas |
| **Sakit** | siswa tidak hadir karena sakit |
| **Izin** | siswa tidak hadir dengan izin (guru dapat menulis catatan) |
| **Alpa** | siswa tidak hadir tanpa keterangan |

**Yang diminta Romo:** status kehadiran **tampil di dasbor kepala sekolah dan di dasbor pegawai wilayah**. Romo menyebut
tiga (hadir, sakit, alpa); setelah dicek bahwa sistem punya empat status dan guru memakai Izin, **keputusan Romo (16 Okt
2026): keempatnya ditampilkan**, Izin tidak dilebur dan tidak disembunyikan.

**Aturan yang tetap berlaku (turunan dari bagian 2 sampai 4):**
- Pegawai wilayah hanya menerima **hitungan atau persentase agregat** per status, tanpa nama dan ID siswa, dan hanya dari
  sekolah yang memenuhi aturan visibilitas (bagian 3). Pegawai wilayah tidak pernah melihat siapa yang sakit atau alpa.
- Kepala sekolah melihat sekolahnya sendiri saja (isolasi per sekolah, lapisan 4). Apakah kepala sekolah juga melihat
  rincian per siswa atau hanya agregat adalah soal sekolah, di luar rancangan isolasi wilayah ini.
- Angka per sekolah tetap tampil karena sekolah sudah menyetujui berbagi; ambang pada bagian 2.5 (total >= 3 sekolah,
  subtotal jenjang >= 2 sekolah, cakupan input >= 80%) tetap berlaku pada total dan subtotal.

**Keadaan sebelum pekerjaan ini (diperiksa 16 Okt 2026):** dasbor kepala sekolah (`fn_kepsek_monitoring`, hanya di migrasi
baseline) hanya menampilkan "% siswa hadir" dan "X / Y siswa hadir" (siswa unik yang punya minimal satu catatan hadir);
dasbor wilayah hanya satu angka "Kehadiran (%)" = hadir dibagi seluruh catatan absensi.

**Keputusan Romo, 16 Okt 2026:**
1. **Empat status** ditampilkan: Hadir, Sakit, Izin, Alpa.
2. **Satuan = catatan absensi** (baris `attendance`, yaitu siswa x sesi), bukan jumlah siswa; tampilan memberi keterangan.
3. **Pegawai wilayah:** persentase per status dari seluruh catatan absensi (denominator sama dengan Kehadiran (%) yang ada;
   hanya sekolah berstatus data MEMADAI, cakupan input >= 80%). **Hitungan kecil disembunyikan:** bila jumlah catatan
   Sakit/Izin/Alpa berada di antara 1 dan 4 (pada sekolah, total, atau jenjang), ditampilkan "< 5"; 0 tetap 0%.
4. **Kepala sekolah:** sekolahnya sendiri, persentase **dan** jumlah catatan per status, tanpa penyembunyian (data sekolah
   sendiri; usulan Claude, **dikonfirmasi Romo 16 Okt 2026**).

**Risiko sisa yang diketahui:** karena persentase dibulatkan ke bilangan bulat dan satu sekolah punya ribuan catatan, 1-4
catatan nyaris selalu membulat ke 0%, sehingga penyembunyian lebih berfungsi sebagai aturan prinsip daripada pelindung
pada sekolah besar; pada sekolah atau periode yang sangat kecil (ratusan catatan), selisih dari persentase lain dapat
membantu menebak hitungan yang disembunyikan. Diterima; dicatat agar tidak dianggap mutlak.

**Status pekerjaan:** dikerjakan Codex di cabang `codex/status-absensi` (migrasi `20261016040000_attendance_breakdown.sql`,
perubahan dasbor wilayah dan dasbor kepala sekolah, `tests/status-absensi.mjs`); **ditinjau Claude** (migrasi dibaca penuh;
fungsi kepala sekolah identik dengan baseline kecuali key `rincian_absensi`; fungsi wilayah murni penambahan; semua uji
dijalankan ulang: status-absensi 10, region-layer 62, isolation-matrix AMAN 210/BOCOR 0, daftar-sekolah 14,
halaman-tingkat 6). **Terpasang di produksi 16 Okt 2026** (migrasi `20261016040000` dipasang Romo; `main` `2e2ae15`).
**Terbukti di situs live (akun provinsi):** kolom Hadir/Sakit/Izin/Alpa (%) pada tabel sekolah dan subtotal jenjang; kartu
"Rincian kehadiran" (Hadir 95% · Sakit 2% · Izin 1% · Alpa 1%); angka per sekolah berjumlah 100%; sekolah tanpa data (SMK Uji 3)
menampilkan "—"; layar 400 px: tiap sekolah menjadi kartu berlabel lengkap; halaman tidak meluap (tabel lebar menggulir di
dalam kontainernya). **CSV (diperiksa live 16 Okt 2026, akun kabupaten):** bagian TOTAL, SUBTOTAL JENJANG, SEKOLAH dengan kolom Hadir/Sakit/Izin/Alpa (%); angka cocok dengan
dasbor (970/794/580/163); tanpa bagian kelompok dan tanpa kata sensitif. **Dua cacat tampilan ditemukan dan diperbaiki** (`2c0aa27`, `kecamatan/js/format.js`,
`tests/format-status.mjs` 7 uji): (1) hitungan kecil tampil "—" bukan "< 5" karena tampilan memeriksa `absen_kecil.includes('sakit_pct')` padahal server mengirim
nama status `"sakit"`; (2) CSV menulis "95%" sebagai teks, tidak seragam dengan kolom Cakupan input; kini angka. Uji PGlite server tidak menangkap (1) karena hanya
memeriksa JSON server; uji format baru gagal bila logika lama dikembalikan. Setelah perbaikan, CSV live berupa angka dan "< 5" tertutup uji (data uji tidak punya hitungan 1-4,
jadi "< 5" belum teramati di layar nyata).
**Dasbor kepala sekolah (diperiksa 16 Okt 2026, kepala SMA Uji 1, 17 Sep-16 Okt):** "Hadir 95.1% (28902) · Sakit 2.0% (596) ·
Izin 1.7% (519) · Alpa 1.2% (360)" dari 30377 catatan; jumlahnya tepat 30377 dan **cocok dengan dasbor wilayah** untuk sekolah
yang sama (95/2/2/1 setelah pembulatan; terlambat 98 dan izin keluar 25 sama). Periode 7 hari: 6416 catatan, 6002+185+133+96.
Sekolah tanpa catatan (SMK Uji 3): "Belum ada catatan absensi pada periode ini", kartu lain tidak rusak. Halaman portal guru
yang sudah terbuka memakai versi lama dari cache sampai dimuat ulang paksa.
**Belum terbukti live:** tampilan "< 5" (data uji tidak punya hitungan 1-4; terbukti di PGlite), akun kecamatan dan
kabupaten (kode sama), dan unduhan CSV baru.
Definisi angka ("catatan absensi", empat status) perlu masuk daftar definisi setelah terpasang.

## 5. Prinsip rancangan

1. Tertutup per tingkat, tanpa pewarisan.
2. Tolak secara bawaan.
3. **Satu pintu:** aturan bagian 3 didefinisikan di satu tempat. Sekarang penyaringnya disalin ke beberapa fungsi
   (`fn_region_overview`, `fn_region_school_trend`, dan varian rentangnya); itulah yang disatukan.
4. Identitas dari server (akun yang login), tidak pernah dari data kiriman peramban.
5. **Keluaran minimal:** fungsi untuk pegawai wilayah hanya mengembalikan kolom yang boleh diketahui (bagian 4).
   Kolom wilayah tidak ada di hasil, bukan sekadar disembunyikan di tampilan.
6. Penghubungan praktis tetap (pemindahan wilayah tidak dirancang; Romo: hampir mustahil). Bila diubah atau diputus,
   persetujuan tingkat itu kembali "tidak" (sudah demikian di SSoT).

## 6. Lapisan

| Lapisan | Tugas | Keadaan |
|---|---|---|
| 1. Data sekolah | Tiga penanda dan tiga persetujuan per sekolah | sudah ada |
| 2. **Fungsi visibilitas** | Satu fungsi, dihitung langsung dari penanda, status aktif, dan persetujuan, sehingga tidak bisa basi. Tabel turunan hanya bila pengukuran membuktikan perlu | **baru** |
| 3. Akses pegawai wilayah | Tanpa akses tabel mentah; hanya fungsi agregat yang memakai fungsi visibilitas dan mengembalikan kolom minimal | tabel mentah tertutup sudah ada; keluaran minimal **baru** |
| 4. Akses pengguna sekolah | Isolasi per sekolah di tingkat baris (RLS) | sudah ada; 20 pemeriksaan belum diulang setelah migrasi 15-16 Okt |
| 5. Superadmin | Fungsi edge dengan kunci layanan | sudah ada |
| 6. Anonim | Semua hak dicabut | sudah pada fungsi wilayah |

## 7. Dampak keputusan "tanpa label wilayah" (disetujui Romo)

Membalik keputusan dasbor bertingkat 16 Okt (handoff bagian 4 butir 5; dasbor kabupaten dan provinsi yang dikelompokkan
sudah live sejak 16 Okt dan akan diganti).

| Hal | Sekarang | Setelah revisi |
|---|---|---|
| Dasbor kabupaten | Baris per kecamatan, lalu sekolah | Daftar sekolah datar |
| Dasbor provinsi | Per kabupaten, kecamatan, sekolah | Daftar sekolah datar |
| Dasbor kecamatan | Daftar sekolah | Tetap |
| Kelompok "Tanpa kecamatan/kabupaten" | Ada | Dihapus |
| CSV | Bagian Kabupaten, Kecamatan, Sekolah | Hanya bagian Sekolah |
| Total dan subtotal jenjang | Dari seluruh sekolah terlihat | Tetap (ambang 2.5 tetap) |
| `fn_region_overview_range` dengan `p_kelompok` | Ada | Disederhanakan atau dihapus |

**Keputusan Romo:** daftar datar dilengkapi **pencarian nama dan pengurutan**. Pencarian dan urutan tidak boleh
memuat atau menyaring menurut wilayah, dan hasil pencarian hanya dari sekolah yang terlihat. Masih perlu diputuskan
saat implementasi: urutan bawaan (nama A-Z) dan perlu tidaknya halaman (provinsi dapat mencapai 1.376 sekolah).

## 8. Kebocoran tidak langsung yang ditutup

- Angka total dan subtotal hanya dari sekolah terlihat.
- Pesan galat untuk "tidak ada" dan "tidak boleh" sama persis (sudah pada tren; diperiksa pada fungsi lain).
- CSV mengikuti aturan yang sama, tanpa kolom wilayah.
- Cache peramban (`sw.js`, `offline.html`) tidak menyimpan data wilayah lintas akun.
- Jalur lain ke database (realtime, penyimpanan berkas, panggilan langsung ke API) ikut diuji.
- Nama sekolah dapat memuat nama kecamatan; dianggap milik sekolah, bukan pelanggaran.
- **Serangan selisih (disempitkan):** karena angka per sekolah memang tampil setelah disetujui, perubahan total akibat
  sekolah baru menyetujui bukan kebocoran. Yang masih perlu diperiksa hanya nilai yang **sengaja disembunyikan
  ambang** (hitungan 1-4, sekolah di bawah 80% cakupan): jangan sampai dapat disimpulkan dari selisih total.

## 9. Pembuktian

1. **Matriks serangan:** aktor (pegawai kecamatan lain, kabupaten lain, provinsi lain, guru sekolah lain, orang tua
   sekolah lain, tanpa login) x cara melihat. Tiap janji bagian 1, 3, dan 4 punya sel uji yang bisa gagal.
2. **Uji bentuk keluaran:** hasil fungsi pegawai wilayah tidak memuat kolom atau nilai penanda wilayah, termasuk pada galat.
3. Dua tingkat uji: PGlite (tiap perubahan) dan basis data nyata proyek uji (berkala).
4. **Penjaga regresi:** gagal bila ada fungsi baru menyentuh data sekolah tanpa memakai fungsi visibilitas.
5. Skala 1.376 sekolah (sintetis, proyek uji, bukan produksi), **sesudah** matriks serangan lulus.
6. Kebocoran dilaporkan apa adanya, tidak diperbaiki diam-diam.
Pola uji yang sudah ada (SSoT): `tests/tenant-isolation.mjs` (CHECK 19 dan 20), `tests/region-layer.mjs` (62 uji PGlite).

## 9a. Hasil matriks serangan terhadap keadaan sekarang (16 Okt 2026, terbukti dijalankan)

Skrip: `tests/isolation-matrix.mjs` pada cabang `codex/matriks-serangan` (belum digabung ke `main`; dikerjakan Codex,
dijalankan ulang dan ditinjau Claude; hasil dua kali identik). Lingkungan: PGlite lokal, data sintetis, tanpa produksi.
Hasil: **AMAN 190, BOCOR 20, TIDAK TERUJI 9**; kontrol positif lulus (pegawai yang berhak melihat sekolah yang benar).

**Yang terbukti aman:** pembacaan tabel langsung oleh pegawai wilayah dan akun sekolah lain (M5, 10 sel); tren sekolah
untuk sekolah yang tidak berhak, identik dengan "tidak ada" (M4, 124 sel); galat seragam (M9); nama sekolah dan siswa
tidak bocor lewat fungsi agregat (M1); pengubahan persetujuan oleh pihak tak berhak ditolak (M6). Aturan visibilitas
dasar (aktif + penanda cocok + persetujuan tingkat itu) bekerja pada semua skenario fixture.

**Kebocoran: 20 sel, tiga penyebab:**

| # | Penyebab | Sel | Sifat |
|---|---|---|---|
| 1 | Pengelompokan dasbor kabupaten/provinsi memuat nama dan `region_id` kecamatan/kabupaten. Pegawai provinsi bahkan melihat nama kabupaten sekolah yang kabupatennya **tidak menyetujui** (mis. S_D) | M2 x3, M8 x2 | Melanggar aturan target bagian 4; sudah diputuskan diganti daftar datar |
| 2 | Parameter kelompok (`p_kelompok`) menerima uuid wilayah mana pun dan mengembalikan `kelompok_nama` wilayah itu, termasuk wilayah yang tak ada hubungannya | M3 x6, M10 x6 | Satu penyebab. Tanpa data sekolah (daftar sekolah kosong), tetapi mengungkap nama wilayah dan menjadi uji keberadaan uuid. Keparahan rendah: nama wilayah adalah data publik dan uuid harus diketahui; tetap melanggar "tidak ada hubungan" |
| 3 | `jumlah_sekolah_terdaftar` menghitung sekolah yang terhubung tetapi tidak disetujui atau nonaktif (mis. KX: tampil 2, terdaftar 4) | M7 x3 | Membocorkan keberadaan dan jumlah sekolah yang tidak boleh terlihat. Uji lama `region-layer.mjs` justru menegaskan perilaku ini sebagai disengaja ("terdaftar 5, SMP Tutup tidak tampil") |

**Tidak teruji (9):** superadmin (berjalan lewat fungsi edge dengan kunci layanan, bukan di PGlite); M7 dan M10 untuk
guru, kepala sekolah, orang tua, dan anon (fungsi itu hanya untuk pegawai wilayah); kepala sekolah mengubah
persetujuan sekolah lain (fungsi tidak menerima `school_id`; ia hanya mengubah sekolah si pemanggil, jadi aman menurut
rancangan, tetapi targetnya tidak dapat dicoba).

**Yang belum dicakup:** jalur API langsung di luar fungsi dan tabel (realtime, storage, endpoint lain), dan skala.

### 9b. Hasil setelah perbaikan langkah 2 (16 Okt 2026; terbukti di PGlite, BELUM di produksi)

Cabang `codex/visibilitas-tunggal` (komit di atas `codex/matriks-serangan`), migrasi `20261016030000_region_visibility.sql`:
fungsi visibilitas tunggal `fn_region_sekolah_terlihat`, keluaran daftar datar tanpa label wilayah, `p_kelompok`
diabaikan, `jumlah_sekolah_terdaftar` disamakan dengan jumlah terlihat. Dijalankan ulang oleh Claude: `region-layer.mjs`
62 lulus; `isolation-matrix.mjs` **AMAN 210, BOCOR 0, TIDAK TERUJI 9**, kontrol positif lulus. Ketiga penyebab bagian 9a
tertutup. Penjaga regresi: uji yang gagal bila fungsi selain empat yang sah memuat nama kolom `share_*`.
Belum dikerjakan: tampilan daftar datar dengan pencarian nama dan pengurutan (langkah 3), pemasangan ke produksi,
uji skala, dan jalur lain (realtime, storage, endpoint langsung).

### 9d. Langkah 2 dan 3 TERPASANG di produksi dan terbukti di situs live (16 Okt 2026)

Migrasi `20261016030000` dipasang Romo (`supabase db push`), lalu `main` di-push (`a0bd198`). Diperiksa di peramban
dengan akun pegawai kabupaten (data uji, 4 sekolah berbagi): tidak ada kartu atau tulisan kelompok/kecamatan; kartu
"Sekolah menampilkan data" = 4; angka cocok dengan sebelumnya (970 siswa, 794 orang tua, 580 terlambat, 163 izin keluar);
pencarian (huruf besar/kecil, spasi ujung, substring, hasil nol) dan lima urutan cocok dengan angka sebenarnya; layar
400 px (dalam bingkai) tidak meluap, kontrol bertumpuk, sekolah menjadi kartu; CSV hanya bagian TOTAL, SUBTOTAL JENJANG,
dan SEKOLAH tanpa kelompok. **Akun provinsi (diperiksa 16 Okt 2026, akun uji "Provinsi Riau"): 3 sekolah** (SMA Uji 1, SMA Uji 2, SMP Uji 1); SMP Uji 2,
yang disetujui kabupaten tetapi tidak provinsi, tidak tampil dan **tidak dapat ditemukan lewat pencarian** nama; jumlah
cocok dengan penjumlahan tiga sekolah (700 siswa, 574 orang tua, 399 terlambat, 106 izin keluar); tanpa label
kecamatan/kabupaten. Ini bukti isolasi per tingkat di sistem nyata.
**Akun kecamatan (diperiksa 16 Okt 2026, "Kecamatan Ujung Batu"): 4 sekolah** (SMA Uji 1-2, SMP Uji 1-2; lima sekolah lain belum
menyetujui tingkat kecamatan); SMK dan SMP Uji 3 tidak tampil dan tidak dapat ditemukan lewat pencarian; angka cocok dengan
akun kabupaten untuk sekolah yang sama. Satu-satunya nama wilayah di halaman adalah nama wilayah pegawai itu sendiri
("Kecamatan Ujung Batu, Kabupaten Rokan Hulu", karena nama di daftar resmi memuat kabupaten induk). Atas keputusan Romo
(16 Okt 2026) tampilan kini memotong nama di koma pertama: judul, baris "Wilayah" di CSV, dan nama berkas hanya memuat
"Kecamatan Ujung Batu" (`3dbc4d5`, terbukti live; hanya tampilan, data wilayah tidak diubah).
**Belum diperiksa:** daftar panjang (tombol "Tampilkan 50 lagi"
tidak terpicu karena hanya 4 sekolah), pesan "Server belum diperbarui", uji skala 1.376 sekolah, dan jalur API lain.

### 9c. Langkah 3 selesai di kode (16 Okt 2026; riwayat; sudah terpasang, lihat 9d)

Cabang `codex/daftar-datar` (di atas `codex/visibilitas-tunggal`): dasbor pegawai berupa daftar sekolah datar dengan
pencarian nama, pengurutan (nama A-Z/Z-A, siswa terbanyak, kehadiran tertinggi/terendah, terlambat terbanyak), tampil
bertahap 50 baris; antarmuka pengelompokan dibuang; CSV hanya bagian Sekolah; logika murni di `kecamatan/js/daftar.js`
(`tests/daftar-sekolah.mjs`, 14 lulus). Ditinjau Claude: `node --check` lolos, semua id elemen yang dipanggil `app.js`
ada di HTML, tidak ada sisa jejak/kelompok. Catatan: pada urutan "Terlambat terbanyak", nilai 1-4 yang disembunyikan
ambang ("< 5") diperlakukan kosong dan jatuh ke akhir. **Urutan pasang: migrasi dulu, baru tampilan** (tampilan baru
dengan server lama menampilkan pesan "Server belum diperbarui", bukan daftar kosong).

### 9e. Alamat dasbor per tingkat (16 Okt 2026, komit `20bcb01`)

Keputusan Romo: `/kecamatan/`, `/kabupaten/`, `/provinsi/` (ejaan baku). Alamat hanya pintu masuk; **tingkat tetap ditentukan
server dari akun** (prinsip 4), jadi tidak ada perubahan keamanan. Akun yang membuka alamat tingkat lain dialihkan lewat
daftar tetap `ALAMAT_TINGKAT` (bukan masukan pengguna). Terbukti live dengan akun kecamatan: membuka `/provinsi/` dan
`/kabupaten/` berakhir di `/kecamatan/` ("Dashboard Kecamatan"). Akun kabupaten: login di `/kecamatan/` berakhir di `/kabupaten/`
("Dashboard Kabupaten", 4 sekolah); `/provinsi/` dan `/kecamatan/` juga dialihkan ke `/kabupaten/`. Akun provinsi: login berakhir
di `/provinsi/` ("Dashboard Provinsi", 3 sekolah); `/kecamatan/` dan `/kabupaten/` dialihkan ke `/provinsi/`. Ketiga akun terbukti.
Portal superadmin (diperiksa 16 Okt 2026): kartu Kabupaten Rokan Hulu memberi `.../kabupaten/`, Provinsi Riau `.../provinsi/`,
kedua kartu kecamatan `.../kecamatan/`. Bagian 9e terbukti seluruhnya. Catatan: modul JS yang di-cache peramban dapat menunda perubahan sampai
pengguna memuat ulang; sementara itu halaman lama tetap berfungsi.

### 9h. Audit jalur API di luar dasbor (16 Okt 2026; temuan KRITIS DIPERBAIKI dan terbukti di sistem nyata)

**STATUS: perbaikan terpasang di produksi dan terbukti live (16 Okt 2026).** Migrasi `20261016050000_wizard_reset_guard.sql` dipasang
Romo; `main` `9c8e8cc`. Bukti di sistem nyata dengan sesi pegawai Kabupaten Rokan Hulu (akun "penyerang" yang sah), dipanggil dengan UUID
sekolah acak yang tidak ada (tidak ada data yang bisa terhapus; token tidak dibaca): `fn_wizard_reset_students` ditolak `P0001`
"Akses ditolak: bukan sekolah Anda."; `fn_wizard_reset_schedules` ditolak `P0001` sama; `fn_reapply_schedule_templates` ditolak `42501`
"permission denied for function"; kontrol: `fn_region_overview_range` tetap berfungsi (4 sekolah). Sebelum perbaikan, pemanggilan pertama
terbukti berhasil di PGlite. Catatan di bawah adalah kondisi sebelum perbaikan.

**Cakupan:** inventaris 180 fungsi public (152 SECURITY DEFINER; 27 dapat dipanggil anon, 4 di antaranya SECURITY DEFINER:
`fn_maintenance_status`, `fn_school_branding`, `fn_resolve_login_email`, `fn_can_manage_pkl_student`); 82 tabel semuanya ber-RLS;
penyapuan membaca ke-82 tabel sebagai pegawai wilayah, uid NULL, anon, dan guru sekolah lain; serangan umum: 112 fungsi x 3 pihak luar
dengan id sekolah A yang nyata, membandingkan isi semua tabel sebelum dan sesudah. Pendaftaran akun publik MATI (`disable_signup`).

**Aman:** tabel (0 baris bocor di semua aktor; kontrol positif guru melihat sekolahnya sendiri, tetapi data uji hanya mengisi sekitar
10 tabel sehingga tabel kosong belum teruji); fungsi anon; storage (3 kebijakan, lampiran forum); `fn_admin_delete_coaching_case`,
`fn_close_semester`, `fn_update_program`, `fn_save_schedule_day`, `fn_save_schedule_templates`, `fn_buka_tahun_ajaran` (penjaga NULL
atau pemeriksaan kepemilikan).

**KRITIS (terbukti di PGlite, kode dibaca): `fn_wizard_reset_students(p_school_id, p_student_ids)`.** Penjaga
`fn_current_school_id() <> p_school_id` dan `fn_current_user_role() <> 'ADMINISTRATIVE'` meloloskan pemanggil yang tidak punya sekolah dan
peran (NULL), yaitu **pegawai wilayah**. Dengan `p_student_ids` NULL fungsi menghapus SEMUA siswa, absensi, pendaftaran kelas, kasus,
observasi, dan akun siswa sekolah mana pun yang id-nya diketahui; id sekolah dapat diperoleh anonim lewat `fn_school_branding(slug)`.
Bertentangan dengan prinsip "pegawai wilayah hanya baca". Dua fungsi serupa: `fn_wizard_reset_schedules` (penjaga sama, tertahan galat
`schedule_id`) dan `fn_reapply_schedule_templates` (tanpa penjaga sama sekali, tertahan cacat: `teacher_journals` tidak punya kolom
`schedule_id`; jalur legacy tanpa pemanggil). Dua yang terakhir laten, bukan aktif.
**Perbaikan siap:** migrasi `20261016050000_wizard_reset_guard.sql` (IS DISTINCT FROM, `p_school_id` wajib, penjaga ditambahkan, hak
EXECUTE `fn_reapply` dicabut dari pengguna login; selisih terhadap baseline hanya penjaga) dan `tests/wizard-reset-guard.mjs` (9 uji: tanpa
perbaikan GAGAL karena penghapusan berhasil; dengan perbaikan lulus, termasuk kontrol positif admin sekolah sendiri). Pemanggil sah
(`admin/js/api.js`, sesi admin sekolah) tidak terpengaruh. **Belum dipasang ke produksi; perlu persetujuan Romo, migrasi dijalankan Romo.**
**Cacat terpisah `schedule_id` (diperbaiki 16 Okt 2026, migrasi `20261016060000_wizard_reset_schedules_fix.sql`, `main` `d5722a1`; TERPASANG dan TERBUKTI LIVE:
admin SMK Uji 3 (`ADM-SMKUJI3`, ADMINISTRATIVE) memanggil `fn_wizard_reset_schedules` untuk sekolahnya sendiri yang kosong: BERHASIL, hasil 0/0/0, tanpa galat 42703;
program dan kelas sekolah itu tidak tersentuh (1 dan 1); dijalankan hanya setelah memastikan sekolah kosong dan sesi milik ADM-SMKUJI3):**
`fn_wizard_reset_schedules` menjalankan `DELETE FROM teacher_journals WHERE schedule_id = ...`, padahal tabel itu tidak punya kolom tersebut, sehingga
fungsi selalu galat 42703 dan "reset jadwal" di wizard admin (`wizardResetSchedules`) gagal untuk SEMUA admin sekolah (terbukti di PGlite: admin
sekolah sendiri pun gagal). Perbaikan: perintah itu dibuang (selisih fungsi tepat empat baris); hanya empat tabel yang mereferensikan
`teaching_schedules` dengan RESTRICT dan semuanya sudah dihapus fungsi. Uji `tests/wizard-reset-guard.mjs` (10) dengan kontrol positif yang
menghapus baris di tujuh tabel. `fn_reapply_schedule_templates` memuat kesalahan yang sama tetapi jalur legacy (EXECUTE dicabut), tidak diubah.
**Batas yang diketahui:** `ld_documents` dan `ld_context_snapshots` mereferensikan `teaching_assignments` tanpa aturan hapus; bila ada dokumen perangkat
ajar, reset jadwal galat 23503 dan membatalkan seluruh penghapusan (aman). Fitur perangkat ajar disembunyikan.
**Reset jadwal pada sekolah BERISI DATA (CHECK 23, 16 Okt 2026): TERBUKTI LIVE di produksi** (transaksi sintetis BEGIN...ROLLBACK, tidak ada data nyata disentuh; tidak ada sisa sesudahnya). Dua sekolah sintetis masing-masing berisi 2 sesi, 4 absensi, 2 log guru, 1 guru pengganti, 2 observasi bersesi, 1 template, 1 penugasan. Admin sekolah A mereset: berhasil tanpa galat (2/1/1), seluruh rantai A kosong, siswa/kelas/mapel/observasi tanpa sesi tetap utuh, rantai sekolah B utuh, reset kedua idempoten (0/0/0). Kontrol negatif di PGlite: tanpa migrasi 060000 uji gagal dengan 42703. Modul: tests/lib/wizard-reset-data-check.mjs, PGlite: tests/wizard-reset-data-check-pglite.mjs. Pembaruan: tab perangkat ajar sudah dihapus dari antarmuka (tombol tab tidak ada di guru/dashboard.html; fungsi initPerangkatAjarTab di guru/js/dashboard.js tidak dipanggil, kode mati) dan produksi punya 0 baris ld_documents dan 0 ld_context_snapshots (dibaca 16 Okt 2026), sehingga batas galat 23503 tidak dapat terpicu lewat jalur normal; tabelnya tetap ada di basis data. Yang TETAP belum teruji: volume besar. **Pembuangan perangkat ajar (migrasi 20261016070000, TERPASANG 16 Okt 2026 dan terbukti):** 16 tabel kosong (ld_*, teacher_documents, teacher_document_approvals/classes, teacher_profiles, teaching_contexts, evaluation_logs, generation_jobs), 6 fungsi, dan 4 enum ld_* dibuang; produksi terukur 0/0/0 sesudahnya, v_core_subjects, subject_cp_mapping, fn_resolve_teacher_names utuh; uji isolasi live (CHECK 21-23) lulus. delete-school di-deploy lebih dulu tanpa tabel itu. Dengan ini batas galat 23503 pada reset jadwal tidak ada lagi. Belum teruji: delete-school versi baru pada penghapusan sekolah sungguhan. **Keandalan dasbor wilayah (16 Okt 2026, TERBUKTI):** tests/rekonsiliasi-dasbor-wilayah.mjs menghitung ulang secara independen semua angka fn_region_overview_range dan fn_region_school_trend_range sebagai pegawai tiap wilayah: 50 lulus, 0 gagal di tiga rentang (30 hari, sejak 1 Sep, 1 hari); himpunan sekolah terlihat sesuai tanda bagi (kecamatan 5, kabupaten 4, provinsi 4); tidak ada label wilayah pada keluaran per sekolah; data bersih (hierarki, kepemilikan absensi, tanggal). Kontrol negatif (sabotase) menghasilkan 7 gagal. Layar sebenarnya diperiksa untuk ketiga tingkat (kartu, tabel jenjang, tabel sekolah, filter, tren kabupaten, pemilih periode 7 hari provinsi): cocok dengan fungsi angka demi angka, termasuk sekolah dengan cakupan 79% yang menyembunyikan persen kehadiran. **CSV unduhan (16 Okt 2026, TERBUKTI):** tests/csv-wilayah.mjs (12 lulus) mengeksekusi kode asli bangunCsv dari app.js dengan data sintetis (BOM, CRLF, urutan kolom, tanpa tanda persen, "< 5", sel kosong, pelolosan koma/kutip/baris baru, penetralan rumus = + - @, tanpa identitas siswa); kontrol negatif: penjaga rumus dicabut -> uji gagal. Ujung ke ujung: CSV dari dasbor kecamatan nyata (ditangkap tanpa menyimpan berkas) 1163 byte, awal byte EF BB BF, berakhir CRLF, tanpa LF telanjang, setiap baris sekolah 12 kolom, seluruh angka sama dengan fungsi. Dasbor dan CSV langsung mengikuti pencabutan berbagi SMK Uji 3 ke kecamatan (5 -> 4 sekolah). **Dua angka sekolah (16 Okt 2026, diperbaiki):** tab Wilayah superadmin menghitung sekolah TERHUBUNG (region_id/kabupaten_id/provinsi_id), sedangkan dasbor pegawai wilayah menghitung sekolah TERLIHAT (terhubung + aktif + disetujui berbagi). Pencabutan berbagi oleh kepala sekolah tidak melepas keterhubungan, jadi superadmin tetap melihat sekolah itu (perlu agar dapat dilepas/dipindahkan). Judul kartu kini "Sekolah (N terhubung · M berbagi data)" dengan catatan penjelas; M selalu sama dengan jumlah di dasbor. Terbukti di layar: kecamatan 10·4, kabupaten 4·4, provinsi 5·4 (cocok dengan basis data), komit de8e2d7. **Kartu wilayah hanya-tampil (16 Okt 2026, komit 76c1c6a, terbukti di layar):** dropdown jenjang/kabupaten/provinsi, Simpan, Lepas, dan "tempatkan sekolah" dihapus dari tab Wilayah superadmin. Alasan: dropdown mengisi diri dengan saran dari kode kecamatan sehingga tampak seperti nilai tersimpan (SMK Uji 1/2/3 tampak berkabupaten padahal tidak), dan Simpan tanpa perubahan dapat menghubungkan sekolah. Penghubungan, pemutusan, dan penempatan hanya lewat editor tab Sekolah (terkunci, tombol Ubah, kotak centang per tingkat, konfirmasi rincian, peringatan reset persetujuan). Jenjang ditetapkan saat pendaftaran (semua 10 sekolah sudah punya jenjang). **Daftar sekolah berupa tabel (komit 66cb482 dan b43eb6d, terbukti di layar):** kolom Sekolah, Jenjang, Terhubung ke (Kec/Kab/Prov), Berbagi ke (Kec/Kab/Prov), Tampil di dasbor ini; baris yang tidak tampil diredupkan; sama di ketiga kartu (kecamatan 10 baris/4 tampil, kabupaten 4/4, provinsi 5/4); lebar 734 px muat tanpa gulir horizontal. **Tab Wilayah: accordion dan tabel bergaris tegas (komit 0ede260, terbukti di layar dengan data asli):** daftar wilayah berlipat satu-buka, urut Provinsi, Kabupaten, Kecamatan, yang pertama terbuka otomatis, pilihan terakhir diingat lintas muat ulang; tabel lima kolom (Sekolah, Jenjang, Kecamatan, Kabupaten, Provinsi) dengan tiga status Berbagi / Belum disetujui / Tidak terhubung, kolom tingkat wilayah itu diberi latar sebagai penentu dasbor, saringan Semua / Tampil di dasbor / Tidak tampil, garis vertikal dan horizontal tegas; Provinsi 5 baris, Kabupaten 4, Kecamatan 10 (masing-masing 4 tampil). **Cron evaluasi kehadiran guru TERPASANG (migrasi 20261016080000, 17 Okt 2026 WIB, terbukti):** tugas evaluate-teacher-indicators-daily, jadwal 0 17 * * * (17:00 UTC = 00:00 WIB), aktif, memanggil fn_evaluate_teacher_indicators untuk hari WIB kemarin dan dua hari lalu; satu-satunya tugas cron di proyek; larinya pertama 17 Okt 17:00 UTC. Sebelum larinya pertama semua 27.201 sesi masih PENDING_EVALUATION. Catatan operasional: peramban menyimpan modul JS di cache, sehingga perubahan tampilan superadmin perlu Ctrl+Shift+R, dan memuat ulang melepas login superadmin (kunci hanya di memori halaman). Belum teruji: tampilan "< 5" di layar nyata, Kecamatan Tandun (tanpa pegawai/sekolah), skala besar.
**(Catatan lama, sebelum perbaikan:)** `fn_reapply_schedule_templates` dan `fn_wizard_reset_schedules` galat 42703 (`schedule_id`).
**Uji isolasi LIVE terhadap produksi (16 Okt 2026, mode CLI tanpa token): 134 lulus, 0 gagal, 2 peringatan SKIP**, termasuk CHECK 19 (lapisan wilayah),
CHECK 20 (tiga tingkat dan piket), dan CHECK 21 baru (penjaga fungsi hapus-data wizard, W1-W8, 16 pemeriksaan). Data produksi utuh sesudahnya.
Konfigurasi nyata dibaca langsung: realtime tanpa tabel terpublikasi; satu bucket storage privat dengan tiga kebijakan authenticated; tidak ada tabel
tanpa RLS; 27 fungsi dapat dipanggil anon (sama dengan PGlite). Dua SKIP: tidak ada catatan siswa dan tidak ada siswa aktif di kelas uji (data uji).
**Batas audit (sebelum pekerjaan lanjutan):** fungsi yang menerima id selain yang saya petakan (kasus, periode, konfigurasi, dan lainnya) tidak teruji dengan id nyata;
enam di antaranya dibaca langsung dan aman; publikasi realtime tidak dapat diperiksa di PGlite; `tests/tenant-isolation.mjs` (live)
belum dijalankan ulang; alat audit tidak dikomit (disimpan di luar repo).

### 9i. Audit jalur API tahap 2: alat yang dapat diulang, dan satu cacat RLS nyata (16 Okt 2026)

Alat `tests/api-surface-audit.mjs` (Codex membangun, Claude memperbaiki; komit `e4d9555`): mengisi data sintetis otomatis di 59 dari 71 tabel ber-`school_id` (tujuh tidak diseed karena FK aktor/dokumen/job),
menyapu tabel, menguji penulisan, menyerang setiap fungsi dengan id nyata, memeriksa storage dan realtime. Kode keluar 1 bila ada temuan merah; `UJI_SABOTASE=1` membuktikan alat menangkap
fungsi rentan buatan sendiri. **Dua cacat alat ditemukan dan diperbaiki:** penanda `RAHASIA-A` adalah awalan penanda sekolah B (positif palsu `fn_get_stale_staff`; terbukti 0 baris dari sekolah lain),
dan uji tulis memakai `r.count` padahal PGlite memberi `affectedRows` sehingga tidak pernah melapor berhasil.
**Cacat nyata: kebijakan RLS `teacher_piket_assignments` (`rls_piket_admin_write`)** memeriksa pemanggil, bukan baris: admin sekolah B dapat membaca, mengubah, menghapus, dan menambah piket sekolah A.
Terbukti di PGlite dan di produksi (transaksi sintetis dibatalkan; tabel piket nyata kosong, jadi tidak ada data nyata terpapar). Dari 265 kebijakan pada tabel ber-`school_id` hanya ini yang cacat; empat
tanpa rujukan `school_id` dibatasi sah lewat induk/hubungan pemanggil. **Perbaikan:** migrasi `20261016065000_piket_policy_row_scope.sql` + CHECK 22 (14 pemeriksaan; uji live dan `tests/piket-check-pglite.mjs`).
Status: dikomit di `main` lokal (`a9ebe3a`), **BELUM terpasang di produksi** (menunggu `db push` Romo). Hasil alat sesudah perbaikan: nol temuan merah, penulisan berhasil 0 di 59 tabel untuk lima pihak luar; tanpa perbaikan piket: merah BACA dan UPDATE.
Catatan: tiga migrasi (`region_service_role_grants`, `grade_level_smp`, `fix_close_semester_actor`) tidak dimuat oleh beberapa harness uji PGlite lama; `fn_close_semester` versi berlaku tetap aman (dibaca).

### 9g. Sekolah uji baru SMK Uji 3 Ujung Batu: terbukti di tiga dasbor (16 Okt 2026)

Didaftarkan Romo (hanya terhubung ke kecamatan dan provinsi, tanpa kabupaten); kepala sekolah menyetujui kecamatan dan provinsi.
Hasil di situs live: **Kecamatan Ujung Batu 5 sekolah (termasuk SMK Uji 3), Provinsi Riau 4 sekolah (termasuk SMK Uji 3),
Kabupaten Rokan Hulu tetap 4 sekolah dan SMK Uji 3 tidak ada, juga tidak ditemukan lewat pencarian "smk"**. Sekolah yang sama
tampil di dua dasbor dan tidak di dasbor ketiga, sesuai penghubungan dan persetujuan. SMK Uji 3 tanpa data tampil dengan 0 siswa
dan "—". Rincian status absensi untuk akun kecamatan juga terbukti (Hadir 95% · Sakit 2% · Izin 1% · Alpa 1%).

### 9f. Uji skala (16 Okt 2026; PGlite lokal; cabang `codex/uji-skala`, `tests/scale-visibility.mjs`, belum digabung)

**Isolasi pada skala: terbukti.** Pembanding independen (himpunan sekolah yang seharusnya terlihat dihitung di JavaScript dari
metadata, bukan dari keluaran fungsi): **185/185 pegawai cocok persis** (172 kecamatan + 12 kabupaten/kota + 1 provinsi), nol
sekolah berlebih atau kurang; tren sekolah yang tidak terlihat kosong (171/171 dan 200/200 pada lari Codex); ambang privasi dan
tanpa kebocoran metadata. Dijalankan dua kali (Codex dan Claude), hasil sama.

**Kinerja: TIDAK terbukti pada 1.376 sekolah.** PGlite kehabisan memori pada skala penuh (perkiraan 990.720 baris absensi); yang
tercapai hanya 172, 344, dan 688 sekolah (Codex) dengan beban kecil (12 siswa, 20 hari, 3 sesi per hari per sekolah).
Waktu `fn_region_overview_range` provinsi 366 hari: Codex 623 / 470 / 1.099 ms (172/344/688 sekolah); lari Claude 104 ms pada 172
sekolah. **Selisih 6x pada konfigurasi yang sama menunjukkan angka waktu sangat berisik** (dua tugas berat berjalan bersamaan);
hanya bentuk kasar (naik kira-kira sebanding dengan jumlah sekolah/baris) yang bermakna, bukan angka mutlak. EXPLAIN pada 172
sekolah menunjukkan Seq Scan pada tabel besar, tetapi pada tabel sekecil itu perencana memang memilih Seq Scan; **tidak dapat
disimpulkan** ada indeks yang kurang. Tidak ada join kuadratik terdeteksi.

**Sinyal risiko (ekstrapolasi, BUKAN pengukuran):** fungsi menghitung dari baris absensi mentah setiap dipanggil, sehingga biaya
naik sebanding dengan jumlah baris sekolah yang terlihat. Data uji nyata: SMA Uji 1 punya 30.377 baris dalam 30 hari untuk 208
siswa (sekitar 146 baris per siswa per 30 hari). Bila 1.376 sekolah masing-masing ~250 siswa, itu sekitar 50 juta baris per 30
hari, sekitar 500 juta untuk rentang setahun, bila semua sekolah berbagi. Dengan laju PGlite yang terukur (0,2-0,5 juta baris/detik)
dan dugaan Postgres asli 2-10x lebih cepat, panggilan provinsi 30 hari bisa memakan puluhan detik sampai menit, sedangkan batas
waktu pernyataan peran `authenticated` di Supabase setahu saya 8 detik (perlu diverifikasi). Kecamatan (8 sekolah, ~0,3 juta baris
per 30 hari) tampak aman. Belum ada keputusan; bukan masalah mendesak selama sistem masih uji coba.

**Tabel ringkasan harian: sudah dibangun, ditinjau, TIDAK dipasang (16 Okt 2026; cabang `codex/ringkasan-harian`, komit `0749580`, migrasi `20261016070000_region_daily_summary.sql`).**
Rancangan: `school_day_summary` (sekolah x hari) dan `school_day_dirty`; empat pemicu per-baris hanya menandai pasangan (sekolah, hari) kotor dan dibungkus `EXCEPTION WHEN OTHERS`;
`fn_refresh_school_day_summary*` menghitung ulang dari data mentah; `fn_region_overview_range` membaca ringkasan; versi lama disimpan sebagai `fn_region_overview_range_raw`; backfill; `pg_cron` tiap menit.
**Terbukti (saya jalankan ulang):** kesetaraan JSON baru vs raw pada 561 skenario dan 300 mutasi acak; keselamatan empat jalur tulis saat tabel penanda rusak; hak akses tertutup; semua uji lama lulus
(region-layer 62, status-absensi 10, wizard-reset-guard 10, isolation-matrix BOCOR 0). Benchmark PGlite (berisik): raw 221-885 ms naik bersama baris absensi, ringkasan 23-65 ms datar.
**Alasan tidak dipasang (risiko yang tidak dapat diuji di PGlite satu koneksi):** (1) `fn_refresh_school_day_summary_batch` memegang kunci baris `FOR UPDATE` atas sampai 20.000 penanda dalam satu
transaksi; pemicu penulisan absensi meng-upsert penanda yang sama (`ON CONFLICT DO UPDATE`) sehingga dapat MENUNGGU sampai refresh selesai (puluhan detik bila antrean besar). (2) `WHEN OTHERS` di PL/pgSQL
tidak menangkap `QUERY_CANCELED`, jadi bila penulis menunggu melewati batas waktu pernyataan (kira-kira 8 detik), penulisan absensi GAGAL meski pembungkus ada. (3) Refresh saat dibaca memproses sampai 20.000 baris
dalam satu permintaan dasbor, dapat melewati batas waktu setelah operasi massal atau mati-nya cron. (4) Pemulihan data (`tools/pulihkan-data.mjs`) memicu pemicu `ENABLE ALWAYS` saat jadwal belum ada sehingga hari tidak ditandai; perlu `fn_backfill_school_day_summary()` sesudahnya. (5) Konkurensi dan pg_cron tidak teruji.
**Mengapa tidak mendesak:** data nyata hanya sekolah uji (satu sekolah ~30 ribu baris per 30 hari); biaya saat ini kecil; manfaat baru terasa di ratusan sekolah. Risiko terhadap jalur tulis inti (absensi guru) lebih besar daripada manfaatnya sekarang.
**Bila akan dipasang kelak:** (a) ganti antrean penanda menjadi append-only (satu `INSERT` per perubahan tanpa upsert pada baris yang sama, hapus berdasarkan id) agar penulis tidak pernah menunggu; (b) refresh dalam kelompok kecil
(mis. 200 baris per transaksi) dan batasi refresh saat dibaca (mis. 500) agar tidak melewati batas waktu; (c) uji konkurensi dua koneksi sungguhan di proyek Supabase uji; (d) catat langkah backfill pada panduan cadangan.
**Pilihan bila skala nyata mendekat (keputusan Romo):** (a) tabel ringkasan harian per sekolah (jumlah per status, keterlambatan, izin
keluar) yang dirawat pemicu atau tugas terjadwal, dan fungsi wilayah membaca ringkasan itu (maksimum sekolah x hari = ~500 ribu
baris setahun); (b) membatasi rentang provinsi dan kabupaten (mis. maks 30 hari) lewat konstanta `v_maks` yang sudah ada; (c)
mengukur di proyek Supabase uji sungguhan dengan data sintetis sebelum memutuskan.

## 10. Keputusan yang sudah diambil

- Persetujuan kepala sekolah tetap jadi syarat tambahan.
- Pemindahan wilayah tidak dirancang; bila penghubungan berubah, persetujuan direset.
- Pegawai wilayah hanya mengenal nama sekolah, tanpa label wilayah; dasbor kabupaten dan provinsi menjadi daftar datar
  dengan pencarian nama dan pengurutan.
- Superadmin mengelola struktur, sekolah, penghubungan, dan akun. **Superadmin tidak perlu melihat data agregat
  wilayah** (keputusan Romo, 16 Okt 2026; menggantikan jawaban "boleh melihat semua"). Ia tidak punya dasbor angka,
  dan tidak ada jalur baru yang perlu dibuat untuknya.

## 11. Belum diketahui atau belum diputuskan

- Jalur lain yang menembus aturan: belum diperiksa.
- 20 pemeriksaan isolasi lama: belum dijalankan ulang setelah migrasi 15-16 Okt.
- Kinerja daftar datar pada 1.376 sekolah: **tidak terukur** (PGlite kehabisan memori); lihat bagian 9f untuk sinyal risiko.
- Halaman atau tidak; urutan bawaan.
- Struktur uji skala: 12 kabupaten/kota, 172 kecamatan, 1.376 sekolah (2 SMK, 2 SMA, 4 SMP per kecamatan), nama
  sekolah placeholder. **Jumlah kecamatan hanya simulasi** (keputusan Romo, 16 Okt 2026): tidak perlu dicocokkan
  dengan daftar resmi di repo (yang mencatat 169, Pekanbaru 12); angka 172 dipakai apa adanya sebagai beban uji.

## 12. Hal dari SSoT lama yang tidak ikut dipindahkan

SSoT dihapus, dan bagian berikut **tidak** masuk dokumen ini karena di luar topik isolasi: definisi angka (cakupan
input, kehadiran, siswa aktif, orang tua aktif, keterlambatan, izin keluar), status data per sekolah, alur
operasional dari nol, pola menambah angka baru ke dasbor, periode waktu, dan tabel status "belum ada". Bila
dibutuhkan, tulis ulang dari kode dan migrasi (sumber sebenarnya), bukan dari ingatan.

## 13. Urutan kerja (usul, belum dimulai)

Dikerjakan dengan alur `docs/kolaborasi/PROTOKOL.md` (Codex di worktree terpisah, Claude meninjau, Romo menyetujui
push dan menjalankan deploy). Setelah rancangan ini terpasang, `docs/PANDUAN-LAPANGAN.md` (butir 9, 10, 13, 19) dan
handoff bagian 4 butir 5 diperbarui agar sejalan.

1. Matriks serangan terhadap keadaan **sekarang** (apa yang bocor hari ini), di PGlite atau proyek uji. Laporkan apa adanya.
2. Fungsi visibilitas tunggal dan keluaran minimal; hapus pengelompokan wilayah dari dasbor kabupaten/provinsi.
3. Daftar datar dengan pencarian nama dan pengurutan.
4. Uji skala 1.376 sekolah (simulasi) dan ukur kinerja.
5. Pasang ke produksi: migrasi, fungsi edge (deploy oleh Romo), lalu tampilan; periksa situs live.
6. Setelah tiap langkah terbukti, perbarui bagian "keadaan sekarang" di dokumen ini dan catat di Riwayat revisi.

## 14. Riwayat revisi

| Tanggal | Perubahan |
|---|---|
| 16 Okt 2026 | Revisi 1: rancangan awal, disetujui Romo (tanpa label wilayah, daftar datar dengan pencarian) |
| 16 Okt 2026 | Revisi 2: bagian selaras SSoT dimasukkan; empat koreksi (syarat aktif, empat ambang, selisih disempitkan, cakupan superadmin) |
| 16 Okt 2026 | Keputusan Romo: superadmin tidak perlu melihat data agregat wilayah (bagian 10 dan 11 diperbarui) |
| 16 Okt 2026 | Matriks serangan dijalankan terhadap keadaan sekarang (bagian 9a): AMAN 190, BOCOR 20 (tiga penyebab), TIDAK TERUJI 9 |
| 16 Okt 2026 | Langkah 2 dan 3 terpasang di produksi dan diperiksa di situs live dengan akun pegawai kabupaten (bagian 9d) |
| 16 Okt 2026 | Langkah 3 selesai di kode (bagian 9c): daftar datar dengan pencarian dan pengurutan; belum diperiksa di peramban dan belum di produksi |
| 16 Okt 2026 | Langkah 2 selesai di PGlite (bagian 9b): BOCOR 20 menjadi 0; belum dipasang ke produksi |
| 16 Okt 2026 | Ditambahkan bagian 4a: absensi oleh guru di kelas (hadir, sakit, alpa) dan kebutuhan tampil di dasbor kepala sekolah dan pegawai wilayah; belum diperiksa terhadap sistem |
| 16 Okt 2026 | Ditambahkan bagian 2.1a, definisi pegawai wilayah (sebelumnya hanya ada di SSoT lama yang dihapus) |
| 16 Okt 2026 | Bagian 4a diperbarui: keputusan Romo untuk status absensi (empat status karena sistem punya Izin, persentase dari catatan, hitungan kecil disembunyikan); dikerjakan Codex di `codex/status-absensi`, belum ditinjau dan belum dipasang |
| 16 Okt 2026 | Bagian 9e: alamat dasbor per tingkat terpasang dan terbukti (`20bcb01`); judul kecamatan tanpa nama kabupaten (`3dbc4d5`); tiga alamat diperiksa dengan tiga akun dan portal superadmin |
| 16 Okt 2026 | SSoT lama dihapus atas perintah Romo; ditambahkan keterangan bahwa dokumen ini dapat berubah mengikuti keadaan nyata |
