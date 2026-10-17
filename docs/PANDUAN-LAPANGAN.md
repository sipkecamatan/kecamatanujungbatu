# Panduan Lapangan SIP

Untuk operator (superadmin) yang menjawab pertanyaan petugas kecamatan, kabupaten, provinsi, dan sekolah.
Diperbarui 16 Oktober 2026 · salinan lokal (tidak di-commit). Dasbor kabupaten dan provinsi kini daftar sekolah datar (live 16 Okt 2026).

Rujukan definisi dan aturan isolasi: `docs/ARSITEKTUR-ISOLASI.md` (dokumen SSoT lama sudah dihapus 16 Okt 2026).

Tanda: **bisa** = bisa dilakukan dari layar; **jalan memutar** = belum ada tombolnya, ada cara lain; **belum ada** = belum tersedia.

## Dasar yang perlu diingat

- **Wilayah hanyalah penanda cakupan sekolah**, bukan rantai komando. Kecamatan, kabupaten, dan provinsi berdiri sendiri.
- **Pegawai hanya melihat angka ringkas** dari sekolah yang (1) dicatat pada wilayahnya oleh superadmin **dan** (2) disetujui kepala sekolah untuk tingkat pegawai itu.
- **Satu pegawai terikat pada satu wilayah.** Satu wilayah boleh punya banyak pegawai.
- Dasbor pegawai punya tiga alamat: `/kecamatan/`, `/kabupaten/`, `/provinsi/` (judul "Dashboard Kecamatan/Kabupaten/Provinsi"). Alamat hanya pintu masuk: tingkat pegawai ditentukan akunnya, dan akun yang membuka alamat tingkat lain dialihkan otomatis ke alamat tingkatnya. Portal superadmin memberi tautan yang sesuai pada tiap kartu wilayah. Pengelolaan: `/superadmin/`.

## A. Pegawai berganti orang

**1. Pegawai lama pindah atau pensiun. Bagaimana mencabut aksesnya?** (bisa)
Tab **Wilayah**, kartu wilayah pegawai itu, tombol **Hapus** di samping namanya. Akun loginnya ikut terhapus dan aksesnya putus seketika, bahkan bila ia sedang membuka dasbor.

**2. Pegawai baru menggantikan. Mana dikerjakan lebih dulu?** (bisa)
Daftarkan pegawai baru dulu (**+ Daftarkan pegawai** pada kartu wilayah), baru hapus yang lama, agar wilayah tidak pernah tanpa pegawai. Satu wilayah boleh punya beberapa pegawai.

**3. Orang yang sama menggantikan dan ingin memakai email lama.** (bisa)
Email bisa dipakai lagi setelah akun lamanya dihapus. Kata sandi sementaranya baru dan acak.

**4. Pegawai lupa kata sandi.** (bisa)
Tab **Wilayah**, kartu wilayah pegawai itu, tombol **Reset kata sandi** di samping namanya. Kata sandi sementara baru tampil sekali di kotak kredensial; salin dan sampaikan lewat jalur aman. Kata sandi lama langsung tidak berlaku. Pada masuk berikutnya pegawai **dipaksa** membuat kata sandi baru sebelum melihat data (pertanyaan 6). Tidak perlu menghapus akun. Catatan: reset **tidak memutus sesi yang sudah terbuka**; bila akun diduga disalahgunakan, pakai **Hapus** lalu daftarkan ulang.

**5. Salah ketik nama atau email saat mendaftarkan.** (jalan memutar)
Belum ada tombol ubah. Hapus lalu daftarkan ulang dengan data yang benar.

**6. Pegawai ingin mengganti kata sandi sendiri.** (bisa)
Tombol **Ganti kata sandi** di dasbor: kata sandi lama wajib diisi, baru minimal 10 karakter. Untuk akun yang baru didaftarkan atau baru direset, penggantian **dipaksa** pada masuk pertama: dialog muncul dan angka baru terbuka setelah kata sandi diganti. Ini ditegakkan di server, bukan hanya di layar.

**7. Dua orang memakai satu akun bersama.** (tidak dianjurkan)
Secara teknis bisa, tetapi tidak ada catatan siapa yang membuka dasbor. Beri satu akun per orang; satu wilayah boleh punya banyak akun.

## B. Wilayah tugas pegawai

**8. Satu orang bertugas di dua kecamatan.** (belum ada)
Satu akun hanya terikat pada satu wilayah. Pilihannya: daftarkan di wilayah **kabupaten** (melihat sekolah yang disetujui untuk kabupaten), atau pakai dua email.

**Catatan: perpindahan pegawai antar-wilayah.** Tidak diakomodir sebagai fitur (belum ada)
Akun terikat pada satu wilayah dan tidak dapat dipindahkan. Bila seseorang memang berpindah tugas, hapus pegawai itu di wilayah asal dan daftarkan di wilayah tujuan; ia mendapat akun dan kata sandi sementara baru (email boleh sama). Ini sengaja tidak dijadikan fitur.

**9. Pegawai kabupaten ingin rincian per kecamatan.** (tidak akan ada)
Dasbor kabupaten dan provinsi berupa **daftar sekolah datar** dengan kotak pencarian nama dan pilihan urutan (live sejak 16 Okt 2026; lihat `docs/ARSITEKTUR-ISOLASI.md`). Keputusan Romo: pegawai wilayah hanya mengenal nama sekolah, tanpa label wilayah lain, sehingga rincian per kecamatan sengaja tidak disediakan.

## C. Sekolah dan persetujuan

**10. Sekolah dimasukkan ke kecamatan atau kabupaten yang salah.** (bisa)
Tab **Sekolah**, kartu sekolahnya: tekan **Ubah penghubungan**, pilih Kabupaten/Kota lalu Kecamatan dari daftar resmi (kabupaten dan provinsi mengikuti kecamatan itu), atur tiga kotak centang (dicentang = terhubung), lalu simpan dan setujui konfirmasinya. Server menolak kabupaten atau provinsi yang kodenya tidak cocok dengan kecamatan. Persetujuan berbagi pada tingkat yang berubah atau diputus otomatis direset, jadi kepala sekolah perlu menyetujui lagi. Pada kartu Kabupaten dan Provinsi di tab Wilayah, daftar sekolah hanya baca (tidak ada Simpan atau Lepas).

**11. Kepala sekolah diganti. Bagaimana persetujuan lama?** (diatur sekolah)
Pergantian kepala sekolah dilakukan oleh admin sekolah lewat **wizard admin** (jabatan KEPSEK pada data staf), bukan oleh superadmin. Persetujuan berbagi yang lama **tetap berlaku** dan tidak direset; ini sudah diputuskan. Kepala sekolah baru dapat mengubahnya kapan saja lewat kartu **Berbagi Ringkasan ke Wilayah** di portal guru.

**12. Kepala sekolah ingin berhenti berbagi.** (bisa)
Portal guru, kartu **Berbagi Ringkasan ke Wilayah**, tombol **Hentikan berbagi** per tingkat. Sekolah langsung hilang dari dasbor tingkat itu.

**13. Dasbor pegawai kosong.** (periksa berurutan)
1. Sekolah sudah dihubungkan ke wilayah pegawai itu? (tab Sekolah, kartu sekolahnya; atau lihat daftar di kartu wilayahnya pada tab Wilayah)
2. Kepala sekolah sudah menyetujui **untuk tingkat pegawai itu** (kecamatan, kabupaten, atau provinsi)?
3. Sekolah masih aktif?
4. Angka total hanya tampil bila minimal 3 sekolah berbagi; angka kecil (di bawah 5 keterlambatan atau izin keluar) tampil sebagai "< 5".

**14. Sekolah tutup atau tidak aktif.** (bisa)
Tab **Sekolah**, tombol **Nonaktifkan**: sekolah hilang dari semua dasbor, datanya aman, dan bisa diaktifkan lagi. **Hapus Permanen** menghapus semuanya dan tidak bisa dibatalkan. Ruang disk tidak langsung kembali; bila sekolahnya besar, minta operator menjalankan pembersihan ruang (lihat panduan cadangan, bagian 5).

**15. Kecamatan baru hasil pemekaran belum ada di daftar.** (jalan memutar)
Daftar tiap provinsi berasal dari berkas data. Pembaruannya dikerjakan lewat pengembang dengan menjalankan ulang `tools/buat-daftar-wilayah.mjs` untuk provinsi itu. Sementara itu, catat sekolah pada kecamatan induknya.

**16. Ejaan nama kecamatan berbeda dari pemakaian setempat** (misalnya "Ujungbatu" dan "Ujung Batu"). (belum ada)
Nama mengikuti sumber data. Mengubahnya butuh perbaikan berkas; tidak memengaruhi fungsi.

## D. Mengelola wilayah dan data

**17. Wilayah salah dibuat dan ingin dihapus.** (bisa)
Tombol **Hapus wilayah** pada kartunya. **Selalu boleh** (keputusan Romo 16 Okt 2026): sekolah yang bertanda wilayah itu dilepas dari penandanya dan persetujuan berbagi tingkat itu direset ke "tidak"; pegawai wilayah itu dihapus beserta akun loginnya. Dialog konfirmasi menyebut jumlah sekolah dan pegawai yang terdampak, jadi baca angkanya sebelum menyetujui. Urutan antar-wilayah bebas.

**18. Wilayah di luar Riau.** (jalan memutar)
Belum muncul di pilihan karena daftarnya belum ditambahkan. Menambahkannya mudah dan tidak mengubah kode: pengembang menjalankan alat `tools/buat-daftar-wilayah.mjs` dengan kode provinsinya, lalu commit dan push. Setelah itu provinsi baru muncul di pilihan Provinsi.

**19. Pegawai ingin mengunduh data.** (bisa)
Tombol **Unduh data (CSV)** di dasbor menyimpan angka yang tampil pada jendela waktu terpilih (total dan tiap sekolah) ke berkas yang dapat dibuka di Excel. Berkas memuat nama wilayah, jendela waktu, dan tanggal unduh; angka kecil tetap "< 5" dan tidak ada nama siswa. Dasbor mengingatkan bila sudah lebih dari 30 hari sejak unduhan terakhir; pengingat memakai penyimpanan peramban pegawai, jadi berpindah komputer atau membersihkan peramban membuat pengingat muncul lagi. Ini arsip angka milik pegawai, bukan cadangan sistem. CSV memuat bagian Total, Subtotal jenjang, dan Sekolah (tanpa bagian Kabupaten atau Kecamatan; terbukti 16 Okt 2026).

**20. Mengetahui siapa membuka dasbor.** (belum ada)
Tidak ada catatan akses. Romo memutuskan mengabaikannya.

## Ringkas: cara menghapus apa

| Yang dihapus | Syarat | Tombol |
|---|---|---|
| Pegawai wilayah | Tidak ada | Tab Wilayah, kartu wilayahnya, **Hapus** |
| Wilayah | Tidak ada; sekolah dilepas dan pegawainya ikut terhapus (lihat dialog konfirmasi) | Tab Wilayah, kartu wilayahnya, **Hapus wilayah** |
| Sekolah (sementara) | Tidak ada | Tab Sekolah, **Nonaktifkan** |
| Sekolah (permanen) | Harus nonaktif; mengetik nama sekolah | Tab Sekolah, **Hapus Permanen** |
