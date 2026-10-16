// CHECK 21 — Fungsi hapus-data wizard: penjaga terhadap pemanggil NULL (migrasi 20261016050000 dan 20261016060000).
//
// Dipakai oleh tests/tenant-isolation.mjs (basis data LIVE, lewat Management API) dan oleh
// tests/wizard-guard-check-pglite.mjs (PGlite lokal, untuk memastikan uji ini sendiri benar sebelum dijalankan live).
//
// MANDIRI: data sintetis dalam satu transaksi BEGIN...ROLLBACK; tidak ada data nyata yang disentuh.
// Temuan audit jalur API 16 Okt 2026: penjaga lama "fn_current_school_id() <> p_school_id" bernilai NULL untuk pemanggil
// tanpa sekolah/peran (mis. pegawai wilayah) sehingga LOLOS, dan fn_wizard_reset_students(p_school_id, NULL) menghapus semua
// siswa sekolah mana pun. Invarian yang ditegakkan:
//   W1 : pegawai wilayah ditolak fn_wizard_reset_students; siswa utuh
//   W2 : akun login tanpa baris users ditolak; siswa utuh
//   W3 : admin sekolah LAIN ditolak; siswa utuh
//   W4 : guru sekolah sendiri (bukan ADMINISTRATIVE) ditolak; siswa utuh
//   W5 : pegawai wilayah ditolak fn_wizard_reset_schedules oleh PENJAGA (bukan galat kolom); jadwal utuh
//   W6 : KONTROL POSITIF: admin sekolah sendiri berhasil mereset jadwal (tanpa galat 42703) dan jadwal sintetis terhapus
//   W7 : hak EXECUTE fn_reapply_schedule_templates dicabut dari authenticated
//   W8 : KONTROL POSITIF: admin sekolah sendiri tetap dapat mereset siswa sekolahnya
export async function checkWizardGuard({ mgmtQuery, log }) {
    log.head('CHECK 21 — Fungsi hapus-data wizard: penjaga pemanggil NULL (BEGIN...ROLLBACK)');
    const U = (n) => `00000000-0000-0000-0000-0000000f21${String(n).padStart(2, '0')}`;
    const R1 = U(1);
    const SA = U(11), SB = U(12);
    const PA = U(21), PB = U(22), CA = U(23), SUBJ = U(24), SCH = U(25);
    const STAFF = U(31), ORPHAN = U(32);
    const UA_ADM = U(41), UA_GURU = U(42), UB_ADM = U(43);
    const AA_ADM = U(51), AA_GURU = U(52), AB_ADM = U(53);
    const claims = (sub) => `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
    // Satu panggilan yang mencatat hasil: 'BREACH' bila TIDAK ditolak, atau 'sqlstate|awal pesan' bila ditolak/galat.
    const tolak = (k, fn, args) =>
        ` do $b$ begin perform public.${fn}(${args}); insert into _f21 values ('${k}', 'BREACH');` +
        ` exception when others then insert into _f21 values ('${k}', sqlstate || '|' || left(sqlerrm, 13)); end $b$;`;
    const hitung = (k, tabel, sid) =>
        ` insert into _f21 values ('${k}', (select count(*)::text from ${tabel} where school_id = '${sid}'));`;

    let rows = null;
    try {
        rows = await mgmtQuery(
            `begin;` +
            ` create temp table _f21 (k text primary key, v text) on commit drop;` +
            ` insert into regions (region_id, name) values ('${R1}', 'CHECK21-A');` +
            [[SA, 'c21-a', 'C21 A', PA], [SB, 'c21-b', 'C21 B', PB]].map(([sid, slug, nama, pid]) =>
                ` insert into schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)` +
                ` values ('${sid}', '${nama}', '${slug}', '${R1}', 'SMA', false, true);` +
                ` insert into programs (program_id, code, name, school_id) values ('${pid}', 'UMUM', 'Umum', '${sid}');`).join('') +
            [1, 2, 3].map((i) =>
                ` insert into students (student_id, nis, full_name, program_id, school_id)` +
                ` values (gen_random_uuid(), 'C21-A-${i}', 'Siswa C21', '${PA}', '${SA}');`).join('') +
            [1, 2].map((i) =>
                ` insert into students (student_id, nis, full_name, program_id, school_id)` +
                ` values (gen_random_uuid(), 'C21-B-${i}', 'Siswa C21 B', '${PB}', '${SB}');`).join('') +
            ` insert into classes (class_id, name, program_id, academic_year, grade_level, school_id)` +
            ` values ('${CA}', 'X', '${PA}', '2026/2027', 10, '${SA}');` +
            ` insert into subjects (subject_id, code, name, school_id) values ('${SUBJ}', 'MTK', 'Matematika', '${SA}');` +
            ` insert into region_staff (auth_user_id, region_id, full_name) values ('${STAFF}', '${R1}', 'Staf C21');` +
            ` insert into users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id, is_kepsek) values` +
            `  ('${UA_ADM}', '${AA_ADM}', 'Admin A C21', 'adm-a-c21@staff.internal', 'C21-ADM-A', 'NIP', 'ADMINISTRATIVE', '${SA}', false),` +
            `  ('${UA_GURU}', '${AA_GURU}', 'Guru A C21', 'guru-a-c21@staff.internal', 'C21-GURU-A', 'NIP', 'GURU', '${SA}', false),` +
            `  ('${UB_ADM}', '${AB_ADM}', 'Admin B C21', 'adm-b-c21@staff.internal', 'C21-ADM-B', 'NIP', 'ADMINISTRATIVE', '${SB}', false);` +
            ` insert into teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,` +
            `   academic_year, semester, school_id, block_group_id)` +
            ` values ('${SCH}', '${CA}', '${SUBJ}', '${UA_GURU}', current_date - 1, '07:00', '08:00', '2026/2027', '1', '${SA}', '${SCH}');` +

            // ── W1..W4: penolakan pada fn_wizard_reset_students (siswa harus utuh setelahnya) ──
            ` ${claims(STAFF)}` + tolak('W1', 'fn_wizard_reset_students', `'${SA}'::uuid, null::uuid[]`) + hitung('W1n', 'students', SA) +
            ` ${claims(ORPHAN)}` + tolak('W2', 'fn_wizard_reset_students', `'${SA}'::uuid, null::uuid[]`) + hitung('W2n', 'students', SA) +
            ` ${claims(AB_ADM)}` + tolak('W3', 'fn_wizard_reset_students', `'${SA}'::uuid, null::uuid[]`) + hitung('W3n', 'students', SA) +
            ` ${claims(AA_GURU)}` + tolak('W4', 'fn_wizard_reset_students', `'${SA}'::uuid, null::uuid[]`) + hitung('W4n', 'students', SA) +

            // ── W5: pegawai wilayah vs fn_wizard_reset_schedules (jadwal harus utuh) ──
            ` ${claims(STAFF)}` + tolak('W5', 'fn_wizard_reset_schedules', `'${SA}'::uuid`) + hitung('W5n', 'teaching_schedules', SA) +

            // ── W6: kontrol positif reset jadwal oleh admin sekolah sendiri ──
            ` ${claims(AA_ADM)}` +
            ` do $b$ declare r jsonb; begin r := public.fn_wizard_reset_schedules('${SA}'::uuid);` +
            `   insert into _f21 values ('W6', r->>'deleted_schedules');` +
            ` exception when others then insert into _f21 values ('W6', 'ERR ' || sqlstate || '|' || left(sqlerrm, 60)); end $b$;` +
            hitung('W6n', 'teaching_schedules', SA) +

            // ── W7: hak EXECUTE jalur legacy dicabut ──
            ` insert into _f21 values ('W7', has_function_privilege('authenticated',` +
            `   to_regprocedure('public.fn_reapply_schedule_templates(text,public.semester,uuid)'), 'EXECUTE')::text);` +

            // ── W8: kontrol positif reset siswa oleh admin sekolah sendiri ──
            ` ${claims(AA_ADM)}` +
            ` do $b$ declare r jsonb; begin r := public.fn_wizard_reset_students('${SA}'::uuid, null::uuid[]);` +
            `   insert into _f21 values ('W8', r->>'deleted_students');` +
            ` exception when others then insert into _f21 values ('W8', 'ERR ' || sqlstate || '|' || left(sqlerrm, 60)); end $b$;` +
            hitung('W8n', 'students', SA) +
            ` insert into _f21 values ('W8b', (select count(*)::text from students where school_id = '${SB}'));` +

            ` select k, v from _f21 order by k;` +
            ` rollback;`
        );
    } catch (e) {
        log.fail(`CHECK 21 — Transaksi sintetis gagal: ${String(e.message).slice(0, 240)}`);
        return;
    }

    const R = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    const eq = (k, want, okMsg, failMsg) => {
        if (R[k] === undefined) log.fail(`${k}: tidak ada hasil terukur`);
        else if (R[k] === want) log.pass(okMsg);
        else log.fail(`${failMsg} (terukur=${String(R[k]).slice(0, 160)})`);
    };
    const DITOLAK = 'P0001|Akses ditolak';
    eq('W1', DITOLAK, 'W1: pegawai wilayah ditolak mereset siswa sekolah lain (Akses ditolak)', 'W1: pegawai wilayah TIDAK ditolak — celah penjaga NULL terbuka');
    eq('W1n', '3', 'W1: siswa sekolah A utuh setelah percobaan pegawai wilayah', 'W1: siswa sekolah A BERKURANG');
    eq('W2', DITOLAK, 'W2: akun login tanpa baris users ditolak mereset siswa', 'W2: akun tanpa profil TIDAK ditolak');
    eq('W2n', '3', 'W2: siswa sekolah A utuh', 'W2: siswa sekolah A BERKURANG');
    eq('W3', DITOLAK, 'W3: admin sekolah LAIN ditolak mereset siswa sekolah A', 'W3: admin sekolah lain TIDAK ditolak');
    eq('W3n', '3', 'W3: siswa sekolah A utuh', 'W3: siswa sekolah A BERKURANG');
    eq('W4', DITOLAK, 'W4: guru sekolah sendiri (bukan ADMINISTRATIVE) ditolak mereset siswa', 'W4: guru TIDAK ditolak');
    eq('W4n', '3', 'W4: siswa sekolah A utuh', 'W4: siswa sekolah A BERKURANG');
    eq('W5', DITOLAK, 'W5: pegawai wilayah ditolak fn_wizard_reset_schedules oleh penjaga (bukan galat lain)', 'W5: pegawai wilayah TIDAK ditolak oleh penjaga');
    eq('W5n', '1', 'W5: jadwal sekolah A utuh', 'W5: jadwal sekolah A BERKURANG');
    eq('W6', '1', 'W6: admin sekolah sendiri berhasil mereset jadwal (kontrol positif; tanpa galat schedule_id)', 'W6: reset jadwal oleh admin sekolah sendiri GAGAL');
    eq('W6n', '0', 'W6: jadwal sintetis terhapus (uji tidak vacuous)', 'W6: jadwal tidak terhapus');
    eq('W7', 'false', 'W7: fn_reapply_schedule_templates tanpa EXECUTE untuk authenticated', 'W7: fn_reapply_schedule_templates masih dapat dipanggil authenticated');
    eq('W8', '3', 'W8: admin sekolah sendiri tetap dapat mereset 3 siswa (kontrol positif)', 'W8: reset siswa oleh admin sekolah sendiri GAGAL');
    eq('W8n', '0', 'W8: siswa sekolah A terhapus oleh admin sekolah A', 'W8: siswa tidak terhapus');
    eq('W8b', '2', 'W8: 2 siswa sekolah B tidak tersentuh oleh reset sekolah A (tidak ada sentuhan lintas sekolah)', 'W8: siswa sekolah B BERKURANG oleh reset sekolah A');
}
