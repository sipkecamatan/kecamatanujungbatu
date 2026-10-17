# Tambahan handoff: kasus pembinaan dan Catatan Siswa — keadaan 17 Oktober 2026 (sore)

**Ini lampiran untuk `HANDOFF-SESI-2026-10-17.md`** (jangan menggantikannya; bagian 0–3 di sana tetap rujukan awal). Dokumen ini mencatat semua yang
berubah setelah handoff itu ditulis. Berkas lokal (`docs/` tidak terlacak; repo GitHub publik): tidak ada kata sandi, kunci, atau token di sini.

Aturan emas tetap sama: bila keadaan nyata berbeda dari tulisan ini, **laporkan perbedaannya kepada Romo**, jangan memaksakan dokumen.

---

## 1. Keadaan repo dan basis data

- HEAD = `b5cf731` = `origin/main` (diperiksa setelah `git fetch`, 17 Okt sore; tidak ada commit yang belum terkirim). Hanya `docs/` yang tidak terlacak.
- Berkas migrasi: **34** (handoff lama menyebut 23). Terakhir: **`20261017110000_buka_semester_2_enrollment.sql`**. `supabase migration list` (17 Okt sore)
  menunjukkan `20261017110000` terpasang di lokal DAN remote; objek dari migrasi `…040000` sampai `…110000` sudah dibuktikan langsung di basis data live
  (fungsi/trigger ada). Jalankan `supabase migration list --linked` sekali lagi di awal sesi berikutnya untuk memastikan masih sama.
- **Fungsi edge `sync-observation` SUDAH dideploy (v3, terkonfirmasi 17 Okt 08.44 WIB)**, dua menit setelah commit `a54625b` (08.42) yang memetakan
  penolakan pasti ke 403/400. Dibuktikan lewat perbandingan waktu `supabase functions list` (kolom `updated_at`, epoch ms) dengan waktu commit; kode respons
  403 belum diuji langsung dengan catatan yang ditolak. `sync-attendance-batch` (v3, terakhir 13 Okt) punya pola 500 yang sama untuk periode ditutup
  dan belum disentuh.
- Situs live (GitHub Pages) sudah memuat kode terbaru (diperiksa lewat `curl` pada berkas yang berisi penanda perubahan).

### Masalah izin push GitHub (terjadi 17 Okt sore)
`git push` sempat 403: akun aktif di terminal Romo (`parentingtangguh-png`) tidak punya izin tulis ke `sipkecamatan/kecamatanujungbatu`.
Pemilik repo adalah akun pribadi **`sipkecamatan`** (bukan organisasi). Akibatnya tiga commit sempat tidak terkirim sementara migrasi
(`supabase db push`, terpisah dari git) sudah terpasang, sehingga kode live sempat tertinggal dari basis data. Diselesaikan Romo dengan login
akun `sipkecamatan` dan `git remote set-url origin https://sipkecamatan@github.com/…` serta `credential.https://github.com.username` lokal.
**Pelajaran:** bila Romo berkata "sudah push", periksa `git fetch` dan `git status -sb` sebelum menganggapnya benar. Saya tidak boleh mengisi kredensial.

---

## 2. Yang dikerjakan hari ini (urut kronologis, singkat)

| Area | Perubahan | Penanda |
|---|---|---|
| Data uji SMK 1–3 | staf, siswa, orang tua, DUDI, jadwal SMK 1 (880 templat, 517 penugasan, 23.259 sesi), penugasan BK/guru wali/piket SMK 1 | handoff lama + folder `…-data-uji` |
| Dasbor wilayah | kartu Sakit/Izin/Alpa; lipat di layar sempit (default tertutup, satu terbuka); klik jenjang menyaring sekolah | `0471d19`, `109636f` |
| Jadwal | Terapkan Jadwal dipercepat | migrasi `…010000`, `cb4cf7f` |
| Audit tab Dashboard Guru | DG-04/05/06/08/13 diperbaiki (modal absensi, antrean luring per pengguna, 5xx tidak dibuang) | `b98a420`, `c0cd50b` |
| Absensi | `fn_sync_attendance_batch` menyimpan alasan izin | `…020000` |
| Guru wali | penugasan berlanjut lintas tahun ajaran | `…030000` |
| Kasus pembinaan | penonton (tag), baca siswa untuk penonton, aturan lanjutan, badge, portal ortu/siswa, antrean luring | `…040000`, `…050000`, `…100000`, `3eb3b8d`…`7b1cff3`, `4c629df` |
| Catatan Siswa | audit Codex A-01…A-12, B-04/B-05, tutup bagi admin | `…060000`…`…090000`, `257e21c`…`de170e4` |
| Semester | membuka Semester 2 menyalin pendaftaran kelas; roster guru difilter semester (DG-02) | `…110000`, `b5cf731` |
| Uji tetap | kasus-penonton, kasus-aturan, catatan, semester, offline-antrean | `dc10ba1`, `b5cf731`, `4c629df` |
| Data uji | mapel CSV SMK 1 disamakan dengan label jadwal | folder data-uji SMK 1 (di luar repo) |

---

## 3. Aturan produk yang sudah berlaku (jangan diubah tanpa Romo)

### 3.1 Kasus pembinaan (tab Pembinaan Siswa)
- **Selalu boleh baca:** pembuat, penangan mana pun (sekarang atau dulu), Kepala Sekolah, Waka Kesiswaan.
- **Hanya jika ditandai (penonton, baca saja):** wali kelas, guru wali, BK, Kaprodi, staf lain, orang tua, siswa. Guru wali mendampingi siswa dari
  awal sampai lulus (penugasan berlanjut antar tahun ajaran).
- **Menandai:** pembuat atau penangan sekarang. **Mencabut:** hanya pembuat. Notifikasi `CASE_TAGGED` singkat (menyebut nama siswa, tanpa isi kasus).
- **Admin tidak membaca isi kasus** (hanya hitungan/aktivitas tanpa judul lewat `fn_admin_case_*`).
- **Pengawas** (Waka Kesiswaan/Kepsek) yang membuka kasus orang lain dicatat (maks. 1x per jam per pengawas); pembuat/penangan melihat log itu.
- **Eskalasi:** hanya ke kandidat terkait kasus (`fn_get_escalation_candidates`), ditegakkan trigger di server.
- **Status:** maju bebas; mundur hanya **satu langkah** dan wajib catatan (min. 5 karakter); kasus CLOSED hanya dibuka kembali oleh **Waka Kesiswaan atau
  Kepsek**, ke Monitoring, wajib catatan (`closed_at` dikosongkan). Penutupan lewat event `CLOSED`.
- **Event:** hanya `NOTE_ADDED` yang boleh terlihat oleh siswa/orang tua; event lain dipaksa tidak terlihat. Tabel `student_updates` tertutup (tidak dipakai).
- **Portal orang tua/siswa:** menampilkan kasus yang dibagikan ATAU yang menandai mereka sebagai pembaca; RLS yang membatasi, bukan filter klien.

### 3.2 Catatan Siswa (tab Catatan, milik guru)
- **Hanya penulis (guru), siswa, dan orang tua.** Tidak ada pihak lain di sekolah yang terhubung (BK, Kepsek, semua Waka, admin: terbukti membaca 0 baris).
  Perkecualian di luar tab ini: catatan DUDI untuk PKL (visibilitas RESTRICTED).
- Server menegakkan: penulis harus mengajar siswa itu (jadwal atau penugasan mengajar aktif), akun aktif dan belum dihapus, upsert tidak menimpa catatan
  penulis lain, periode akademik yang ditutup mengunci penambahan/perubahan isi.
- Sentimen hanya **Positif** dan **Perlu Perhatian** (opsi Netral dihapus). Penulis dapat **membatalkan** catatannya (alasan min. 5 karakter; disembunyikan
  dari siswa/ortu, tidak dihapus) lewat `fn_void_observation`. Admin tidak lagi punya kebijakan ubah/void (`rls_observations_void_admin` dihapus).
- Notifikasi siswa/ortu kini muncul untuk visibilitas `SISWA_SAJA`, `ORTU_SAJA`, `SISWA_DAN_ORTU`.
- Admin hanya boleh **menghitung** catatan (`fn_admin_observation_count`) untuk pemeriksaan sebelum hapus data/tutup semester; layar admin tidak lagi
  menampilkan log atau rekap catatan.

---

## 4. Data uji yang sengaja ditinggalkan di produksi (sekolah uji `smkuji1`, semuanya sintetis)

**Keputusan Romo (17 Okt): dibiarkan, tidak dihapus.** Jangan menghapusnya tanpa perintah baru dari Romo.

- Kasus **"UJI tahap 3 pembaca kasus"**: siswa Ainun Qanita Hamzah, status Monitoring, penangan Anwar Batubara; pembaca: Sari Wahyudi, Gunawan Pane,
  Alya Mardiah Hamzah (orang tua), Ainun (siswa); komentar uji terlihat dan internal; beberapa event status. **Romo menghapusnya sendiri** bila perlu
  (saya tidak boleh menghapus).
- Catatan Siswa uji "UJI B-04…" untuk Adelia Rahayu Hamzah: sudah dibatalkan.
- Akun uji yang dipakai: guru Anwar Batubara, wali kelas Gunawan Pane (kelas lain), Waka Kesiswaan Budi Ramadhan, Kepsek Ahmad Harahap,
  orang tua Alya Mardiah Hamzah (NIK `9901015403730562`), siswa Ainun Qanita Hamzah (NIS `2025100586`). **Kata sandi tidak dicatat**; ada di berkas
  data uji atau setel ulang lewat portal admin.

---

## 5. Pekerjaan yang masih terbuka

1. (Selesai 17 Okt sore) `supabase migration list` lokal = remote sampai `…110000`; deploy `sync-observation` terkonfirmasi. Ulangi di awal sesi berikutnya.
2. **Antrean luring kasus: SELESAI** (commit `4c629df`, sudah di GitHub). Kasus yang mengantre tampil di blok "Menunggu dikirim" di atas daftar Pembinaan Siswa (nama siswa, judul, status menunggu atau ditolak server + pesan), dengan tombol **Hapus dari perangkat** (konfirmasi; hanya milik akun yang login; tidak menyentuh server) dan **Coba kirim sekarang**. Fungsi: `listQueuedCases`, `discardQueuedCase` di `guru/js/offline.js`; uji T15–T16 di `tests/offline-antrean.mjs` (16 lulus). Dibuktikan di peramban dengan memutus koneksi saat Simpan. Catatan: modal Buat Kasus tidak dapat dibuka saat luring (sudah begitu dari awal), jadi antrean terjadi bila koneksi putus atau server gagal sementara saat menyimpan.
3. **Berkas uji tetap: SELESAI** (commit `dc10ba1`, sudah di GitHub; ditambah `tests/semester.mjs` di `b5cf731`). `node tests/kasus-penonton.mjs` (28), `node tests/kasus-aturan.mjs` (27), `node tests/catatan.mjs` (22): semua LIVE, di dalam transaksi yang dibatalkan, memakai data smkuji1, dan sisanya diperiksa sama dengan keadaan awal (tahan terhadap kasus uji manual yang tertinggal). Opsi `UJI_TERAPKAN_MIGRASI=1` menerapkan migrasi di dalam transaksi uji untuk memeriksa sebelum `supabase db push`. Kontrol negatif sudah dicoba (mencabut trigger membuat uji gagal). Jebakan: `when others` di plpgsql TIDAK menangkap kode P0004 (ASSERT_FAILURE) — tulis `when assert_failure or others`; `execute ... into` pada INSERT butuh `returning`; kolom `users` terlindungi (set `app.bypass_users_guard`).
4. `sync-attendance-batch`: kode sudah dipetakan ke 400 (periode ditutup, jadwal tidak ada, nilai tidak valid), **sudah dideploy (v4, 17 Okt 10.33 WIB, terkonfirmasi lewat `supabase functions list`)**. Commit `05e8285` sempat belum terkirim ke GitHub karena autentikasi push gagal (lihat bagian 1).
5. **DG-02: SELESAI dan terpasang** (migrasi `20261017110000` di lokal dan remote; commit `b5cf731` di GitHub; `node tests/semester.mjs` lulus 10 terhadap produksi). Temuan lebih besar dari audit awal: pergantian Semester 1→2 dalam tahun yang sama TIDAK membuat pendaftaran kelas Semester 2 (`fn_close_semester` hanya menggeser `current_semester`; panel admin "Buka Semester 2" hanya menambah baris `academic_periods`). Terbukti: setelah tutup Semester 1, pendaftaran Semester 2 = 0 dan kandidat kasus kehilangan Wali Kelas dan Guru BK; absensi Edge (`sync-attendance-batch` memfilter semester jadwal) akan menolak semua siswa. Perbaikan: `fn_open_next_semester(p_start,p_end)` (admin; membuat periode ACTIVE + menyalin pendaftaran Semester 1 aktif ke 2; idempotent), dipanggil dari `admin/js/semester.js`; roster guru (`getEnrolledStudents`, `getMyStudents`) memfilter semester dan menghapus duplikat. Uji tetap: `node tests/semester.mjs` (10). **Sekolah yang SUDAH menutup Semester 1 sebelum migrasi ini terpasang** perlu memanggil `fn_open_next_semester` sekali (idempotent) — belum ada sekolah seperti itu (semester berjalan semua 1, per 17 Okt).
6. **Mapel CSV SMK 1: SELESAI.** `pemetaan_mapel_guru_5_program.csv` (folder data-uji SMK 1) kini memakai label pendek yang sama dengan `template_jadwal_5_program_v2.xlsx` untuk tiga guru: ESA (Akuntansi Jasa, Dagang, Manufaktur), VAN (Otomatisasi Keuangan dan Sarpras), KFA (Muatan Lokal (Budaya Melayu Riau)). Terverifikasi: semua nama mapel di CSV ada persis di jadwal; berkas asli dicadangkan sebagai `…sebelum-penyamaan.csv`. CSV ini hanya referensi (tidak diimpor). Masih tertunda: jadwal SMK 2/3 (atas permintaan Romo).
7. **Uji isolasi dijalankan dari sesi Claude (17 Okt siang):** `SIP_MGMT_MODE=cli node tests/tenant-isolation.mjs` (mode CLI tanpa token; tanpa mode itu skrip menuntut `SUPABASE_ACCESS_TOKEN`, yang tidak boleh diketik di chat). Hasil awal 3 pelanggaran, semuanya bukan kebocoran: S4 (uji lama mengharuskan `student_updates` punya policy baca staf, padahal sejak migrasi `…100000` sengaja tertutup) dan C16-1/C16-2 (uji memilih catatan TERBARU di basis data, yaitu catatan uji yang sudah dibatalkan, yang memang tersembunyi dari siswa/ortu). Uji diperbaiki (commit `test(isolasi)…`) dan hasilnya **LULUS, 155 pemeriksaan, tanpa gagal**. Catatan: bagian C16 (siswa/ortu membaca catatan) kini SKIP karena tidak ada catatan non-batal di basis data; cakupannya digantikan `tests/catatan.mjs` (baca per peran). Hasil di terminal Romo sendiri belum dikonfirmasi.
8. Cron evaluasi guru: lihat memori `project_cron-evaluasi-guru-menunggu` (putaran 18 Okt 00:00 WIB).
9. **Selesai (17 Okt siang):** `HANDOFF-SESI-2026-10-17.md` diperbarui seluruhnya: bagian 0–3 (HEAD, 34 migrasi, edge v3/v4, tabel sekolah dari foto Lampiran A, akun push) dan bagian 4–13 (4B data uji SMK ditulis ulang sesuai keadaan nyata; 4D dan 5 ditambah; 6, 7, 9, 10, 11, 12 ditambah butir 17 Okt; 8 koreksi bahwa push dijalankan Romo). Lampiran A tidak diubah.
10. **Audit Codex tab "Jurnal Mengajar" (17 Okt siang): laporan diterima dan diverifikasi ke kode/RLS** (laporan di scratchpad sesi `codex-audit-jurnal/keluaran/`, hilang bersama sesi). 11 butir A semuanya terbukti dari kode; 8 pertanyaan rancangan B (B-01…B-08) belum dijawab Romo. **Diperbaiki (commit `cce80c0`, uji `tests/penilaian-api.mjs` 7 + `tests/offline-antrean.mjs` T17–T19):** A-01 (roster per tahun+semester tanpa duplikat), A-10 (NIS ikut roster), A-04 (nilai dikosongkan menghapus hasil lama; tindak lanjut dipertahankan), A-05 (rekap siswa tanpa nilai dihapus; rekap TP dihapus saat asesmen sumatif dihapus), A-07 (hapus jurnal luring 5xx ditahan), A-11 (paginasi hasil dan rekap). **Diperbaiki berikutnya (commit `074444c`, migrasi `20261017120000_jurnal_nilai_validasi_server.sql`, uji LIVE `node tests/jurnal-nilai.mjs` 15):** A-02 (trigger `fn_assessment_result_validate`: kelas/sekolah hasil = asesmen, siswa terdaftar di kelas+periode asesmen; koreksi baris yang kuncinya tak berubah tetap boleh) dan A-06 (trigger `fn_teacher_journal_date_check`: tidak di masa depan WIB, tidak lebih dari setahun lalu; kunci periode ditutup SENGAJA tidak dipasang karena B-07 belum diputuskan); `sync-journal` memetakan galat tanggal ke 400 (**perlu `supabase functions deploy sync-journal` oleh Romo**). **A-03 dan A-08 diperbaiki (commit `a0acaac`; migrasi `20261017130000_tp_taught_validasi.sql`; uji LIVE `tests/jurnal-nilai.mjs` kini 20):** A-08 = `fn_toggle_tp_taught` mensyaratkan TP ada, milik guru pemanggil, satu sekolah, dan berada pada kelas yang dikirim (kontrol negatif: fungsi lama menerima semuanya). A-03 = penafsiran Claude bahwa rekap nilai akhir tersimpan PER TP (tabel `grade_recap` dan e-Rapor satu baris per TP): tab Rekap kini punya filter "TP"; TP sasaran ditentukan dari penilaian sumatif yang TAMPIL (bukan penilaian pertama mana pun); bila beberapa TP tampil sekaligus, Simpan Rekap ditolak dengan pesan agar memilih satu TP. Ini **perubahan UI yang belum diuji di layar** dan **belum dikonfirmasi Romo** sebagai arah rancangan rekap (satu rekap per TP, bukan satu per mapel). **A-09 diperbaiki** (commit `83563ae`: `rekapUntukMapel` menyaring rekap ke TP mapel yang diekspor; uji `tests/penilaian-api.mjs` kini 8; perubahan UI ekspor belum diuji di layar). Perubahan UI penilaian (alur simpan nilai/rekap) **belum diuji di layar** (peramban otomatis terputus); hanya lapisan API dan antrean yang diuji.
11. **Nilai rapor per mata pelajaran (dibangun 17 Okt sore; menunggu `supabase db push` migrasi `20261017140000_nilai_rapor.sql` dan push git; belum diuji di layar).**
    Berdasar dokumen resmi (lihat memori `erapor-resmi`): **Panduan Pembelajaran dan Asesmen 2025** (nilai rapor hanya dari sumatif; tiga opsi: rata-rata, pembobotan, persentase TP tercapai; ketercapaian per TP) dan **Panduan e-Rapor SMK 2025** (guru mapel menginput SATU nilai akhir 0–100 per siswa per mapel, mencentang TP T/R; operator/admin tidak boleh menginput; wali kelas hanya mengecek dan mencetak). Keputusan Romo: ikuti rancangan ini; Kepsek dan Waka Kurikulum boleh membaca; format ekspor "tandai saja" (belum dicocokkan); tanpa publikasi ke portal siswa/orang tua.
    - **DB:** tabel `grade_final` (RLS: guru penyimpan baca/tulis; wali kelas baca lewat `fn_wali_of_student`; Kepsek dan Waka Kurikulum baca; lainnya tidak), trigger `fn_grade_final_validate` (siswa terdaftar di kelas+periode, mapel milik sekolah, guru mengajar kelas+mapel itu), CHECK nilai 0–100 dan T/R tidak tumpang tindih. `delete-school` memuat `grade_final` (perlu deploy ulang bila ingin ikut: `supabase functions deploy delete-school`). Uji LIVE `node tests/nilai-rapor.mjs` (15; kontrol negatif dicoba).
    - **Klien:** `guru/js/nilai-rapor.js` (logika murni; `tests/nilai-rapor-hitung.mjs` 11, termasuk angka contoh panduan resmi; pembobotan membulatkan tiap komponen seperti contoh panduan), `guru/js/nilai-rapor-ui.js` (bagian "Nilai Rapor" di tab Penilaian: saran, nilai, T/R, deskripsi, simpan, ekspor; uji asap tanpa peramban `tests/nilai-rapor-ui.mjs` 6), fungsi API `getGradeFinal`/`upsertGradeFinalBatch`/`deleteGradeFinalForStudents` (`tests/penilaian-api.mjs` 9). Ekspor lembar "e-Rapor" kini satu baris per siswa dengan T/R pada kolom TP dan lembar "Catatan" yang menyatakan **belum dicocokkan dengan "Format Nilai Kelas" e-Rapor resmi**.
    - **Belum ada:** layar baca untuk wali kelas/Kepsek/Waka Kurikulum (hak baca ada di DB; layar belum dibangun); pencocokan format Excel e-Rapor asli; uji tampilan di peramban.
    - **Temuan sampingan:** wali kelas pada data nyata berperan `GURU` dengan `wali_kelas_class_id` (60 akun), sedangkan kebijakan baca lama `rls_assessment_results_select_wali` dan `rls_grade_recap_select_wali` mensyaratkan peran `WALI_KELAS` sehingga tidak pernah cocok: wali kelas **tidak** dapat membaca nilai asesmen/rekap lewat kebijakan itu (kaitan B-03). Kebijakan `grade_final` memakai `fn_wali_of_student` tanpa memeriksa peran.
    - **Menunggu Romo:** `supabase db push`, `git push origin main`, lalu mencoba bagian Nilai Rapor sebagai guru di layar.

---

## 6. Jebakan alat yang ditemukan hari ini

- **CLI Supabase:** `supabase db query` dengan beberapa pernyataan hanya mengembalikan hasil pernyataan **terakhir**; untuk beberapa hasil pakai satu
  pernyataan per berkas atau kumpulkan ke tabel sementara lalu `select`. Nol baris = keluaran kosong. Pembungkus `begin; … rollback;` aman untuk uji
  terhadap produksi dengan data sintetis; peniruan login: `set_config('request.jwt.claims', …)` + `set local role authenticated`.
- **Peramban otomatis:** tab latar belakang cepat **membeku** (CDP timeout). Obatnya: buka tab baru, tutup yang lama. Untuk memuat ulang modul JS setelah
  perubahan: `fetch(url,{cache:'reload'})` lalu muat ulang; atau `navigate`. Satu sesi login per **origin**: pakai port server berbeda
  (`python -m http.server <port> --bind 127.0.0.1`) untuk beberapa akun sekaligus. URL login harus `index.html?school=smkuji1` (tanpa parameter,
  halaman menolak).
- **CRLF:** `guru/js/*.js`, `guru/dashboard.html`, `admin/js/*` ber-CRLF atau LF campur; ubah lewat skrip node yang mendeteksi akhir baris (lihat
  memori `crlf-git-bash-gotcha`). `node --check` hanya untuk `.mjs`; salin dulu ke `.mjs` untuk memeriksa sintaks berkas `.js` modul.
- **Heredoc bash dengan `$function$`:** hindari menyematkan `$` lewat `node -e "…"` ber-kutip ganda (jadi `\$`); tulis berkas dengan alat Write.
- Notifikasi jenis baru butuh CHECK `notifications_type_check` diperbarui (sudah memuat `CASE_TAGGED`).

## 12. Keterlihatan nilai dan layar pimpinan (jawaban Romo 17 Okt, sore)

Keputusan Romo: (a) guru berperan ganda tidak boleh terblokir; (b) guru punya tombol izin tampil nilai ke siswa saja / orang tua saja / keduanya; (c) Waka Kurikulum dan Kepsek otomatis melihat nilai setiap TP.

- Migrasi `20261017150000_nilai_keterlihatan_dan_pimpinan.sql` (dikomit, BELUM dipasang: `supabase db push`): `fn_is_teaching_staff`, 24 kebijakan guru diganti, `grade_final.is_visible_siswa/ortu` (bawaan false), cabang `RAPOR` di `fn_get_all_grades_summary`, `fn_nilai_per_tp`, `fn_nilai_per_tp_siswa`.
- Klien: dua centang izin di panel Nilai Rapor (`nilai-rapor-ui.js`, berlaku untuk seluruh kelas, tersimpan bersama tombol Simpan); kartu "Nilai per Tujuan Pembelajaran" di tab Waka Kurikulum dan Kepala Sekolah (`nilai-pimpinan-ui.js`, dipasang dari `initWakaKurTab`/`initKepsekTab`).
- Uji: `tests/nilai-rapor-ui.mjs` (7), `tests/penilaian-api.mjs` (9), `tests/nilai-pimpinan-ui.mjs` (5), LIVE `tests/nilai-keterlihatan.mjs` (18, setelah migrasi dipasang). Layar belum dicoba di peramban sungguhan.
- Belum diputuskan Romo: apakah Kaprodi/Waka Humas/Waka Kesiswaan dicabut aksesnya membaca semua nilai; nasib kebijakan baca `WALI_KELAS` lama pada asesmen/rekap.
- Urutan Romo: `supabase db push`, `supabase functions deploy sync-journal`, `supabase functions deploy delete-school`, `git push origin main`.
