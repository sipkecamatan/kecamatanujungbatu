# Protocol: Session Start

Jalankan ini di awal SETIAP sesi sebelum ada perubahan apapun.

## Langkah Wajib (urut)

1. **Baca CONSTITUTION**
   ```
   Baca .claude/CONSTITUTION.json
   ```

2. **Verifikasi keadaan repo**
   ```
   git fetch && git status -sb
   supabase migration list --linked | tail -3
   ```
   Bandingkan dengan `state.main_sha` dan `state.migrasi_terpasang_sampai` di CONSTITUTION.
   Jika berbeda → laporkan perbedaannya ke Romo sebelum lanjut.

3. **Architect: tetapkan tujuan sesi**
   Nyatakan dalam SATU kalimat: "Tujuan sesi ini adalah [X]."
   Periksa apakah tujuan ini menyentuh constraint apapun di CONSTITUTION.

4. **Architect: nyatakan constraint aktif**
   "Constraint yang berlaku sesi ini: [daftar dari CONSTITUTION]"

5. **BARU mulai kerjakan**

## Yang Tidak Boleh Dilakukan Sebelum Langkah 1-4 Selesai
- Menulis kode apapun
- Menjalankan SQL apapun
- Mengubah file apapun
