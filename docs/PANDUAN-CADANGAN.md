# Panduan Cadangan dan Pemulihan Data SIP

Untuk operator. Diperbarui 15 Oktober 2026 · salinan lokal (tidak di-commit).
Dokumen terkait: `docs/HANDOFF-SESI-2026-10-15.md` (keadaan sistem), `docs/ARSITEKTUR-ISOLASI.md` (isolasi), `docs/PANDUAN-LAPANGAN.md` (tanya jawab petugas).

## Mengapa perlu

Paket Supabase Free tidak menjamin pemulihan titik waktu. Bila data terhapus atau rusak, tidak ada
cadangan otomatis yang dapat diandalkan. Cadangan ini dibuat dan disimpan oleh operator sendiri.

Unduhan CSV oleh pegawai wilayah **bukan** cadangan: isinya hanya angka ringkas dan tidak dapat
memulihkan sistem.

## Yang dicadangkan dan yang tidak

| Dicadangkan | Tidak dicadangkan | Sudah aman di tempat lain |
|---|---|---|
| Seluruh data tabel skema `public` (sekolah, siswa, absensi, wilayah, pegawai wilayah, persetujuan, dan lainnya) | Akun login (skema `auth`) dan berkas Storage | Skema, fungsi, dan kebijakan: ada di `supabase/migrations/` pada repo |

Akibatnya: setelah pemulihan, pegawai wilayah didaftarkan ulang dari portal superadmin (kata sandi
sementara baru), dan akun login sekolah dibuat ulang sesuai prosedur sekolah.

## 1. Membuat cadangan (mingguan)

Prasyarat: CLI Supabase sudah login dan proyek ter-link (`supabase link`). Tidak butuh Docker.

```
cd "D:\ribuan_pengguna\CLAUDE\SIP Kecamatan"
node tools/cadangan-data.mjs
```

- Hasil disimpan di folder **di luar repo**: `D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-cadangan\<tanggal-jam>\`.
  Berkas cadangan memuat data nyata; jangan pernah dimasukkan ke repo publik.
- Pilih tujuan lain dengan `--tujuan "E:\cadangan-sip"`. Alat menolak tujuan di dalam folder repo.
- Selesai bila tertulis `Selesai: N tabel, M baris.` dan tidak ada baris `PERHATIAN`.
- Berkas `manifest.json` di dalam folder mencatat jumlah baris per tabel dan waktu pembuatan.

Kebiasaan yang disarankan:
1. Satu kali seminggu, dan sebelum tindakan besar (hapus sekolah, migrasi basis data).
2. Simpan **empat salinan terakhir**; hapus yang lebih lama.
3. Salin satu folder cadangan ke tempat lain (flash disk atau penyimpanan terpisah).

## 2. Latihan memulihkan (dilakukan sekali, lalu setiap beberapa bulan)

Cadangan yang belum pernah dipulihkan belum terbukti berguna. Lakukan **pada proyek uji kosong**,
jangan pada produksi.

1. Buat proyek Supabase baru (Free) khusus uji; catat ref-nya.
2. Hubungkan dan terapkan seluruh migrasi:
   ```
   supabase link --project-ref <ref uji>
   supabase db push --linked
   ```
3. Pulihkan data:
   ```
   node tools/pulihkan-data.mjs "D:\ribuan_pengguna\CLAUDE\SIP Kecamatan-cadangan\<tanggal-jam>" --proyek <ref uji>
   ```
4. Bandingkan jumlah baris tiap tabel yang tercetak dengan `manifest.json`. Tidak boleh ada baris `PERHATIAN`.
5. **Hubungkan kembali ke produksi** agar perintah berikutnya tidak keliru sasaran:
   ```
   supabase link --project-ref lqgzpiohxdzkkmxjtwor
   ```

Pengaman pada alat pemulihan:
- Sasaran harus disebut eksplisit (`--proyek`) dan harus sama dengan proyek yang ter-link.
- Memulihkan ke produksi ditolak kecuali ditambah `--produksi-ya-saya-yakin`.
- Baris yang sudah ada dilewati; tidak ada yang ditimpa.
- Pemicu di tabel dimatikan selama pengisian dan dinyalakan kembali, supaya tidak muncul notifikasi palsu.

## 3. Bila data produksi benar-benar hilang

1. Jangan panik dan jangan menjalankan apa pun dulu; catat apa yang terjadi.
2. Pastikan skema produksi lengkap (`supabase migration list --linked`).
3. Pilih cadangan terbaru yang valid (`manifest.json` ada dan jumlah baris wajar).
4. Pulihkan dengan `--produksi-ya-saya-yakin`.
5. Daftarkan ulang pegawai wilayah; minta admin sekolah memeriksa akun yang diperlukan.
6. Kabari kepala sekolah bahwa persetujuan berbagi tercatat dalam cadangan dan ikut pulih.

## 4. Pemantauan ketersediaan (murah)

Tidak ada pemberitahuan galat bawaan. Pilihan paling sederhana: layanan pemeriksa ketersediaan
gratis (misalnya UptimeRobot) pada dua alamat:
- `https://sipkecamatan.github.io/kecamatanujungbatu/kecamatan/`
- `https://lqgzpiohxdzkkmxjtwor.supabase.co/functions/v1/set-maintenance` (balasan 401 pun berarti fungsi hidup)

Ini tidak mendeteksi galat di dalam aplikasi, hanya situs atau layanan yang mati.

## 5. Mengembalikan ruang setelah menghapus sekolah

Menghapus sekolah menghapus barisnya, tetapi **ruang di disk tidak otomatis kembali**. Tabel yang
besar (terutama `attendance` dan `teaching_schedules`) tetap memakai ruang lamanya. Akibatnya
tab Storage di portal superadmin menunjukkan pemakaian tinggi padahal data sudah kosong, dan
kuota Supabase Free (sekitar 500 MB) bisa terkuras.

Pada 15 Oktober 2026 kejadian ini nyata: setelah sekolah uji dihapus, `attendance` tetap
315 MB dengan 0 baris (database 344 MB). Setelah `VACUUM FULL`, turun menjadi 64 kB (database 30 MB).

Kapan dilakukan: setelah menghapus sekolah yang sudah banyak absensinya, atau bila tab Storage
menunjukkan ukuran tabel jauh lebih besar daripada jumlah barisnya.

```
cd "D:\ribuan_pengguna\CLAUDE\SIP Kecamatan"

# 1. periksa dulu: baris nyata dan ukuran tabel
supabase db query --linked "select (select count(*) from public.attendance) as baris, pg_size_pretty(pg_total_relation_size('public.attendance')) as ukuran;"

# 2. kembalikan ruang (satu tabel; ganti nama tabel bila perlu)
supabase db query --linked "VACUUM FULL public.attendance;"

# 3. perbarui statistik agar perkiraan baris di tab Storage benar
supabase db query --linked "ANALYZE;"
```

Hal yang perlu diperhatikan:
- `VACUUM FULL` mengunci tabel itu sebentar (tidak bisa dibaca atau ditulis). Jalankan saat sepi.
- Ia menyalin baris yang masih hidup ke berkas baru, jadi butuh ruang sebesar **data hidup**,
  bukan sebesar ukuran lama. Bila data hidup besar dan kuota nyaris penuh, lakukan sebelum
  kuota habis.
- Tidak menghapus data apa pun; hanya merapikan ruang. Tetap buat cadangan (bagian 1) sebelum
  tindakan besar.
- Lakukan per tabel besar saja; mengerjakan semua tabel tidak perlu.

## Batasan yang perlu diketahui

- Cadangan dibuat dengan membaca tabel satu per satu; bila ada penulisan besar selama pencadangan,
  jumlah baris bisa berbeda. Alat melaporkannya (`TIDAK COCOK`) dan keluar dengan kode 1; ulangi.
- Alat belum pernah dijalankan terhadap basis data berisi banyak data; pengujiannya baru pada basis
  data kosong dan data sintetis di PGlite.
