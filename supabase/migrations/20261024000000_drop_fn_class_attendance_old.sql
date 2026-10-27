-- PGRST203: fn_class_attendance_summary punya dua overload setelah migrasi 20261023260000
-- menambah p_semester. Versi lama (tanpa p_semester) harus di-drop agar PostgREST
-- tidak bingung memilih kandidat fungsi.

DROP FUNCTION IF EXISTS public.fn_class_attendance_summary(
    uuid, text, date, date, uuid
);
