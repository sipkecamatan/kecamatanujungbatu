-- ============================================================================
-- fn_region_monitoring: tren harian/bulanan agregat lintas sekolah di wilayah.
-- Identik dengan fn_kepsek_monitoring tetapi untuk pegawai wilayah
-- (kecamatan/kabupaten/provinsi). Tidak ada pct_guru karena kehadiran
-- guru tidak diagregasi di level wilayah.
--
-- Keluaran:
--   { period, date_start, date_end, by_month,
--     summary: { rincian_absensi, count_late, count_exits, siswa_total },
--     chart: [{ date, pct_hadir, pct_sakit, pct_izin, pct_alpa,
--               count_late, count_exits }],
--     data_earliest }
-- ============================================================================

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.fn_region_monitoring(
    p_period        text  DEFAULT '7_hari',
    p_academic_year text  DEFAULT NULL,
    p_date_start    date  DEFAULT NULL,
    p_date_end      date  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_today      date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
    v_region     uuid := public.fn_region_staff_region();
    v_date_start date;
    v_date_end   date;
    v_by_month   boolean := FALSE;
    v_ay_year    int;
    v_summary    jsonb;
    v_chart      jsonb;
BEGIN
    IF v_region IS NULL THEN
        RAISE EXCEPTION 'akses ditolak' USING ERRCODE = '42501';
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
            v_date_end   := LEAST(p_date_end, v_today);
            v_by_month   := (v_date_end - v_date_start) > 60;
        ELSE
            v_date_start := v_today - 6;
            v_date_end   := v_today;
    END CASE;

    -- Sekolah yang terlihat oleh wilayah ini
    -- (region_id=kecamatan, kabupaten_id=kabupaten, provinsi_id=provinsi)
    -- dipakai berulang via CTE — didefinisikan di masing-masing query karena
    -- STABLE function tidak bisa menyimpan tabel sementara.

    -- ── Summary agregat ───────────────────────────────────────────────────────
    SELECT jsonb_build_object(
        'siswa_total',
            (SELECT COUNT(*)
             FROM students st
             JOIN schools s ON s.school_id = st.school_id
             WHERE st.student_status IN ('AKTIF','PKL')
               AND s.is_active
               AND ((s.region_id    = v_region AND s.share_with_region)
                 OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                 OR (s.provinsi_id  = v_region AND s.share_provinsi))),
        'count_late',
            (SELECT COUNT(*)
             FROM late_arrivals la
             JOIN schools s ON s.school_id = la.school_id
             WHERE la.late_date BETWEEN v_date_start AND v_date_end
               AND s.is_active
               AND ((s.region_id    = v_region AND s.share_with_region)
                 OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                 OR (s.provinsi_id  = v_region AND s.share_provinsi))),
        'count_exits',
            (SELECT COUNT(*)
             FROM student_exits se
             JOIN schools s ON s.school_id = se.school_id
             WHERE se.exit_date BETWEEN v_date_start AND v_date_end
               AND s.is_active
               AND ((s.region_id    = v_region AND s.share_with_region)
                 OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                 OR (s.provinsi_id  = v_region AND s.share_provinsi))),
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
             JOIN schools s ON s.school_id = a.school_id
             WHERE NOT a.is_void
               AND ts.meeting_status = 'NORMAL'
               AND ts.session_date BETWEEN v_date_start AND v_date_end
               AND s.is_active
               AND ((s.region_id    = v_region AND s.share_with_region)
                 OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                 OR (s.provinsi_id  = v_region AND s.share_provinsi)))
    ) INTO v_summary;

    -- ── Chart per bulan (periode panjang) ─────────────────────────────────────
    IF v_by_month THEN
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date',        to_char(b.bulan, 'YYYY-MM-01'),
                'pct_hadir',   CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_hadir / rin.baris, 1) ELSE NULL END,
                'pct_sakit',   CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_sakit / rin.baris, 1) ELSE NULL END,
                'pct_izin',    CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_izin  / rin.baris, 1) ELSE NULL END,
                'pct_alpa',    CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_alpa  / rin.baris, 1) ELSE NULL END,
                'count_late',  late.cnt,
                'count_exits', exits.cnt
            ) AS pt
            FROM (
                SELECT DISTINCT date_trunc('month', ts.session_date)::date AS bulan
                FROM teaching_schedules ts
                JOIN schools s ON s.school_id = ts.school_id
                WHERE ts.session_date BETWEEN v_date_start AND v_date_end
                  AND ts.meeting_status = 'NORMAL'
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) b
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*)                                     AS baris,
                    COUNT(*) FILTER (WHERE a.status = 'HADIR')  AS n_hadir,
                    COUNT(*) FILTER (WHERE a.status = 'SAKIT')  AS n_sakit,
                    COUNT(*) FILTER (WHERE a.status = 'IZIN')   AS n_izin,
                    COUNT(*) FILTER (WHERE a.status = 'ALPA')   AS n_alpa
                FROM attendance a
                JOIN teaching_schedules ts_r ON ts_r.schedule_id = a.schedule_id
                JOIN schools s ON s.school_id = a.school_id
                WHERE NOT a.is_void
                  AND ts_r.meeting_status = 'NORMAL'
                  AND ts_r.session_date BETWEEN v_date_start AND v_date_end
                  AND date_trunc('month', ts_r.session_date) = b.bulan
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) rin ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                FROM late_arrivals la
                JOIN schools s ON s.school_id = la.school_id
                WHERE la.late_date BETWEEN v_date_start AND v_date_end
                  AND date_trunc('month', la.late_date) = b.bulan
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) late ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                FROM student_exits se
                JOIN schools s ON s.school_id = se.school_id
                WHERE se.exit_date BETWEEN v_date_start AND v_date_end
                  AND date_trunc('month', se.exit_date) = b.bulan
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) exits ON true
        ) sub;

    -- ── Chart per hari (periode pendek) ───────────────────────────────────────
    ELSE
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date',        gs.tgl::text,
                'pct_hadir',   CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_hadir / rin.baris, 1) ELSE NULL END,
                'pct_sakit',   CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_sakit / rin.baris, 1) ELSE NULL END,
                'pct_izin',    CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_izin  / rin.baris, 1) ELSE NULL END,
                'pct_alpa',    CASE WHEN rin.baris > 0 THEN ROUND(100.0 * rin.n_alpa  / rin.baris, 1) ELSE NULL END,
                'count_late',  late.cnt,
                'count_exits', exits.cnt
            ) AS pt
            FROM (
                SELECT DISTINCT ts.session_date AS tgl
                FROM teaching_schedules ts
                JOIN schools s ON s.school_id = ts.school_id
                WHERE ts.session_date BETWEEN v_date_start AND v_date_end
                  AND ts.meeting_status = 'NORMAL'
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) gs
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*)                                     AS baris,
                    COUNT(*) FILTER (WHERE a.status = 'HADIR')  AS n_hadir,
                    COUNT(*) FILTER (WHERE a.status = 'SAKIT')  AS n_sakit,
                    COUNT(*) FILTER (WHERE a.status = 'IZIN')   AS n_izin,
                    COUNT(*) FILTER (WHERE a.status = 'ALPA')   AS n_alpa
                FROM attendance a
                JOIN teaching_schedules ts_r ON ts_r.schedule_id = a.schedule_id
                JOIN schools s ON s.school_id = a.school_id
                WHERE NOT a.is_void
                  AND ts_r.meeting_status = 'NORMAL'
                  AND ts_r.session_date = gs.tgl
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) rin ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                FROM late_arrivals la
                JOIN schools s ON s.school_id = la.school_id
                WHERE la.late_date = gs.tgl
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) late ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                FROM student_exits se
                JOIN schools s ON s.school_id = se.school_id
                WHERE se.exit_date = gs.tgl
                  AND s.is_active
                  AND ((s.region_id    = v_region AND s.share_with_region)
                    OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                    OR (s.provinsi_id  = v_region AND s.share_provinsi))
            ) exits ON true
        ) sub;
    END IF;

    RETURN jsonb_build_object(
        'period',        p_period,
        'date_start',    v_date_start,
        'date_end',      v_date_end,
        'by_month',      v_by_month,
        'summary',       v_summary,
        'chart',         v_chart,
        'data_earliest', (
            SELECT MIN(ts.session_date)
            FROM teaching_schedules ts
            JOIN schools s ON s.school_id = ts.school_id
            WHERE ts.meeting_status = 'NORMAL'
              AND s.is_active
              AND ((s.region_id    = v_region AND s.share_with_region)
                OR (s.kabupaten_id = v_region AND s.share_kabupaten)
                OR (s.provinsi_id  = v_region AND s.share_provinsi))
        )
    );
END;
$function$;

GRANT  EXECUTE ON FUNCTION public.fn_region_monitoring(text, text, date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_region_monitoring(text, text, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_region_monitoring(text, text, date, date) FROM PUBLIC;
