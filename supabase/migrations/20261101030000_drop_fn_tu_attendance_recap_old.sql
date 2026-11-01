-- Hapus overload lama fn_tu_attendance_recap (3 parameter: date, date, text[]).
-- Migration 20261027000000 membuat fungsi dengan 3 parameter.
-- Migration 20261028010000 CREATE OR REPLACE dengan 5 parameter → membuat OVERLOAD baru
-- (jebakan create_or_replace_overload: signature berbeda = fungsi baru, bukan pengganti).
-- Hasilnya 2 overload → PostgREST error PGRST203 "Could not choose best candidate".
-- Solusi: DROP overload lama (3 param), pertahankan yang baru (5 param).

DROP FUNCTION IF EXISTS public.fn_tu_attendance_recap(date, date, text[]);
