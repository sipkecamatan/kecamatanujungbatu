# Handoff sesi: SIP (lapisan wilayah) — keadaan 17 Oktober 2026, ±01.45 WIB (bagian 0–3 diperbarui 17 Okt 11.30 WIB)

**Dokumen ini menggantikan `HANDOFF-SESI-2026-10-15.md`** (yang lama dipertahankan hanya sebagai riwayat; banyak isinya usang).
Tujuannya satu: sesi baru melanjutkan pekerjaan **tanpa menebak dan tanpa kebingungan**. Baca seluruhnya sebelum mengubah apa pun.
**Baca juga `HANDOFF-SESI-2026-10-17b.md`** (lampiran, sore 17 Okt): memuat semua perubahan sesudah dokumen ini ditulis (kasus pembinaan, Catatan Siswa, semester, uji tetap, data uji). Bagian 0–3 di sini sudah disesuaikan dengan keadaan 17 Okt 11.30 WIB; bagian 4 dan seterusnya masih keadaan awal 17 Okt dini hari (sebagian usang, mis. 4B: data uji SMK 1 kini sudah terisi).
Berkas ini lokal (`docs/` tidak terlacak `git`; repo GitHub **publik**). Tidak ada rahasia di dalamnya (kata sandi dan kunci sengaja tidak dicatat).

**Aturan emas sesi ini dan sesi berikutnya:** setiap angka di dokumen ini berasal dari pembacaan nyata pada waktu yang tertera. Bila keadaan
sekarang berbeda, **jangan memaksakan dokumen**: laporkan perbedaannya kepada Romo. Data uji **bisa berubah dari luar sesi** karena Romo
mengisinya sendiri lewat portal (lihat bagian 4B).

---

## 0. Mulai dengan ini (tepat dalam urutan ini)

1. `pwd` harus berakhir `SIP Kecamatan` (bukan `SIP SMK`; jangan menyentuh repo SIP SMK).
2. `git log --oneline -3`, `git status --short`. Per 17 Okt 11.30 WIB: HEAD **`b5cf731`** (`fix(semester): membuka Semester 2 menyalin pendaftaran kelas…`) = `origin/main`;
   hanya `docs/` yang tidak terlacak. (HEAD saat dokumen ini pertama ditulis: `1e348fb`.) Cabang lokal: `main` dan `codex/ringkasan-harian` (sengaja disimpan, lihat 6.1). Tidak ada worktree Codex.
   **Verifikasi `git fetch` + `git status -sb` setelah Romo berkata "sudah push"**: sore 17 Okt sempat tiga commit tidak terkirim (403) padahal migrasi sudah terpasang.
3. `supabase migration list --linked`: **34 migrasi**, lokal = remote (diperiksa 17 Okt sore), yang terakhir **`20261017110000`** (sebelumnya 23, terakhir `20261016080000`). Bila CLI menolak (401), Romo menjalankan `supabase login` sendiri.
4. Fungsi edge terpasang: **30 fungsi** (dihitung ulang 17 Okt 11.30 WIB); yang harus dicocokkan: `manage-region` **v14**, `delete-school` **v3**, `provision-school` v6,
   `sync-observation` **v3** dan `sync-attendance-batch` **v4** (keduanya dideploy 17 Okt; memetakan penolakan pasti ke 4xx).
   Perhatian: `supabase functions list` mengeluarkan **JSON** bila tidak berada di terminal interaktif. Parsing yang bekerja (PowerShell):
   ```powershell
   $r = supabase functions list --project-ref lqgzpiohxdzkkmxjtwor 2>$null | Out-String
   ($r.Substring($r.IndexOf('[')) | ConvertFrom-Json) | Sort-Object name | ForEach-Object { "{0} v{1}" -f $_.name, $_.version }
   ```
   `evaluate-teacher-indicators` ada di repo dan `supabase/config.toml` tetapi **tidak pernah dideploy** (dan tidak dipakai; lihat 3.6).
5. **Ambil foto keadaan data** (hanya baca; satu berkas = satu hasil bergabung lewat `union all`): jalankan `supabase db query --linked -f <berkas.sql>`
   dengan isi pada **lampiran A** dan bandingkan dengan tabel 3.2. **Bila berbeda, tanyakan Romo** apa yang berubah.
6. Baca `docs/ARSITEKTUR-ISOLASI.md` (rujukan utama isolasi dan cakupan wilayah; hidup, berubah mengikuti keadaan nyata; bagian 9b–9i memuat bukti), lalu `docs/HANDOFF-SESI-2026-10-17b.md`.
7. **Tanyakan Romo tugas berikutnya. Jangan memulai perubahan sebelum ia menjawab.** Tugas yang paling mungkin ada di bagian 4.
8. Bila Romo mengajukan pertanyaan yang tidak terkait tugas, **jawab pertanyaan terbarunya lebih dulu**.

---

## 1. Apa produk ini

**SIP** (nama lama "SIP Kecamatan") adalah dasbor baca-saja yang memperlihatkan **angka agregat** (kehadiran, cakupan input, keterlambatan, izin keluar,
jumlah siswa dan orang tua aktif, rincian Hadir/Sakit/Izin/Alpa) dari sekolah-sekolah dalam satu wilayah, **tanpa nama atau identitas siswa**.
Pegawai kecamatan, kabupaten, atau provinsi masuk sekali dan melihat sekolah yang bertanda wilayahnya **dan** yang disetujui kepala sekolah.
Status: **uji coba**, belum dipakai publik; ini bahan proposal masa depan. Basis kode berasal dari SIP SMK. Romo = pemilik produk sekaligus pengembang.
Seluruh data uji adalah **sintetis**.

## 2. Koordinat

| Hal | Nilai |
|---|---|
| Repo lokal | `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan` (nama folder **berspasi**; lihat jebakan 9.1) |
| Repo GitHub (publik) | `https://github.com/sipkecamatan/kecamatanujungbatu`, cabang `main` |
| GitHub Pages | `https://sipkecamatan.github.io/kecamatanujungbatu/` |
| Supabase (Free, Singapore) | ref `lqgzpiohxdzkkmxjtwor`. **Ini satu-satunya proyek: "produksi" dan "uji" adalah proyek yang sama.** |
| Dasbor pegawai wilayah | `/kecamatan/`, `/kabupaten/`, `/provinsi/` (kode bersama di `kecamatan/js/app.js`, `daftar.js`, `format.js`, `kecamatan/css/kecamatan.css`; `kabupaten/index.html` dan `provinsi/index.html` dibuat oleh `tools/buat-halaman-tingkat.mjs`) |
| Pengelolaan | `/superadmin/` (kunci superadmin; login **per tab dan hanya di memori halaman**: memuat ulang melepas login) |
| Portal sekolah | `/admin/`, `/guru/` (juga untuk kepala sekolah, hash `#kepsek`), `/student/`, `/parent/`, `/tu/`, `/dudi/`, `/stakeholder/` |
| Login sekolah | `<Pages>/guru/?school=<slug>` (slug mis. `smauji1`, `smkuji3`) |
| Akun GitHub untuk push | `sipkecamatan` (akun pribadi pemilik repo). Repo ini memakai pengambil kredensial **lokal** (`.git/config`) yang meminta token `sipkecamatan` ke `gh auth token --user sipkecamatan`, jadi akun aktif `gh` boleh berbeda; tidak perlu `gh auth switch`. Bila 403 atau "Invalid username or token": akun `sipkecamatan` tidak ada di `gh` atau tokennya kedaluwarsa, maka Romo menjalankan `gh auth login` untuk akun itu. Sesi Claude tidak boleh mengisi kredensial. |
| Memori Claude | `C:\Users\asus\.claude\projects\d--ribuan-pengguna-CLAUDE-SIP-Kecamatan\memory\` (indeks `MEMORY.md`, dimuat otomatis) |
| Data uji sumber (di luar repo) | `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-data-uji\` (lihat 4B dan 6). **Masih ada dan dipakai** (17 Okt: berkas SMK 1 di `SMK\SMK 1\`; SMK 2/3 sebagian). Tetap periksa `Test-Path` sebelum mengandalkannya. |
| Rahasia | `SUPERADMIN_KEY`, kata sandi, token: milik Romo; **jangan diminta ditempel di chat, jangan diketik sendiri di peramban** |

## 3. Keadaan sistem sekarang (17 Okt 2026, diperbarui 11.30 WIB; angka awal 01.31 WIB)

### 3.1 Repo dan produksi
- Git: HEAD `b5cf731` = `origin/main`. Migrasi terpasang: **34** (terakhir `20261017110000`). Fungsi edge: **30**. Ukuran basis data: **129 MB** (11.30 WIB; 105 MB pada 01.31) dari batas paket Free ±500 MB
  (rincian per tabel di bawah masih dari 01.31 WIB: `attendance` 63 MB / 128.714 baris, `teaching_schedules` 13 MB / 27.201 baris, `teacher_attendance_log` 2,8 MB, `students` 2,3 MB; `teaching_schedules` kini lebih besar karena jadwal SMK 1 sudah diterapkan: 23.259 sesi).
- Situs live = isi `main`; GitHub Pages membangun otomatis (±1 menit setelah push). **Peramban menyimpan modul JS dan CSS di cache**: perubahan tampilan perlu Ctrl+Shift+R.

### 3.2 Wilayah dan sekolah (dari pembacaan basis data, diperbarui 11.30 WIB)
Wilayah: **Provinsi Riau** (kode 14, 1 pegawai), **Kabupaten Rokan Hulu** (1407, 1 pegawai), **Kecamatan Ujung Batu** (1407022, 1 pegawai). Tidak ada Kecamatan Tandun lagi (sudah tidak ada di basis data).

Sepuluh sekolah, semua aktif, semua di Kecamatan Ujung Batu (angka dari foto Lampiran A, 17 Okt 11.30 WIB; baris `smkuji1` berubah banyak sejak 01.31):

| Slug | Jenjang | Berbagi (kec/kab/prov) | Siswa | Kelas | Pengguna (rincian peran) | Jadwal | Absensi |
|---|---|---|---|---|---|---|---|
| `smauji1` | SMA | ya/ya/ya | 208 | 6 | 191 (ORTU 172, GURU 8, BK 2, TU 2, STAKEHOLDER 2, KEPSEK 1, WAKA KUR/KES/HUMAS 1 masing-masing, ADMIN 1) | 6.024 | 30.377 |
| `smauji2` | SMA | ya/ya/ya | 312 | 9 | 282 (ORTU 258, GURU 13, BK 3, TU 2, STAKEHOLDER 2, KEPSEK 1, WAKA KUR 1, WAKA KES 1, ADMIN 1) | 8.532 | 43.190 |
| `smpuji1` | SMP | ya/ya/ya | 180 | 6 | 346 (SISWA 180, ORTU 144, GURU 10, BK 2, TU 2, STAKEHOLDER 3, KEPSEK 1, WAKA KUR/KES/HUMAS 1 masing-masing, ADMIN 1) | 5.058 | 22.440 |
| `smpuji2` | SMP | ya/ya/**tidak** | 270 | 9 | 245 (ORTU 220, GURU 14, BK 2, TU 2, STAKEHOLDER 2, KEPSEK 1, WAKA KUR/KES/HUMAS 1 masing-masing, ADMIN 1) | 7.587 | 32.707 |
| `smkuji1` | SMK | **ya**/tidak/tidak | **998** | 30 | **2.036** (SISWA 998, ORTU 933, GURU 55, DUDI 37, BK 3, STAKEHOLDER 3, TU 2, WAKA KUR/KES/HUMAS 1 masing-masing, KEPSEK 1, ADMIN 1) | **23.259** | 0 |
| `smkuji2` | SMK | tidak/tidak/tidak | 0 | 0 | 1 (hanya ADMIN) | 0 | 0 |
| `smkuji3` | SMK | tidak/tidak/**ya** | 0 | 1 | 2 (ADMIN, KEPSEK) | 0 | 0 |
| `smpuji3`, `smpuji4`, `smpuji5` | SMP | tidak/tidak/tidak | 0 | 0 | 1 (hanya ADMIN) | 0 | 0 |

Catatan penting:
- **`smkuji1` kini berisi data uji lengkap** (5 program, 30 kelas, 998 siswa, 933 orang tua, 55 guru, 37 DUDI, jadwal 23.259 sesi, penugasan BK/guru wali/piket), diisi 17 Okt lewat wizard
  admin dari berkas data uji. Absensi 0 (belum ada yang mengabsen). Sekolah ini juga tempat uji kasus pembinaan dan Catatan Siswa (lihat lampiran 17b, bagian 4: ada data percobaan
  yang sengaja dibiarkan). Jangan menimpa tanpa bertanya Romo. `smkuji1` kini **berbagi ke kecamatan** (penanda `share_with_region`).
- Hanya empat sekolah (`smauji1`, `smauji2`, `smpuji1`, `smpuji2`) yang punya jadwal dan absensi. Absensi nyata terbatas pada keempatnya.
- Akun siswa (peran SISWA) ada di `smpuji1` dan `smkuji1`. Sekolah lain punya data siswa tetapi belum punya akun login siswa.
- Hanya sekolah yang berbagi ke tingkat itu yang tampil di dasbor tingkat itu. Menurut penanda berbagi (11.30 WIB; jumlah di dasbor belum diperiksa ulang): kecamatan **5** (SMA 1–2, SMP 1–2, **SMK 1**), kabupaten **4** (SMA 1–2, SMP 1–2), provinsi **4** (SMA 1–2, SMK 3, SMP 1). Pada 01.31 WIB kecamatan 4.
  `smkuji3` sebelumnya berbagi ke kecamatan; Romo mencabutnya sendiri dari portal kepala sekolah pada 16–17 Okt.
- **TERHUBUNG ≠ BERBAGI.** Tab Wilayah superadmin menghitung sekolah *terhubung* (penanda `region_id`/`kabupaten_id`/`provinsi_id`): kecamatan 10, kabupaten 4, provinsi 5.
  Dasbor wilayah menghitung sekolah *terlihat* (terhubung + aktif + disetujui berbagi). Mencabut berbagi tidak melepas keterhubungan. Ini disengaja dan sudah dijelaskan di layar.

### 3.3 Akun uji (kata sandi dipegang Romo; sistem dan saya tidak menyimpannya)
| Akun | Identitas | Wilayah/sekolah |
|---|---|---|
| Pegawai kecamatan | `pegawai.ujungbatu@contoh.test` (Pegawai Uji Ujung Batu) | Kecamatan Ujung Batu |
| Pegawai kabupaten | `pegawai.kab@contoh.test` ("pegawai dinas rohul") | Kabupaten Rokan Hulu |
| Pegawai provinsi | `pegawai.prov@contoh.test` (Pegawai Uji Provinsi) | Provinsi Riau |
| Kepala sekolah | `smauji1` NIP `196809251995021980` · `smauji2` `197004141997031900` · `smpuji1` `197108171997031901` · `smpuji2` `196903041996031950` · `smkuji3` `196703031992031003` | sekolah masing-masing |
| Admin sekolah | `ADM-<SLUG>` huruf besar, mis. `ADM-SMKUJI1` | tiap sekolah |
Menurut catatan lama, kata sandi awal akun pengguna sekolah hasil impor adalah `12345678` (disengaja) dan akun baru atau yang direset **wajib mengganti kata sandi** (ditegakkan server). **Belum diverifikasi ulang pada sesi ini**; kata sandi pegawai wilayah dibuat acak dan ditampilkan sekali oleh superadmin.

### 3.4 Fungsi edge penting
`manage-region` v14 (aksi: `list`, `ensure_region`, `delete_region`, `add_staff`, `remove_staff`, `reset_staff_password`, `assign_school`), `delete-school` v3 (sudah tidak menyebut tabel perangkat ajar),
`provision-school` v6, `bulk-import-*`, `sync-*`. Fungsi **dihapus dari repo dan tidak pernah dideploy**: `generate-atp`, `generate-atp-v2`, `generate-prota`, `parse-atp`.

### 3.5 Yang BERUBAH sejak handoff lama (supaya tidak kebingungan; perubahan 17 Okt sore ada di lampiran 17b)
Perangkat ajar (ATP/Prota/dokumen guru) **dibuang total**: tab dihapus, ±2.300 baris kode klien dihapus, **16 tabel, 6 fungsi, 4 tipe enum dibuang dari basis data** (migrasi `20261016070000`).
`v_core_subjects`, `subject_cp_mapping`, `fn_resolve_teacher_names`, `teaching_assignments`, dan `subjects` **dipertahankan** (dipakai fitur lain). Batas lama "reset jadwal galat 23503 bila ada dokumen perangkat ajar" sudah **tidak ada**.

### 3.6 Cron evaluasi kehadiran guru
Tugas pg_cron **`evaluate-teacher-indicators-daily`**, jadwal `0 17 * * *` (17:00 UTC = 00:00 WIB), **aktif**, satu-satunya tugas cron di proyek. Memanggil SQL
`fn_evaluate_teacher_indicators` untuk hari WIB kemarin dan dua hari lalu (tanpa fungsi edge, tanpa kunci). Sesi yang ada catatan aktivitas gurunya → `HADIR`; yang tidak → `TIDAK_HADIR`;
dilewati: sesi dengan guru pengganti, `meeting_status` bukan `NORMAL`, atau yang sudah `HADIR`.
**Saat ditulis: riwayat jalan = 0** dan **semua 27.201 sesi masih `PENDING_EVALUATION`** (tugas dibuat setelah 00:00 WIB 17 Okt sehingga putaran malam itu terlewat).
Putaran pertama: **18 Okt 2026 pukul 00:00 WIB** (17 Okt 17:00 UTC). Lihat tugas 4A.

---

## 4. Pekerjaan yang sedang/akan dikerjakan (dirapikan 17 Okt 2026, siang; daftar lengkap pekerjaan terbuka terbaru ada di `HANDOFF-SESI-2026-10-17b.md` bagian 5)

### 4A. Verifikasi putaran pertama cron (menunggu waktu; Romo memilih menunggu)
Per 17 Okt 11.30 WIB: riwayat jalan cron masih **0** (belum ada putaran; tugas aktif). Setelah 18 Okt 00:00 WIB, periksa (hanya baca):
```sql
select d.status, d.start_time, left(coalesce(d.return_message,''),80) as pesan
from cron.job_run_details d join cron.job j using(jobid)
where j.jobname = 'evaluate-teacher-indicators-daily' order by d.start_time desc limit 3;
-- lalu:
select teacher_indicator::text, count(*) from teaching_schedules group by 1 order by 1;
```
Harapan (dari uji kering di produksi dalam transaksi yang dibatalkan): sekitar **369** sesi ditandai (±171 `HADIR`, ±198 `TIDAK_HADIR`) dan sisanya `PENDING_EVALUATION`.
Bila riwayat kosong atau berstatus gagal: **selidiki dulu**. Menjalankan manual **mengubah data sungguhan**: minta izin Romo. Batasan yang sudah dijelaskan kepada Romo: sinkronisasi luring yang tiba lebih dari 2 hari setelah sesi
tidak membalik `TIDAK_HADIR` menjadi `HADIR` (jendela hanya 2 hari).

### 4B. Data uji SMK (keadaan 17 Okt 2026, siang; menggantikan rencana lama "data uji baru yang lebih banyak")
Pertanyaan pilihan lama (sekolah mana, seberapa besar, berapa lama absensi, isi paket) **sudah tidak berlaku**: Romo memutuskan sendiri di sesi 17 Okt dengan berkas yang dibuat Codex dan diperiksa Claude di folder
`SIP Kecamatan-data-uji\SMK\SMK 1|2|3`. Keadaan nyata (dibaca dari basis data 11.30 WIB dan dari folder):

| Sekolah | Berkas yang ada | Sudah diimpor ke basis data? |
|---|---|---|
| **SMK 1** (`smkuji1`) | program (5), kelas (30), staf (62 guru; 1 Kepsek, 3 Waka, 3 BK, 5 Kaprodi, 30 wali kelas), siswa, orang tua (empat bagian), DUDI, jadwal Senin–Jumat (kelas XII sedang PKL), penugasan BK, guru wali, guru piket, pemetaan mapel | **YA, lengkap**: 998 siswa, 933 orang tua, 55 guru, 37 DUDI, jadwal 23.259 sesi (880 templat, 517 penugasan). Absensi 0. |
| **SMK 2** (`smkuji2`) | program (10), kelas, staf (65 guru), siswa, orang tua, DUDI, pemetaan mapel | **BELUM** (0 siswa, 0 kelas per 11.30 WIB). Jadwal, BK, guru wali, piket belum dibuat. |
| **SMK 3** (`smkuji3`) | program (4), kelas (3 per tingkat), staf (75 guru), siswa, orang tua, DUDI, pemetaan mapel | **BELUM** (0 siswa; 1 kelas lama). Jadwal dan penugasan lain belum dibuat. |

- **Jadwal SMK 2 dan 3 ditunda atas permintaan Romo** (Codex sempat kehabisan memori saat menyusunnya). Jangan memulainya tanpa perintah baru.
- Nama mapel pada `pemetaan_mapel_guru_5_program.csv` (SMK 1) sudah disamakan dengan label pendek di jadwal (17 Okt; cadangan `…sebelum-penyamaan.csv`).
- Akun dibuat oleh **impor wizard yang dijalankan Romo**; Claude tidak membuat akun. Berkas siswa SMK 1 dipecah ≤300 baris per impor karena impor besar sempat HTTP 504.
- Batasan lama tetap: NIK/NIP/NIS **fiktif**, jangan taruh data uji ke repo publik, kata sandi awal `12345678` tidak ditulis di berkas.
- Kode wilayah/peran: SMA dan SMP hanya waka Kurikulum dan Kesiswaan yang berhubungan dengan siswa (keputusan lama Romo). Pada SMK, Waka Humas dipakai (PKL).
- Dokumen lama di folder data-uji (`PROMPT-SESI-BARU.md`, `Ringkasan Pengujian SIP Kecamatan.md`) dari 14–15 Okt: **usang**.
- Data percobaan yang sengaja dibiarkan di `smkuji1` (kasus "UJI tahap 3…", catatan uji yang dibatalkan, notifikasi percobaan): lihat lampiran 17b bagian 4.

### 4C. Backlog data uji
Waka Humas masih ada di `smauji1`, `smpuji1`, `smpuji2` (satu per sekolah; dibenarkan oleh jumlah peran di 3.2). Koreksi: admin sekolah mengimpor ulang `koreksi-waka-humas.csv` (satu baris, jabatan dikosongkan) lewat wizard;
UPDATE SQL ditolak pengaman kolom terlindungi. Generator data uji sudah diperbaiki.

### 4D. Hal terbuka tanpa tenggat (jangan dinyatakan lulus; dirapikan 17 Okt siang)
1. **Kinerja pada skala Riau penuh (1.376 sekolah)** tidak terukur (PGlite kehabisan memori); hanya ekstrapolasi.
2. **Tampilan "< 5" di layar nyata** belum teramati (data uji tidak punya hitungan 1–4); hanya terbukti di modul `format.js` (uji 7) dan di kode CSV.
3. **Kecamatan Tandun** tidak ada lagi; tidak ada pegawai/sekolah untuk diuji.
4. **`delete-school` v3 pada penghapusan sekolah sungguhan** belum diuji (tidak mau menghapus sekolah di produksi demi uji).
5. **Ringkasan harian** (cabang `codex/ringkasan-harian`, `0749580`) sengaja TIDAK dipasang; lihat 6.1.
6. Opsional bagi Romo: cek apakah string kunci yang dulu tertulis di komentar `baseline.sql` pernah dipakai sebagai kunci di proyek lain (bukan kunci proyek ini; sidik jari tidak cocok). Tidak mendesak.
7. Uji peramban lama yang sudah rusak sejak sebelum sesi ini (bukan regresi): `kepsek-hardening`, `waka-kurikulum`, `coaching-cases`, `forum-sprint2`, `waka-humas`, `wali-kelas` (penyebabnya hanya diketahui untuk dua: `kepsek-hardening` membaca berkas migrasi lama yang tidak ada, `waka-kurikulum` kehilangan modul Playwright; untuk keempat lainnya penyebabnya **tidak diperiksa**). Hasilnya identik sebelum dan sesudah perubahan sesi ini.
8. Banyak berkas `tests/*.mjs` lain **tidak dijalankan** (portal siswa/ortu/TU/DUDI/stakeholder, dll.); keadaannya tidak diketahui. Yang dijalankan 17 Okt siang dan lulus: lihat bagian 7 (blok "17 Okt siang").
9. **Audit Codex tab "Jurnal Mengajar"**: selesai dan diverifikasi; seluruh sebelas butir A diperbaiki (commit `cce80c0`, `074444c`, `83563ae`, `a0acaac`; A-03 menunggu konfirmasi arah rancangan Romo dan uji layar); pertanyaan B-01…B-08 tertunda. Rinci: `HANDOFF-SESI-2026-10-17b.md` bagian 5 butir 10. Audit tab lain sudah selesai dan diperbaiki: Dashboard Guru (DG-01…DG-13), Pembinaan Siswa, Catatan Siswa (A-01…A-12, B-04/B-05).
10. Pertanyaan rancangan terbuka dari audit Dashboard Guru yang tidak dijawab Romo secara tegas: DG-01 (penilaian terlalu tinggi oleh Codex; hanya intra-sekolah), DG-03 (penggabungan sesi berdekatan), DG-07; lihat lampiran 17b bila perlu. Jangan dinyatakan lulus.

---

## 5. Keputusan Romo (ringkas; butir isolasi dan cakupan wilayah rinci di `ARSITEKTUR-ISOLASI.md`)

1. **Wilayah hanyalah penanda, bukan hierarki komando.** Satu sekolah menyimpan tiga penanda tetap (`region_id` kecamatan, `kabupaten_id`, `provinsi_id`), masing-masing berdiri sendiri.
2. **Penanda saja tidak membuka data.** Terlihat bila: penanda cocok **dan** sekolah aktif **dan** kepala sekolah menyetujui berbagi pada tingkat itu (`share_with_region`, `share_kabupaten`, `share_provinsi`; bawaan tidak).
   **Superadmin tidak pernah menyetujui atas nama kepala sekolah**; kode dan skrip tidak boleh mengubah persetujuan menjadi "ya" (lewat SQL pun tidak).
3. **Pegawai wilayah hanya mengenal NAMA sekolah** (tanpa label kecamatan/kabupaten/provinsi pada keluaran per sekolah). Dasbor = daftar datar dengan pencarian dan pengurutan.
4. **Superadmin tidak perlu melihat data agregat wilayah.** Penghubungan, pemutusan, dan penempatan sekolah **hanya dari editor di tab Sekolah** (terkunci sampai "Ubah penghubungan", konfirmasi merinci perubahan, peringatan reset persetujuan).
   **Tab Wilayah superadmin hanya-tampil** (keputusan 16–17 Okt): tanpa dropdown, Simpan, Lepas, atau "tempatkan sekolah". Jenjang ditetapkan saat pendaftaran.
5. **Tampilan tab Wilayah (disetujui Romo setelah pratinjau):** daftar wilayah berlipat **satu-buka**, urut **Provinsi → Kabupaten → Kecamatan**, **Provinsi terbuka otomatis**, pilihan terakhir diingat lintas muat ulang.
   Tabel sekolah 5 kolom (Sekolah, Jenjang, Kecamatan, Kabupaten, Provinsi), tiga status per tingkat (**Berbagi / Belum disetujui / Tidak terhubung**), kolom tingkat wilayah itu diberi latar "menentukan dasbor ini",
   saringan Semua / Tampil di dasbor / Tidak tampil, **garis tabel vertikal dan horizontal tegas**.
6. **Teks tebal lebih redup:** token `--color-text-strong` = `#b4c0d3` (diredupkan dua tahap atas permintaan Romo) pada tab Wilayah, Sekolah, dan isi tabel Storage; tab Pemeliharaan tidak perlu. Mengubah satu nilai mengubah semuanya.
7. **Rincian status absensi** untuk kepala sekolah dan pegawai wilayah: 4 status (Hadir, Sakit, Izin, Alpa), persentase dari **catatan absensi (siswa × sesi)**, hitungan 1–4 disembunyikan sebagai "< 5" bagi pegawai wilayah.
8. **Aturan privasi dasbor:** total wilayah tersembunyi bila < 3 sekolah berbagi; subtotal jenjang bila < 2 sekolah; kehadiran hanya bila cakupan input ≥ 80% (sekolah di bawah itu dikeluarkan dari total kehadiran).
9. **Periode** dasbor: 7/14/30 hari, bulan ini/lalu, semester ini, tahun ajaran (mulai 1 Juli), tahun kalender, rentang bebas; maksimum 366 hari. **Zona waktu `Asia/Jakarta`** (`fn_hari_ini()`).
10. **Hapus wilayah selalu boleh** (sekolah dilepas dan persetujuan tingkat itu direset; pegawai wilayah dihapus beserta akunnya). Pegawai wilayah: satu akun satu wilayah; tidak ada ubah nama/email (hapus lalu daftar ulang); tidak ada pindah wilayah.
11. **Perangkat ajar dibuang** (lihat 3.5). Tidak ada pendaftaran akun publik (`disable_signup=true`).
12. **Diputuskan diabaikan oleh Romo** (jangan dikerjakan kecuali ia mengubahnya): catatan akses wilayah, pembatasan percobaan kunci superadmin, perbandingan kunci waktu-konstan, jejak audit tindakan superadmin, CORS terbuka, kata sandi awal tampil di layar.
13. Prinsip lama: **jangan menciptakan istilah baru demi jenjang tertentu**; sembunyikan atau lewati, jangan menamai ulang. Jangan memperluas perubahan khusus SMP ke SMA tanpa persetujuan.
14. **(17 Okt) Kasus pembinaan:** pembuat/penangan/Kepsek/Waka Kesiswaan selalu membaca; yang lain hanya bila ditandai (baca saja); admin tidak membaca isi; pengawas yang membuka kasus orang lain dicatat; eskalasi hanya ke kandidat terkait; status mundur satu langkah bercatatan; kasus CLOSED dibuka kembali hanya oleh Waka Kesiswaan/Kepsek; hanya NOTE_ADDED yang terlihat siswa/orang tua. Rinci: lampiran 17b bagian 3.1.
15. **(17 Okt) Catatan Siswa milik guru:** hanya penulis, siswa, orang tua; tidak ada pihak lain di sekolah (BK, Kepsek, Waka, admin) yang terhubung; penulis harus mengajar siswa; penulis dapat membatalkan; admin hanya menghitung. Rinci: lampiran 17b bagian 3.2.
16. **(17 Okt) Data uji percobaan di sekolah uji dibiarkan**, tidak dihapus tanpa perintah baru dari Romo.
17. **(17 Okt) Opsi sentimen "Netral" dihapus** dari Catatan Siswa (hanya Positif dan Perlu Perhatian).

## 6. Yang dikerjakan sejak handoff lama (16–17 Okt)

| Hal | Commit / migrasi |
|---|---|
| Rancangan isolasi langkah 1–3 (matriks serangan, fungsi visibilitas tunggal, daftar datar), kartu Kab/Prov | `7d7c9f1`, `a0bd198` |
| Tiga alamat dasbor, status absensi, CSV angka | `20bcb01`, `2e2ae15`, `2c0aa27`; migrasi `20261016030000` (visibilitas), `20261016040000` (rincian absensi) |
| Celah wizard: penjaga NULL pada fungsi hapus-data (admin sekolah lain/pegawai wilayah dapat menghapus siswa), `schedule_id` salah kolom | migrasi `20261016050000`, `20261016060000`; komit terkait (perbaikan dan uji): `d5722a1`, `9de87c2`, `cba03ac`, `5c6c51d` |
| RLS `teacher_piket_assignments` memeriksa pemanggil, bukan baris | `a9ebe3a`; migrasi `20261016065000` |
| Alat audit permukaan API | `e4d9555` (`tests/api-surface-audit.mjs`) |
| CHECK 23: reset jadwal pada sekolah berisi data, terbukti di produksi | `9570a1b` |
| Buang perangkat ajar: kode klien, `delete-school` v3, fungsi edge ATP dari repo, 16 tabel/6 fungsi/4 enum dari basis data | `a8ca067`, `952e8fd`, `61b7ed3`; migrasi `20261016070000` |
| Cron evaluasi kehadiran guru | `8a7433e`; migrasi `20261016080000` |
| Rekonsiliasi dasbor wilayah vs hitungan independen; uji CSV | `cf5b0eb` (`tests/rekonsiliasi-dasbor-wilayah.mjs`), `c548947` (`tests/csv-wilayah.mjs`) |
| Superadmin: judul "N terhubung · M berbagi", kartu wilayah hanya-tampil, tabel, accordion satu-buka, garis tabel | `de8e2d7`, `76c1c6a`, `66cb482`, `b43eb6d`, `0ede260` |
| Superadmin: teks tebal lebih redup | `4db8bd2`, `95019e9`, `0ea808f`, `571011d`, `e1ae28f` |
| Komentar kunci contoh di `baseline.sql` diganti penanda `<DIISI-SAAT-AKTIVASI>` (riwayat git lama masih memuatnya) | `1e348fb` |
| (17 Okt siang–sore) Kasus pembinaan, Catatan Siswa, semester, antrean luring kasus, uji tetap, deploy fungsi edge | migrasi `20261017010000`…`20261017110000`; commit `3eb3b8d`…`c1da4aa`; rincian: `HANDOFF-SESI-2026-10-17b.md` bagian 2 |

### 6.1 Ringkasan harian (disimpan, tidak dipasang)
 cabang `codex/ringkasan-harian` (`0749580`). Alasan: kunci baris refresh dapat memblokir penulisan absensi, `WHEN OTHERS` tidak menangkap `QUERY_CANCELED`, refresh saat dibaca tak terbatas;
tidak dapat diuji konkurensi di PGlite. Pasang hanya bila skala nyata mendekat dan Romo memutuskan; rancangan perbaikan di `ARSITEKTUR-ISOLASI.md` bagian 9f.

## 7. Terbukti dan belum terbukti

**Dijalankan ulang HARI INI (17 Okt, 01.xx WIB) dan hasilnya:**

| Uji | Hasil |
|---|---|
| `tests/tenant-isolation.mjs` **LIVE** terhadap produksi (`SIP_MGMT_MODE=cli`, tanpa token) | **LULUS** ("invarian isolasi tenant utuh"); 3 baris SKIP: CHECK 7 F2 (tidak ada sekolah dengan DUDI+GURU+siswa), tidak ada catatan siswa, F9 (tidak ada siswa aktif di kelas itu). Jumlah lulus **tidak dicatat** pada pembacaan ini. Memuat CHECK 21 (penjaga wizard), 22 (RLS piket), 23 (reset jadwal pada sekolah berisi data) |
| `tests/isolation-matrix.mjs` (PGlite; **butuh `SIP_ROOT`**) | **AMAN=210, BOCOR=0, TIDAK TERUJI=9**; kontrol positif lulus |
| `tests/region-layer.mjs` (PGlite; **butuh `SIP_ROOT`**) | **62 lulus** |
| `status-absensi` 10, `wizard-reset-guard` 10, `daftar-sekolah` 14, `halaman-tingkat` 6, `format-status` 7, `csv-wilayah` 12 | semua lulus |
| `evaluasi-kehadiran-guru-pglite` 5, `drop-perangkat-ajar-pglite` 7, `wizard-guard-check-pglite` 16 (CHECK 21), `piket-check-pglite` 14 (CHECK 22), `wizard-reset-data-check-pglite` 6 (CHECK 23) | semua lulus |
| `tests/api-surface-audit.mjs` | selesai tanpa galat (exit 0); keluarannya tidak dicatat |

**Dijalankan 17 Okt siang (terhadap produksi, hasil lulus):** `tests/tenant-isolation.mjs` (mode CLI; 155 pemeriksaan; uji S4 dan C16 diperbarui, lihat 17b butir 7), `tests/kasus-penonton.mjs` (28), `tests/kasus-aturan.mjs` (27), `tests/catatan.mjs` (22), `tests/semester.mjs` (10), `tests/offline-antrean.mjs` (16, tanpa jaringan). Semua uji aturan baru memakai transaksi yang dibatalkan.

**Terbukti di sistem nyata pada sesi 16–17 Okt (bukan hanya uji):**
- **Rekonsiliasi dasbor wilayah** (`tests/rekonsiliasi-dasbor-wilayah.mjs`, produksi, hanya baca): **50 lulus, 0 gagal** pada tiga rentang (30 hari, sejak 1 Sep, 1 hari): himpunan sekolah terlihat, tiap angka per sekolah, total, per jenjang, tren mingguan/bulanan,
  tanpa label wilayah pada keluaran per sekolah, data bersih. Kontrol negatif (sabotase) menghasilkan 7 gagal. Perintah: `SIP_MGMT_MODE=cli node tests/rekonsiliasi-dasbor-wilayah.mjs [dari=YYYY-MM-DD] [sampai=YYYY-MM-DD]`.
- Layar nyata ketiga tingkat (kartu, tabel jenjang, tabel sekolah, filter, tren kabupaten, pemilih periode 7 hari provinsi) cocok dengan fungsi angka demi angka, termasuk sekolah dengan cakupan 79% yang menyembunyikan persen kehadiran.
- **CSV unduhan:** dari dasbor kecamatan nyata (ditangkap tanpa menyimpan berkas): BOM `EF BB BF`, CRLF, tanpa LF telanjang, setiap baris sekolah 12 kolom, angka sama dengan fungsi.
- Pegawai kecamatan **tidak** dapat membaca sekolah yang tidak berbagi lewat jalur apa pun yang diuji (tabel `schools`, `students`, `attendance`, `users`, jadwal, kelas, fungsi dasbor, fungsi tren, `regions`, `region_staff`): 0 baris atau ditolak.
- Penghubungan dan pencabutan berbagi langsung tercermin di dasbor dan CSV (5 → 4 sekolah di kecamatan).
- Migrasi `20261016070000` dan `20261016080000`: diuji kering di produksi dalam transaksi yang dibatalkan, lalu dipasang Romo dan diverifikasi.

**Belum terbukti:** semua butir 4D; `tests/manage-region-live.mjs` (butuh `SUPERADMIN_KEY` Romo; belum pernah dijalankan dan ekspektasinya sudah diubah untuk hapus-selalu-boleh); latihan pulih `tools/pulihkan-data.mjs` ke proyek uji.

---

## 8. Aturan kerja (wajib)

**Izin dan batas yang TERBUKTI pada sesi ini:**
- **`supabase db push --linked --yes` dan `supabase functions deploy ...` dijalankan ROMO** di terminal VS Code. Pengaman izin sistem menolak Claude menjalankannya. **Jangan mengakali**; jelaskan dan minta Romo.
- **Urutan pemasangan:** deploy fungsi edge yang tidak lagi bergantung pada objek lama **sebelum** migrasi yang menghapus objek itu; migrasi database dulu sebelum kode klien yang membutuhkannya; tampilan (`git push`) terakhir.
- **Penulisan berkas migrasi yang berisi `DROP TABLE` pernah ditolak** pengaman izin (3 kali, meski Romo menyetujui di chat); **Romo membuat berkas itu sendiri di VS Code**, lalu Claude menguji dan mengomitnya. Persetujuan di chat tidak mengubah aturan izin; Romo harus menambah aturan izin Edit/Write bila ingin Claude menulisnya.
- **Claude tidak membuat akun login** dan tidak mengunduh berkas tanpa izin. Tidak memasukkan kata sandi/kunci di peramban. Menangkap isi CSV dengan menahan `URL.createObjectURL` dan mencegah klik tautan unduhan (tanpa menyimpan berkas) sudah terbukti.
- **`git push` dijalankan ROMO** (17 Okt: pengaman izin menolak push Claude sebagai "Production Deploy"). Claude hanya membuat commit (diakhiri baris `Co-Authored-By`), memeriksa `node --check` pada JS yang diubah, lalu memeriksa situs live dan `git fetch` setelah Romo berkata "sudah push".
- Memutus atau menyetujui **persetujuan berbagi** tidak boleh lewat SQL atau skrip. Tindakan menghapus data: tunjukkan targetnya dulu. Jangan menyentuh data uji yang sedang dikerjakan Romo (lihat `smkuji1`).
- Jangan membuka atau menyalin dari repo SIP SMK. Jangan menaruh `docs/` atau cadangan data ke repo publik.

**Cara bekerja yang disukai Romo (diamati, bukan aturan tertulis; tetap ikuti):**
- **Katakan tegas dan jelas apa yang menunggu Romo**: apa, perintah/langkah persisnya, dan akibat bila tidak dilakukan.
- **Perubahan tampilan: tunjukkan dulu pratinjau sebelum/sesudah (Artifact, data nyata)**; Romo menanggapi, menjawab "setuju"; baru dikerjakan, diuji di layar nyata, dilaporkan. Romo sering memberi umpan balik pada pratinjau (garis tabel, kecerahan teks).
- Laporan jujur: bedakan **terbukti di layar/DB nyata**, **dieksekusi dari kode**, **hanya dibaca**, **tidak diuji**. Jawab dalam bahasa Indonesia, ringkas, tabel bila membandingkan. Sapa "Romo".
- Bila Romo menolak dialog pilihan dan menanyakan hal lain, jawab pertanyaannya.

## 9. Jebakan alat yang sudah terbukti

1. **Nama folder berspasi (`SIP Kecamatan`):** beberapa uji (`region-layer`, `isolation-matrix`) menurunkan akar dari `import.meta.url` dan gagal `ENOENT ...SIP%20Kecamatan...`. **Jalankan dengan `SIP_ROOT`:**
   ```powershell
   $env:SIP_ROOT = "D:/ribuan_pengguna/CLAUDE/SIP Kecamatan"; node tests\region-layer.mjs; Remove-Item Env:SIP_ROOT
   ```
2. **Backslash dan kutip hilang** pada heredoc Bash, `node -e` berkutip ganda, dan string non-raw. **Tulis skrip dengan alat Write** (atau `String.raw`) lalu jalankan `node`. Tulis pola regex di berkas, bukan baris perintah.
3. **Akhir baris:** `superadmin/js/dashboard.js`, `guru/js/*.js`, `guru/dashboard.html`, `tests/tenant-isolation.mjs` **CRLF**; `superadmin/css/superadmin.css` **LF**; `grep`/`cat` menyembunyikan `\r`. Periksa dengan Node (`includes('\r\n')`) sebelum mengedit; edit dengan skrip yang menormalkan lalu memulihkan akhir baris.
4. **`supabase db query --linked -f <berkas.sql>`**: hasil **pernyataan terakhir** saja, dibungkus JSON bergaris batas; urai dari `{` pertama sampai `}` terakhir. Berjalan **langsung** (bukan dry-run). Uji aman: `begin; ...; select ...; rollback;`. Berkas SQL tanpa BOM (PowerShell `Set-Content -Encoding utf8` menambah BOM; gunakan Write).
   Mode tanpa token: `SIP_MGMT_MODE=cli node tests/tenant-isolation.mjs` memakai login CLI tertaut. `supabase db dump` butuh Docker (tidak ada).
5. **`git push` di PowerShell** menampilkan stderr sebagai "NativeCommandError" padahal berhasil; periksa baris `a..b main -> main`. `Start-Sleep` yang diikuti perintah lain **diblokir**; tunggu dengan `until <cek>; do sleep 5; done` di Bash dengan `run_in_background` (satu notifikasi saat selesai).
   Menunggu build Pages: `gh run list --repo sipkecamatan/kecamatanujungbatu --limit 1 --json status,conclusion,headSha`.
6. **Cache peramban:** modul JS/CSS di-cache; setelah push muat ulang paksa (Ctrl+Shift+R). **Memuat ulang melepas login superadmin** (kunci hanya di memori halaman, **per tab**); minta Romo login lagi. Untuk memeriksa CSS baru **tanpa** melepas login: ambil CSS dengan `fetch(..., {cache:'no-store'})` lalu sisipkan sebagai `<style>`, ukur `getComputedStyle`, lepas lagi.
7. **Claude in Chrome:** tiap sesi punya grup tab sendiri (`tabs_context_mcp` dengan `createIfEmpty`, lalu `tabs_create_mcp`); ID tab berubah setelah login/pengalihan; tab milik Romo bukan milik Claude (jangan menutup). Keluaran `javascript_tool` yang memuat pola mirip query string (mis. `charset=utf-8`) **diblokir** ("[BLOCKED: Cookie/query string data]"); kembalikan ringkasan yang sudah diurai.
   `read_console_messages` hanya menangkap setelah dipanggil pertama kali. Klik koordinat sering gagal; gunakan `element.click()`. Halaman yang mengalihkan ke login memutus evaluasi; catat hasil di `localStorage`, lalu baca sesudahnya.
8. **Uji tampilan sebelum push (tanpa login nyata):** layani repo dari server statis lokal, ganti `window.fetch` pada halaman dengan data kanonik (`list-schools` → `[]`, `manage-region` aksi `list` → data), isi kunci acak, kirim formulir login; jalankan skenario; matikan server dan tutup tab. Terbukti untuk accordion tab Wilayah.
9. **`Artifact` dengan `edits`** ditolak oleh hook sesi bila berkas diedit; ubah dengan Edit lalu publikasikan tanpa `edits`.
10. **PGlite:** `Fatal process out of memory: Zone` = memori komputer habis (jangan menjalankan banyak uji PGlite paralel; skala 1.376 sekolah mustahil di PGlite). Sebagian harness lama tidak memuat migrasi `region_service_role_grants`, `grade_level_smp`, `fix_close_semester_actor`; fungsi `fn_close_semester` yang berlaku tetap aman.
11. **PostgREST 404 pada RPC** sering berarti galat tipe runtime (enum vs text); **429** pada uji live berarti pembatasan laju Management API, bukan kegagalan isolasi.
12. **Pola cacat yang harus dihindari pada fungsi/kebijakan baru:** penjaga `IF fn_current_school_id() <> p_school_id` **lolos untuk pemanggil NULL** (akun tanpa baris `users`, mis. pegawai wilayah): pakai `IS DISTINCT FROM` dan tolak NULL. Kebijakan RLS harus merujuk kolom **milik baris** (`school_id`), bukan hanya properti pemanggil. `WHEN OTHERS` di PL/pgSQL tidak menangkap `QUERY_CANCELED`.
13. **Sebelum mengubah JS:** `node --check` pada salinan `.mjs`. Periksa rujukan menggantung sesudah penghapusan besar (nama yang dibuang masih dirujuk? impor tanpa ekspor?).
14. **(17 Okt) PL/pgSQL:** `EXCEPTION WHEN OTHERS` **tidak menangkap P0004 (ASSERT_FAILURE)**; tulis `WHEN assert_failure OR others`. `EXECUTE … INTO` pada INSERT membutuhkan `RETURNING`. Klaim JWT yang diatur `set_config(..., true)` bertahan sampai akhir transaksi (kosongkan sebelum menyiapkan keadaan sebagai sesi layanan). Kolom `users` terlindungi (`app.bypass_users_guard`).
15. **(17 Okt) `supabase db query` dengan beberapa pernyataan** hanya mengembalikan hasil pernyataan **terakhir**; satu hasil per berkas atau kumpulkan ke tabel sementara.
16. **(17 Okt) Peramban otomatis:** tab latar membeku (CDP timeout) → buka tab baru, tutup yang lama; satu sesi login per **origin** (port berbeda untuk akun berbeda; `python -m http.server <port> --bind 127.0.0.1`); URL login sekolah harus `index.html?school=<slug>`; modul JS perlu `fetch(url,{cache:'reload'})` lalu muat ulang.
17. **(17 Okt) Push GitHub:** akun pemilik repo `sipkecamatan`; repo memakai pengambil kredensial lokal (lihat bagian 2). "Sudah push" dari Romo wajib diverifikasi dengan `git fetch` (tiga commit pernah tidak terkirim).
18. **(17 Okt) Codex:** audit di folder scratchpad terpisah (input hanya-baca + `keluaran/`), prompt via stdin; larangan eksplisit menghentikan proses (`taskkill`) wajib ada di prompt; berkas besar (mis. `penilaian.js` 2.541 baris) dibaca per bagian agar tidak kehabisan memori.

## 10. Alat dan uji (rujukan cepat)

| Berkas | Fungsi | Butuh |
|---|---|---|
| `tests/tenant-isolation.mjs` | Isolasi tenant pada basis data **live** (CHECK 1–23) | login CLI (`SIP_MGMT_MODE=cli`) atau `SUPABASE_ACCESS_TOKEN` |
| `tests/rekonsiliasi-dasbor-wilayah.mjs` | Dasbor wilayah vs hitungan independen (hanya baca) | login CLI; `UJI_SABOTASE=1` = kontrol negatif |
| `tests/isolation-matrix.mjs`, `tests/region-layer.mjs` | Matriks serangan 210 dan perilaku lapisan wilayah 62 (PGlite) | PGlite + `SIP_ROOT` |
| `tests/api-surface-audit.mjs` | Audit permukaan API yang dapat diulang (`UJI_SABOTASE=1`, `TANPA_PIKET=1`) | PGlite |
| `tests/*-pglite.mjs` | CHECK 21/22/23, pembuangan perangkat ajar, cron evaluasi (modul di `tests/lib/*-check.mjs`) | PGlite |
| `tests/csv-wilayah.mjs` | Isi CSV unduhan (kode asli `bangunCsv`; `KONTROL_NEGATIF=1`) | Node |
| `tests/manage-region-live.mjs` | `ensure_region`, reset sandi, hapus wilayah | `SUPERADMIN_KEY` (belum pernah dijalankan) |
| `tools/cadangan-data.mjs`, `tools/pulihkan-data.mjs`, `tools/buat-daftar-wilayah.mjs`, `tools/buat-halaman-tingkat.mjs` | cadangan, pulih, daftar wilayah, halaman tingkat | lihat `docs/PANDUAN-CADANGAN.md` |
| `tests/kasus-penonton.mjs`, `tests/kasus-aturan.mjs`, `tests/catatan.mjs`, `tests/semester.mjs` | Aturan kasus, Catatan Siswa, pergantian semester, LIVE (transaksi dibatalkan; `UJI_TERAPKAN_MIGRASI=1` menerapkan migrasi di dalam transaksi uji) | login CLI |
| `tests/offline-antrean.mjs` | Antrean luring (IndexedDB, fetch ditiru; `node tests/offline-antrean.mjs [berkas-lama]` untuk kontrol negatif) | Node |
| `tests/jurnal-nilai.mjs`, `tests/nilai-rapor.mjs` | Validasi server jurnal/nilai/TP dan tabel nilai rapor, LIVE (transaksi dibatalkan; `UJI_TERAPKAN_MIGRASI=1`) | login CLI |
| `tests/penilaian-api.mjs`, `tests/nilai-rapor-hitung.mjs`, `tests/nilai-rapor-ui.mjs` | Lapisan data penilaian (tiruan PostgREST), logika nilai rapor, uji asap tampilan Nilai Rapor | Node |

Panduan lain di `docs/`: `PANDUAN-UJI-ISOLASI-LIVE.md` (menjalankan uji live), `PANDUAN-LAPANGAN.md` (20 pertanyaan petugas), `PANDUAN-CADANGAN.md`, `PANDUAN-SEKOLAH-UJI-BARU.md` (membuat sekolah uji; merujuk folder data-uji), `kolaborasi/PROTOKOL.md` (kerja dengan Codex).

## 11. Peta kode wilayah (supaya tidak mencari)

| Hal | Letak |
|---|---|
| Fungsi agregat wilayah | `fn_region_overview_range`, `fn_region_school_trend_range`, `fn_region_sekolah_terlihat`, `fn_region_staff_region`, `fn_hari_ini` (versi berlaku: `20261016030000_region_visibility.sql` dan `20261016040000_attendance_breakdown.sql`; **selalu baca definisi live dengan `pg_get_functiondef`**) |
| Fungsi edge wilayah | `supabase/functions/manage-region/index.ts` |
| Dasbor pegawai | `kecamatan/index.html`, `kecamatan/js/app.js` (termasuk `bangunCsv`), `kecamatan/js/daftar.js` (saring/urut), `kecamatan/js/format.js` (`nilaiStatus`, `nilaiStatusCsv`), `kecamatan/css/kecamatan.css` |
| Portal superadmin | `superadmin/index.html`, `superadmin/js/dashboard.js` (`loadRegions` = accordion dan tabel wilayah; editor penghubungan di kartu sekolah memakai `assign_school`), `superadmin/css/superadmin.css` (kelas `.acc*`, `.tbl-grid`, `.pill*`, token `--color-text-strong`) |
| Persetujuan berbagi | `guru/dashboard.html`, `guru/js/dashboard.js` (kartu "Berbagi Ringkasan ke Wilayah"); rincian absensi kepala sekolah di baris rincian |
| Hapus data wizard | `fn_wizard_reset_students`, `fn_wizard_reset_schedules` (migrasi `050000`, `060000`) |
| Cron | migrasi `20261016080000_cron_evaluasi_kehadiran_guru.sql` |
| Daftar wilayah resmi | `superadmin/data/index.json`, `superadmin/data/wilayah-riau.json` |
| Kasus pembinaan (portal guru) | `guru/js/dashboard.js` (`openKasusDetail`, `renderKasusViewers`, `renderKasusActions`, `renderKasusAntrean`, `STATUS_BACK_ONE`), `guru/js/api.js` (fungsi kasus + `listCaseViewers`, `addCaseViewer`, dst.), `guru/js/offline.js` (`listQueuedCases`, `discardQueuedCase`); server: migrasi `…040000`, `…050000`, `…100000` (`fn_case_*`, `fn_coaching_event_rules`, `rls_ccv_read`); portal `parent/js/api.js` (`fetchCases`), `student/js/api.js` (`getMyCases`) |
| Catatan Siswa | `guru/js/dashboard.js` (`initObsForm`, `renderObsHistory`), `guru/js/api.js` (`insertObservation`, `getMyObservations`, `voidObservation`), fungsi edge `sync-observation`; server: migrasi `…060000` (`fn_sync_observation`), `…070000` (notifikasi), `…080000` (kunci periode, `fn_void_observation`), `…090000` (tutup bagi admin, `fn_admin_observation_count`) |
| Pergantian semester | `admin/js/semester.js` (`openNextSemester`), migrasi `…110000` (`fn_open_next_semester`), `guru/js/api.js` (`getEnrolledStudents(classId, year, semester)`) |

## 12. Hal yang jangan diulang

- Jangan menyelidiki ulang yang sudah terbukti (bagian 7) atau mengubah keputusan Romo (bagian 5).
- Jangan mengembalikan dropdown/Simpan/Lepas ke tab Wilayah, formulir wilayah "ketik nama", pilihan wilayah di formulir pendaftaran sekolah, atau aksi `create_region`.
- Jangan membangun ulang rancangan induk-anak antar wilayah (sudah dibuang), atau fitur perangkat ajar (sudah dibuang).
- Jangan menambah ekspor/catatan akses/audit superadmin tanpa Romo mengubah keputusannya.
- Jangan menawarkan "menghapus data uji lama" sebagai pilihan bawaan; hasil uji yang sudah terbukti bergantung pada empat sekolah yang terisi.
- Jangan menghapus data percobaan di `smkuji1` (keputusan Romo 17 Okt), jangan memberi BK/Kepsek/Waka/admin akses baca ke Catatan Siswa, dan jangan membuat kasus pembinaan terbuka bagi wali kelas/BK tanpa penandaan.
- Jangan menjalankan `git push` atau mengisi kredensial GitHub dari sesi Claude.

## 13. Kolaborasi dengan Codex (ringkas; rinci di `docs/kolaborasi/PROTOKOL.md`)

Codex dipicu lewat shell dengan prompt via **stdin** (`$t | codex.exe exec --sandbox workspace-write -C <worktree> -`; biner di folder ekstensi VS Code `openai.chatgpt-*`), selalu di **worktree terpisah** (`SIP Kecamatan-codex*`) dan cabang `codex/<tugas>`.
Claude meninjau diff, menjalankan ulang uji, dan mengomit; Codex tidak dapat menulis metadata worktree dan tidak dapat menjalankan `deno`. Saat ini **tidak ada worktree Codex** dan hanya satu cabang `codex/*` (`codex/ringkasan-harian`, disimpan). Pada sesi 16–17 Okt Codex mengerjakan tugas isolasi, status absensi, uji skala, audit API, dan ringkasan harian.

---

## Lampiran A. Foto keadaan data (hanya baca; simpan sebagai `.sql` tanpa BOM lalu `supabase db query --linked -f`)

```sql
select '1_sekolah' k, s.name || ' | ' || s.slug || ' | ' || coalesce(s.jenjang,'?') || ' | aktif=' || s.is_active
  || ' | bagi(kec/kab/prov)=' || s.share_with_region || '/' || s.share_kabupaten || '/' || s.share_provinsi
  || ' | siswa=' || (select count(*) from students x where x.school_id=s.school_id)
  || ' | kelas=' || (select count(*) from classes x where x.school_id=s.school_id)
  || ' | pengguna=' || (select count(*) from users x where x.school_id=s.school_id and x.deleted_at is null)
  || ' | kepsek=' || (select count(*) from users x where x.school_id=s.school_id and x.is_kepsek and x.deleted_at is null)
  || ' | jadwal=' || (select count(*) from teaching_schedules x where x.school_id=s.school_id)
  || ' | absensi=' || (select count(*) from attendance x where x.school_id=s.school_id) v
from schools s
union all select '2_wilayah', r.name || ' | ' || r.level || ' | kode=' || coalesce(r.kode,'-') || ' | pegawai=' || (select count(*) from region_staff x where x.region_id=r.region_id) from regions r
union all select '3_ukuran_db', pg_size_pretty(pg_database_size(current_database()))
union all select '4_cron', coalesce((select jobname || ' ' || schedule || ' aktif=' || active::text from cron.job limit 1), '(kosong)')
union all select '5_run_cron', (select count(*)::text from cron.job_run_details)
union all select '6_waktu_wib', (now() at time zone 'Asia/Jakarta')::text
order by 1, 2;
```
