-- Hapus overload lama fn_tu_attendance_recap (2 parameter: p_date_start, p_date_end).
-- Migration 20261027000000 membuat fungsi dengan 2 parameter.
-- Migration 20261028010000 CREATE OR REPLACE dengan 5 parameter → membuat OVERLOAD baru
-- (jebakan create_or_replace_overload: signature berbeda = fungsi baru, bukan pengganti).
-- Hasilnya 2 overload → PostgREST error PGRST203 "Could not choose best candidate".
-- Solusi: DROP overload lama, pertahankan yang baru (5 parameter).

DROP FUNCTION IF EXISTS public.fn_tu_attendance_recap(date, date);
