-- ============================================================================
-- Rincian empat status absensi untuk dasbor wilayah dan kepala sekolah.
--
-- Migrasi ini mempertahankan seluruh key, tanda tangan, hak akses, ambang,
-- serta perilaku fungsi yang sudah ada. Hitungan status wilayah berasal dari
-- CTE attendance yang sama agar satuan tetap catatan absensi (siswa x sesi).
-- ============================================================================

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.fn_region_overview_range(
  p_from date, p_to date, p_kelompok uuid DEFAULT NULL, p_daftar_penuh boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region     uuid := public.fn_region_staff_region();
  v_from       date;
  v_to         date;
  v_days       integer;
  v_level      text;
  v_maks       integer;
  v_min_cov    constant integer := 80;
  v_min_piket  constant integer := 5;
  v_result     jsonb;
BEGIN
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(r.level, 'KECAMATAN') INTO v_level
  FROM public.regions r WHERE r.region_id = v_region;
  v_maks := CASE v_level WHEN 'PROVINSI' THEN 366 WHEN 'KABUPATEN' THEN 366 ELSE 366 END;
  -- p_kelompok dan p_daftar_penuh dipertahankan hanya untuk kompatibilitas.
  -- Keduanya sengaja tidak dipakai: keluaran selalu datar dan tanpa wilayah lain.
  v_to   := LEAST(COALESCE(p_to, public.fn_hari_ini()), public.fn_hari_ini());
  v_from := COALESCE(p_from, v_to - 29);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'tanggal awal setelah tanggal akhir' USING ERRCODE = '22023';
  END IF;
  IF v_to - v_from > v_maks - 1 THEN
    RAISE EXCEPTION 'rentang maksimum % hari', v_maks USING ERRCODE = '22023';
  END IF;
  v_days := v_to - v_from + 1;

  WITH sch AS (
    SELECT terlihat.school_id, terlihat.name, terlihat.jenjang
    FROM public.fn_region_sekolah_terlihat(v_region) AS terlihat
  ),
  sesi AS (
    SELECT ts.school_id,
           count(*)::int AS terjadwal,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.attendance a
             WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void))::int AS tercatat
    FROM public.teaching_schedules ts
    WHERE ts.school_id IN (SELECT school_id FROM sch)
      AND ts.session_date BETWEEN v_from AND v_to
      AND ts.meeting_status = 'NORMAL'
    GROUP BY ts.school_id
  ),
  hadir AS (
    SELECT a.school_id,
           count(*)::int AS baris,
           count(*) FILTER (WHERE a.status = 'HADIR')::int AS hadir,
           count(*) FILTER (WHERE a.status = 'SAKIT')::int AS sakit,
           count(*) FILTER (WHERE a.status = 'IZIN')::int AS izin,
           count(*) FILTER (WHERE a.status = 'ALPA')::int AS alpa
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    WHERE a.school_id IN (SELECT school_id FROM sch)
      AND NOT a.is_void
      AND ts.session_date BETWEEN v_from AND v_to
    GROUP BY a.school_id
  ),
  siswa AS (
    SELECT st.school_id, count(*)::int AS n
    FROM public.students st
    WHERE st.school_id IN (SELECT school_id FROM sch) AND st.student_status IN ('AKTIF','PKL')
    GROUP BY st.school_id
  ),
  ortu AS (
    SELECT u.school_id, count(*)::int AS n
    FROM public.users u
    WHERE u.school_id IN (SELECT school_id FROM sch)
      AND u.role_type = 'ORTU' AND u.is_active AND u.deleted_at IS NULL
    GROUP BY u.school_id
  ),
  telat AS (
    SELECT la.school_id, count(*)::int AS n
    FROM public.late_arrivals la
    WHERE la.school_id IN (SELECT school_id FROM sch)
      AND la.late_date BETWEEN v_from AND v_to
    GROUP BY la.school_id
  ),
  keluar AS (
    SELECT se.school_id, count(*)::int AS n
    FROM public.student_exits se
    WHERE se.school_id IN (SELECT school_id FROM sch)
      AND se.exit_date BETWEEN v_from AND v_to
    GROUP BY se.school_id
  ),
  per AS (
    SELECT sch.school_id, sch.name, sch.jenjang,
           COALESCE(siswa.n, 0) AS siswa_aktif,
           COALESCE(ortu.n, 0) AS orang_tua_aktif,
           COALESCE(sesi.terjadwal, 0) AS sesi_terjadwal,
           COALESCE(sesi.tercatat, 0) AS sesi_tercatat,
           COALESCE(hadir.baris, 0) AS baris,
           COALESCE(hadir.hadir, 0) AS hadir,
           COALESCE(hadir.sakit, 0) AS sakit,
           COALESCE(hadir.izin, 0) AS izin,
           COALESCE(hadir.alpa, 0) AS alpa,
           COALESCE(telat.n, 0) AS terlambat,
           COALESCE(keluar.n, 0) AS izin_keluar,
           CASE WHEN COALESCE(sesi.terjadwal,0) = 0 THEN NULL
                ELSE round(100.0 * sesi.tercatat / sesi.terjadwal)::int END AS cakupan_pct
    FROM sch
    LEFT JOIN siswa  ON siswa.school_id  = sch.school_id
    LEFT JOIN ortu   ON ortu.school_id   = sch.school_id
    LEFT JOIN sesi   ON sesi.school_id   = sch.school_id
    LEFT JOIN hadir  ON hadir.school_id  = sch.school_id
    LEFT JOIN telat  ON telat.school_id  = sch.school_id
    LEFT JOIN keluar ON keluar.school_id = sch.school_id
  ),
  nilai AS (
    SELECT per.*,
           CASE WHEN cakupan_pct >= v_min_cov AND baris > 0
                THEN round(100.0 * hadir / baris)::int END AS kehadiran_pct,
           CASE WHEN cakupan_pct >= v_min_cov AND baris > 0 AND sakit NOT BETWEEN 1 AND v_min_piket - 1
                THEN round(100.0 * sakit / baris)::int END AS sakit_pct,
           CASE WHEN cakupan_pct >= v_min_cov AND baris > 0 AND izin NOT BETWEEN 1 AND v_min_piket - 1
                THEN round(100.0 * izin / baris)::int END AS izin_pct,
           CASE WHEN cakupan_pct >= v_min_cov AND baris > 0 AND alpa NOT BETWEEN 1 AND v_min_piket - 1
                THEN round(100.0 * alpa / baris)::int END AS alpa_pct,
           CASE WHEN cakupan_pct >= v_min_cov AND baris > 0 THEN
             to_jsonb(array_remove(ARRAY[
               CASE WHEN sakit BETWEEN 1 AND v_min_piket - 1 THEN 'sakit' END,
               CASE WHEN izin  BETWEEN 1 AND v_min_piket - 1 THEN 'izin' END,
               CASE WHEN alpa  BETWEEN 1 AND v_min_piket - 1 THEN 'alpa' END
             ]::text[], NULL))
             ELSE '[]'::jsonb END AS absen_kecil,
           CASE WHEN cakupan_pct IS NULL OR sesi_terjadwal = 0 THEN 'TIDAK_ADA_JADWAL'
                WHEN sesi_tercatat = 0 THEN 'BELUM_ADA_DATA'
                WHEN cakupan_pct >= v_min_cov THEN 'MEMADAI'
                ELSE 'DATA_BELUM_MEMADAI' END AS status
    FROM per
  ),
  tot AS (
    SELECT count(*)::int AS n_sekolah,
           sum(siswa_aktif)::int AS siswa,
           sum(orang_tua_aktif)::int AS ortu,
           sum(sesi_terjadwal)::int AS terjadwal,
           sum(sesi_tercatat)::int AS tercatat,
           sum(hadir) FILTER (WHERE status = 'MEMADAI')::int AS hadir_ok,
           sum(sakit) FILTER (WHERE status = 'MEMADAI')::int AS sakit_ok,
           sum(izin) FILTER (WHERE status = 'MEMADAI')::int AS izin_ok,
           sum(alpa) FILTER (WHERE status = 'MEMADAI')::int AS alpa_ok,
           sum(baris) FILTER (WHERE status = 'MEMADAI')::int AS baris_ok,
           sum(terlambat)::int AS terlambat,
           sum(izin_keluar)::int AS izin_keluar
    FROM nilai
  ),
  jen AS (
    SELECT jenjang,
           count(*)::int AS n_sekolah,
           sum(siswa_aktif)::int AS siswa,
           sum(orang_tua_aktif)::int AS ortu,
           sum(sesi_terjadwal)::int AS terjadwal,
           sum(sesi_tercatat)::int AS tercatat,
           sum(hadir) FILTER (WHERE status = 'MEMADAI')::int AS hadir_ok,
           sum(sakit) FILTER (WHERE status = 'MEMADAI')::int AS sakit_ok,
           sum(izin) FILTER (WHERE status = 'MEMADAI')::int AS izin_ok,
           sum(alpa) FILTER (WHERE status = 'MEMADAI')::int AS alpa_ok,
           sum(baris) FILTER (WHERE status = 'MEMADAI')::int AS baris_ok,
           sum(terlambat)::int AS terlambat,
           sum(izin_keluar)::int AS izin_keluar
    FROM nilai GROUP BY jenjang
  )
  SELECT jsonb_build_object(
    'wilayah',       (SELECT r.name FROM public.regions r WHERE r.region_id = v_region),
    'jendela_hari',  v_days,
    'dari',          v_from,
    'sampai',        v_to,
    'ambang_cakupan_pct', v_min_cov,
    'ambang_piket',  v_min_piket,
    'tingkat',       v_level,
    'maks_hari',     v_maks,
    'mode_kelompok', NULL,
    'kelompok_nama', NULL,
    'kelompok',      '[]'::jsonb,
    'jumlah_sekolah_dibagikan', (SELECT n_sekolah FROM tot),
    -- Key dipertahankan demi kompatibilitas; nilainya sengaja sama dengan sekolah terlihat.
    'jumlah_sekolah_terdaftar', (SELECT n_sekolah FROM tot),
    'total', (SELECT CASE WHEN n_sekolah >= 3 THEN jsonb_build_object(
                'siswa_aktif', siswa,
                'orang_tua_aktif', ortu,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END,
                'sakit_pct', CASE WHEN baris_ok > 0 AND sakit_ok NOT BETWEEN 1 AND v_min_piket - 1
                                  THEN round(100.0 * sakit_ok / baris_ok)::int END,
                'izin_pct', CASE WHEN baris_ok > 0 AND izin_ok NOT BETWEEN 1 AND v_min_piket - 1
                                 THEN round(100.0 * izin_ok / baris_ok)::int END,
                'alpa_pct', CASE WHEN baris_ok > 0 AND alpa_ok NOT BETWEEN 1 AND v_min_piket - 1
                                 THEN round(100.0 * alpa_ok / baris_ok)::int END,
                'absen_kecil', to_jsonb(array_remove(ARRAY[
                  CASE WHEN baris_ok > 0 AND sakit_ok BETWEEN 1 AND v_min_piket - 1 THEN 'sakit' END,
                  CASE WHEN baris_ok > 0 AND izin_ok BETWEEN 1 AND v_min_piket - 1 THEN 'izin' END,
                  CASE WHEN baris_ok > 0 AND alpa_ok BETWEEN 1 AND v_min_piket - 1 THEN 'alpa' END
                ]::text[], NULL)),
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
              END FROM tot),
    'per_jenjang', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'jenjang', COALESCE(jenjang, 'TIDAK_DIKETAHUI'),
                'jumlah_sekolah', n_sekolah,
                'siswa_aktif', siswa,
                'orang_tua_aktif', ortu,
                'cakupan_pct', CASE WHEN terjadwal > 0 THEN round(100.0 * tercatat / terjadwal)::int END,
                'kehadiran_pct', CASE WHEN baris_ok > 0 THEN round(100.0 * hadir_ok / baris_ok)::int END,
                'sakit_pct', CASE WHEN baris_ok > 0 AND sakit_ok NOT BETWEEN 1 AND v_min_piket - 1
                                  THEN round(100.0 * sakit_ok / baris_ok)::int END,
                'izin_pct', CASE WHEN baris_ok > 0 AND izin_ok NOT BETWEEN 1 AND v_min_piket - 1
                                 THEN round(100.0 * izin_ok / baris_ok)::int END,
                'alpa_pct', CASE WHEN baris_ok > 0 AND alpa_ok NOT BETWEEN 1 AND v_min_piket - 1
                                 THEN round(100.0 * alpa_ok / baris_ok)::int END,
                'absen_kecil', to_jsonb(array_remove(ARRAY[
                  CASE WHEN baris_ok > 0 AND sakit_ok BETWEEN 1 AND v_min_piket - 1 THEN 'sakit' END,
                  CASE WHEN baris_ok > 0 AND izin_ok BETWEEN 1 AND v_min_piket - 1 THEN 'izin' END,
                  CASE WHEN baris_ok > 0 AND alpa_ok BETWEEN 1 AND v_min_piket - 1 THEN 'alpa' END
                ]::text[], NULL)),
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
                ORDER BY jenjang)
              FROM jen WHERE n_sekolah >= 2), '[]'::jsonb),
    'sekolah', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'school_id', school_id, 'nama', name, 'jenjang', jenjang,
                'siswa_aktif', siswa_aktif,
                'orang_tua_aktif', orang_tua_aktif,
                'sesi_terjadwal', sesi_terjadwal, 'sesi_tercatat', sesi_tercatat,
                'cakupan_pct', cakupan_pct, 'kehadiran_pct', kehadiran_pct,
                'sakit_pct', sakit_pct, 'izin_pct', izin_pct, 'alpa_pct', alpa_pct,
                'absen_kecil', absen_kecil, 'status', status,
                'terlambat', CASE WHEN terlambat BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE terlambat END,
                'izin_keluar', CASE WHEN izin_keluar BETWEEN 1 AND v_min_piket - 1 THEN NULL ELSE izin_keluar END)
                ORDER BY name, jenjang) FROM nilai), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview_range(date, date, uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview_range(date, date, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview_range(date, date, uuid, boolean) FROM PUBLIC;

-- Fungsi lama tetap mendelegasikan ke rentang, termasuk fungsi hari WIB.
CREATE OR REPLACE FUNCTION public.fn_region_overview(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
BEGIN
  RETURN public.fn_region_overview_range(public.fn_hari_ini() - (v_days - 1), public.fn_hari_ini(), NULL, true);
END $$;
GRANT  EXECUTE ON FUNCTION public.fn_region_overview(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_overview(integer) FROM PUBLIC;

-- Tren rentang: sekolah harus ada pada himpunan yang sama dengan overview.

CREATE OR REPLACE FUNCTION public.fn_kepsek_monitoring(p_period text DEFAULT 'hari_ini'::text, p_academic_year text DEFAULT NULL::text, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today       date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
    v_school_id   uuid;
    v_boleh_lihat boolean;
    v_date_start  date;
    v_date_end    date;
    v_by_month    boolean := FALSE;
    v_ay_year     int;
    v_summary     jsonb;
    v_chart       jsonb;
BEGIN
    SELECT school_id,
           (is_active IS TRUE AND deleted_at IS NULL
            AND (role_type IN ('KEPSEK', 'STAKEHOLDER') OR COALESCE(is_kepsek, FALSE)))
    INTO v_school_id, v_boleh_lihat
    FROM users
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
    END IF;
    IF NOT v_boleh_lihat THEN
        RAISE EXCEPTION 'Akses ditolak: monitoring ini hanya untuk Kepala Sekolah dan Stakeholder';
    END IF;

    CASE p_period
        WHEN 'hari_ini' THEN
            v_date_start := v_today;
            v_date_end   := v_today;
        WHEN '7_hari' THEN
            v_date_start := v_today - 6;
            v_date_end   := v_today;
        WHEN 'minggu_lalu' THEN
            v_date_start := date_trunc('week', v_today - 7)::date;
            v_date_end   := date_trunc('week', v_today)::date - 1;
        WHEN 'bulan_lalu' THEN
            v_date_start := date_trunc('month', v_today - interval '1 month')::date;
            v_date_end   := date_trunc('month', v_today)::date - 1;
        WHEN 'tahun_ajaran_lalu' THEN
            IF p_academic_year IS NULL THEN
                RAISE EXCEPTION 'p_academic_year wajib diisi untuk periode tahun_ajaran_lalu';
            END IF;
            v_ay_year    := split_part(p_academic_year, '/', 1)::int;
            v_date_start := make_date(v_ay_year, 7, 1);
            v_date_end   := make_date(v_ay_year + 1, 6, 30);
            v_by_month   := TRUE;
        WHEN 'rentang' THEN
            IF p_date_start IS NULL OR p_date_end IS NULL THEN
                RAISE EXCEPTION 'p_date_start dan p_date_end wajib diisi untuk periode rentang';
            END IF;
            IF p_date_start > p_date_end THEN
                RAISE EXCEPTION 'p_date_start tidak boleh setelah p_date_end' USING ERRCODE = '22007';
            END IF;
            v_date_start := p_date_start;
            v_date_end   := p_date_end;
            v_by_month   := (p_date_end - p_date_start) > 60;
        ELSE
            v_date_start := v_today;
            v_date_end   := v_today;
    END CASE;

    SELECT jsonb_build_object(
        'pct_siswa',
            (SELECT CASE WHEN COUNT(DISTINCT s.student_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END) /
                    COUNT(DISTINCT s.student_id), 1)
                ELSE NULL END
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.student_id
             LEFT JOIN teaching_schedules ts2
               ON ts2.schedule_id = a.schedule_id
              AND ts2.meeting_status = 'NORMAL'
              AND ts2.school_id = v_school_id
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'pct_guru',
            (SELECT CASE WHEN COUNT(DISTINCT ts3.scheduled_teacher_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END) /
                    COUNT(DISTINCT ts3.scheduled_teacher_id), 1)
                ELSE NULL END
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'siswa_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END)
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.student_id
             LEFT JOIN teaching_schedules ts2
               ON ts2.schedule_id = a.schedule_id
              AND ts2.meeting_status = 'NORMAL'
              AND ts2.school_id = v_school_id
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'siswa_total',
            (SELECT COUNT(DISTINCT s.student_id)
             FROM students s
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'guru_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END)
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'guru_total',
            (SELECT COUNT(DISTINCT ts3.scheduled_teacher_id)
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'count_late',
            (SELECT COUNT(*) FROM late_arrivals la
             WHERE la.school_id = v_school_id
               AND la.late_date BETWEEN v_date_start AND v_date_end),
        'count_exits',
            (SELECT COUNT(*) FROM student_exits se
             WHERE se.school_id = v_school_id
               AND se.exit_date BETWEEN v_date_start AND v_date_end),
        'rincian_absensi',
            (SELECT jsonb_build_object(
                'baris', COUNT(*),
                'hadir', COUNT(*) FILTER (WHERE a.status = 'HADIR'),
                'sakit', COUNT(*) FILTER (WHERE a.status = 'SAKIT'),
                'izin',  COUNT(*) FILTER (WHERE a.status = 'IZIN'),
                'alpa',  COUNT(*) FILTER (WHERE a.status = 'ALPA')
             )
             FROM attendance a
             JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
             WHERE a.school_id = v_school_id
               AND ts.school_id = v_school_id
               AND NOT a.is_void
               AND ts.meeting_status = 'NORMAL'
               AND ts.session_date BETWEEN v_date_start AND v_date_end)
    ) INTO v_summary;

    IF v_by_month THEN
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', to_char(b.bulan, 'YYYY-MM-01'),
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                          ON ts_inner.schedule_id = a2.schedule_id
                         AND ts_inner.meeting_status = 'NORMAL'
                         AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date BETWEEN v_date_start AND v_date_end
                          AND date_trunc('month', ts_inner.session_date) = b.bulan
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', ts2.session_date) = b.bulan
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
                'count_late', (
                    SELECT COUNT(*) FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', la.late_date) = b.bulan
                ),
                'count_exits', (
                    SELECT COUNT(*) FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', se.exit_date) = b.bulan
                )
            ) AS pt
            FROM (
                SELECT date_trunc('month', ts.session_date)::date AS bulan
                FROM teaching_schedules ts
                WHERE ts.session_date BETWEEN v_date_start AND v_date_end
                  AND ts.school_id = v_school_id
                  AND ts.meeting_status = 'NORMAL'
                GROUP BY 1
            ) b
        ) sub;
    ELSE
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', ts.session_date::text,
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                          ON ts_inner.schedule_id = a2.schedule_id
                         AND ts_inner.meeting_status = 'NORMAL'
                         AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date = ts.session_date
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date = ts.session_date
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
                'count_late', (
                    SELECT COUNT(*) FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date = ts.session_date
                ),
                'count_exits', (
                    SELECT COUNT(*) FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date = ts.session_date
                )
            ) AS pt
            FROM teaching_schedules ts
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY ts.session_date
        ) sub;
    END IF;

    RETURN jsonb_build_object(
        'period', p_period,
        'date_start', v_date_start,
        'date_end', v_date_end,
        'by_month', v_by_month,
        'summary', v_summary,
        'chart', v_chart,
        'data_earliest', (
            SELECT MIN(ts.session_date)
            FROM teaching_schedules ts
            WHERE ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
        )
    );
END;
$function$;

