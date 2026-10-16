-- ============================================================================
-- Penjadwalan harian penandaan kehadiran guru per sesi (fn_evaluate_teacher_indicators).
--
-- Latar: kolom teaching_schedules.teacher_indicator bernilai PENDING_EVALUATION sejak sesi dibuat dan hanya berubah menjadi
-- HADIR saat guru mengirim absensi. Sesi yang tidak diisi tidak pernah menjadi TIDAK_HADIR karena proses harian yang
-- seharusnya menandainya tidak pernah dipasang (cron di baseline hanya komentar; fungsi edge evaluate-teacher-indicators
-- tidak pernah ter-deploy). Di produksi, 27.201 dari 27.201 sesi masih PENDING_EVALUATION (dibaca 16 Okt 2026).
--
-- Jalur ini memanggil fungsi SQL langsung dari pg_cron: tanpa fungsi edge, tanpa HTTP, tanpa kunci rahasia apa pun.
-- Jadwal: 17:00 UTC = 00:00 WIB. Pada saat itu semua sesi hari WIB yang baru berakhir sudah selesai. Yang dievaluasi
-- adalah hari WIB kemarin dan dua hari lalu (hari kedua sebagai penyusul bila sinkron luring terlambat memasukkan catatan).
-- Fungsi hanya menyentuh sesi PENDING_EVALUATION, meeting_status NORMAL, tanpa guru pengganti; sesi yang sudah
-- HADIR tidak berubah. Pemanggilan ulang aman (idempoten).
--
-- Idempoten: cron.schedule dengan nama sama memperbarui tugas yang ada. Bila pg_cron tidak ada (mis. PGlite), dilewati.
-- ============================================================================

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'evaluate-teacher-indicators-daily',
      '0 17 * * *',
      $cmd$SELECT count(*) FROM generate_series(1, 2) AS g, LATERAL public.fn_evaluate_teacher_indicators(((now() AT TIME ZONE 'Asia/Jakarta')::date - g)::date)$cmd$
    );
  ELSE
    RAISE NOTICE 'pg_cron tidak terpasang; penjadwalan evaluasi kehadiran guru dilewati.';
  END IF;
END
$mig$;
