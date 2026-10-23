-- KP-06: direktori DUDI terlihat sekolah-wide untuk KAPRODI karena rls_users_read_staff
-- memberi akses ke semua user DUDI di sekolah. Filter program_id di API adalah client-side.
-- Perbaikan: tambah policy khusus yang membatasi KAPRODI hanya membaca DUDI prodi sendiri,
-- dan keluarkan DUDI dari cakupan rls_users_read_staff untuk KAPRODI.

-- Ganti policy read_staff: untuk KAPRODI, keluarkan role_type DUDI dari cakupan.
DROP POLICY IF EXISTS "rls_users_read_staff" ON public.users;
CREATE POLICY "rls_users_read_staff" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (
        school_id = fn_current_school_id()
        AND (
            -- Staff non-KAPRODI: akses ke semua staff + DUDI di sekolah
            (
                fn_current_user_role() = ANY (ARRAY[
                    'GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type,
                    'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type,
                    'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type
                ])
                AND role_type = ANY (ARRAY[
                    'GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type,
                    'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type,
                    'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type,
                    'DUDI'::role_type, 'ADMINISTRATIVE'::role_type
                ])
            )
            -- KAPRODI: akses ke staff (bukan DUDI) di sekolah — DUDI diurus policy terpisah
            OR (
                fn_current_user_role() = 'KAPRODI'::role_type
                AND role_type = ANY (ARRAY[
                    'GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type,
                    'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type,
                    'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type
                ])
            )
            OR auth_user_id = auth.uid()
            OR (
                fn_current_user_role() = ANY (ARRAY[
                    'GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type,
                    'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type,
                    'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type
                ])
                AND role_type = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type])
            )
        )
    );

-- Policy baru: KAPRODI hanya membaca DUDI yang terhubung ke programnya sendiri.
DROP POLICY IF EXISTS "rls_users_read_dudi_kaprodi" ON public.users;
CREATE POLICY "rls_users_read_dudi_kaprodi" ON public.users AS PERMISSIVE FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'KAPRODI'::role_type
        AND role_type = 'DUDI'::role_type
        AND program_id = fn_kaprodi_program_id()
    );