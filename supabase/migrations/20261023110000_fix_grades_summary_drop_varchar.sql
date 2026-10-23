-- Fix: hapus versi fn_get_all_grades_summary dengan parameter character varying
-- yang menyebabkan overloading ambigus dengan versi text (20261023100000).
DROP FUNCTION IF EXISTS public.fn_get_all_grades_summary(uuid, character varying, integer);
