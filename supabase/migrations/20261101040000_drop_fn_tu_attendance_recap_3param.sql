-- Hapus overload lama fn_tu_attendance_recap (3 parameter).
-- Migration sebelumnya (20261101030000) salah target DROP(date,date) yang tidak ada.
-- Overload yang ada: (date,date,text[]) dari 20261027 dan (date,date,text[],uuid,uuid) dari 20261028.
-- Pertahankan yang 5 parameter (lebih lengkap), hapus yang 3 parameter.

DROP FUNCTION IF EXISTS public.fn_tu_attendance_recap(date, date, text[]);
