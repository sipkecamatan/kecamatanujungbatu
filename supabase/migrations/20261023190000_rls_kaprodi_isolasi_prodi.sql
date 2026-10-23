-- KP-01: RLS pkl_placements — WITH CHECK terlalu longgar untuk KAPRODI.
-- Semula hanya cek school_id; kaprodi bisa INSERT/UPDATE placement siswa prodi lain via API langsung.
-- Perbaikan: untuk KAPRODI, WITH CHECK memastikan siswa milik programnya lewat fn_kaprodi_of_student.
-- KEPSEK tetap boleh kelola semua placement di sekolah.
DROP POLICY IF EXISTS "rls_pkl_write_admin" ON public.pkl_placements;
CREATE POLICY "rls_pkl_write_admin" ON public.pkl_placements AS PERMISSIVE FOR ALL TO PUBLIC
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type])
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND (
            fn_current_user_role() = 'KEPSEK'::role_type
            OR (
                fn_current_user_role() = 'KAPRODI'::role_type
                AND fn_kaprodi_of_student(student_id)
            )
        )
    );

-- KP-02: RLS observasi PKL — kaprodi membaca semua observasi RESTRICTED sekolah, bukan hanya prodinya.
-- Perbaikan: tambah fn_kaprodi_of_student(student_id) agar hanya observasi siswa prodi sendiri.
DROP POLICY IF EXISTS "rls_observations_read_pkl_supervisor" ON public.observations;
CREATE POLICY "rls_observations_read_pkl_supervisor" ON public.observations AS PERMISSIVE FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND visibility = 'RESTRICTED'::visibility_level
        AND is_void = false
        AND (
            fn_is_waka_humas()
            OR (
                fn_current_user_role() = 'KAPRODI'::role_type
                AND fn_kaprodi_of_student(student_id)
            )
        )
    );

-- KP-07: RLS programs — KAPRODI dapat mengubah metadata program lain.
-- Perbaikan: KAPRODI hanya boleh ubah programnya sendiri (fn_kaprodi_program_id() = program_id).
-- KEPSEK dan ADMINISTRATIVE tetap boleh kelola semua program.
DROP POLICY IF EXISTS "rls_programs_write_admin" ON public.programs;
CREATE POLICY "rls_programs_write_admin" ON public.programs AS PERMISSIVE FOR ALL TO PUBLIC
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type])
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND (
            fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'ADMINISTRATIVE'::role_type])
            OR (
                fn_current_user_role() = 'KAPRODI'::role_type
                AND fn_kaprodi_program_id() = program_id
            )
        )
    );