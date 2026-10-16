// CHECK 23 — Reset jadwal wizard pada sekolah BERISI DATA (fn_wizard_reset_schedules, migrasi 20261016060000).
//
// CHECK 21 (W6) hanya menguji jadwal tanpa data turunan. Di sekolah nyata, sesi jadwal sudah dirujuk absensi, log kehadiran
// guru, jadwal guru pengganti dan observasi (semuanya ON DELETE RESTRICT ke teaching_schedules), ditambah template mingguan dan
// penugasan mengajar. Uji ini membuktikan reset benar-benar menghapus seluruh rantai itu tanpa galat 23503, hanya milik sekolah
// yang mereset, dan tidak menyentuh data lain (siswa, kelas, mapel, observasi tanpa sesi, serta seluruh data sekolah B).
//
// Dipakai oleh tests/tenant-isolation.mjs (LIVE) dan tests/wizard-reset-data-check-pglite.mjs (PGlite).
// MANDIRI: data sintetis dalam satu transaksi BEGIN...ROLLBACK; tidak ada data nyata yang disentuh.
//   D1 : reset oleh admin sekolah A berhasil (tanpa galat) dan melaporkan 2 sesi, 1 template, 1 penugasan terhapus
//   D2 : seluruh rantai turunan sekolah A kosong (jadwal, absensi, log guru, pengganti, observasi bersesi, template, penugasan)
//   D3 : data yang BUKAN jadwal tetap utuh di sekolah A (siswa, kelas, mapel, observasi tanpa sesi)
//   D4 : seluruh rantai sekolah B utuh (tidak ada sentuhan lintas sekolah)
//   D5 : reset kedua pada sekolah yang sudah kosong tidak galat (idempoten) dan melaporkan nol
export async function checkWizardResetData({ mgmtQuery, log }) {
    log.head('CHECK 23 — Reset jadwal pada sekolah berisi data (BEGIN...ROLLBACK)');
    const U = (n) => `00000000-0000-0000-0000-0000000f23${String(n).padStart(2, '0')}`;
    const R1 = U(1);
    const S = { A: U(11), B: U(12) };
    const P = { A: U(21), B: U(22) };
    const C = { A: U(23), B: U(24) };
    const SUBJ = { A: U(25), B: U(26) };
    const TCH = { A: U(31), B: U(32) };      // user_id guru
    const ADM = { A: U(33), B: U(34) };      // user_id admin
    const AU = { TCH_A: U(41), ADM_A: U(42), TCH_B: U(43), ADM_B: U(44) };   // auth_user_id
    const SCH = { A1: U(51), A2: U(52), B1: U(53), B2: U(54) };
    const claims = (sub) => `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
    const hitung = (k, tabel, sid, tambahan = '') =>
        ` insert into _f23 values ('${k}', (select count(*)::text from ${tabel} where school_id = '${sid}'${tambahan}));`;
    const rantai = (sufiks, sid) =>
        hitung('jad' + sufiks, 'teaching_schedules', sid) + hitung('abs' + sufiks, 'attendance', sid) +
        hitung('log' + sufiks, 'teacher_attendance_log', sid) + hitung('pen' + sufiks, 'substitute_schedules', sid) +
        hitung('obsj' + sufiks, 'observations', sid, ' and schedule_id is not null') +
        hitung('tpl' + sufiks, 'schedule_templates', sid) + hitung('asg' + sufiks, 'teaching_assignments', sid);
    const sekolah = (k) => {
        const sid = S[k], kelas = C[k], mapel = SUBJ[k], guru = TCH[k], admin = ADM[k], pid = P[k];
        const jadwal = k === 'A' ? [SCH.A1, SCH.A2] : [SCH.B1, SCH.B2];
        const stu = (i) => `${U(60 + (k === 'A' ? 0 : 10) + i)}`;
        return (
            ` insert into schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)` +
            ` values ('${sid}', 'C23 ${k}', 'c23-${k.toLowerCase()}', '${R1}', 'SMA', false, true);` +
            ` insert into programs (program_id, code, name, school_id) values ('${pid}', 'UMUM', 'Umum', '${sid}');` +
            [1, 2, 3].map((i) =>
                ` insert into students (student_id, nis, full_name, program_id, school_id)` +
                ` values ('${stu(i)}', 'C23-${k}-${i}', 'Siswa C23 ${k}${i}', '${pid}', '${sid}');`).join('') +
            ` insert into classes (class_id, name, program_id, academic_year, grade_level, school_id)` +
            ` values ('${kelas}', 'X', '${pid}', '2026/2027', 10, '${sid}');` +
            ` insert into subjects (subject_id, code, name, school_id) values ('${mapel}', 'MTK', 'Matematika', '${sid}');` +
            ` insert into users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id, is_kepsek) values` +
            `  ('${guru}', '${AU['TCH_' + k]}', 'Guru C23 ${k}', 'guru-${k.toLowerCase()}-c23@staff.internal', 'C23-GURU-${k}', 'NIP', 'GURU', '${sid}', false),` +
            `  ('${admin}', '${AU['ADM_' + k]}', 'Admin C23 ${k}', 'adm-${k.toLowerCase()}-c23@staff.internal', 'C23-ADM-${k}', 'NIP', 'ADMINISTRATIVE', '${sid}', false);` +
            jadwal.map((j, i) =>
                ` insert into teaching_schedules (schedule_id, class_id, subject_id, scheduled_teacher_id, session_date, session_start, session_end,` +
                `   academic_year, semester, school_id, block_group_id)` +
                ` values ('${j}', '${kelas}', '${mapel}', '${guru}', current_date - ${i + 1}, '0${7 + i}:00', '0${8 + i}:00', '2026/2027', '1', '${sid}', '${j}');` +
                // absensi: dua siswa per sesi; log guru; observasi yang merujuk sesi
                [1, 2].map((n) =>
                    ` insert into attendance (schedule_id, student_id, status, source, recorded_by_user_id, school_id)` +
                    ` values ('${j}', '${stu(n)}', '${n === 1 ? 'HADIR' : 'SAKIT'}', 'TEACHER_DECLARED', '${guru}', '${sid}');`).join('') +
                ` insert into teacher_attendance_log (schedule_id, user_id, activity_type, school_id)` +
                ` values ('${j}', '${guru}', 'ATTENDANCE_SUBMITTED', '${sid}');` +
                ` insert into observations (student_id, author_user_id, sentiment, dimension, content, visibility, class_id, schedule_id, school_id)` +
                ` values ('${stu(1)}', '${guru}', 'POSITIF', 'AKADEMIK', 'Obs bersesi C23', 'INTERNAL_SCHOOL', '${kelas}', '${j}', '${sid}');`).join('') +
            // jadwal pengganti hanya pada sesi pertama (pengganti = admin; guru terjadwal ditolak pemicu)
            ` insert into substitute_schedules (schedule_id, substitute_user_id, granted_by_user_id, sync_token_expires_at, school_id)` +
            ` values ('${jadwal[0]}', '${admin}', '${admin}', now() + interval '1 day', '${sid}');` +
            // observasi TANPA sesi: bukan milik reset jadwal, harus tetap ada
            ` insert into observations (student_id, author_user_id, sentiment, dimension, content, visibility, class_id, school_id)` +
            ` values ('${stu(2)}', '${guru}', 'NEGATIF', 'PERILAKU', 'Obs tanpa sesi C23', 'INTERNAL_SCHOOL', '${kelas}', '${sid}');` +
            ` insert into schedule_templates (academic_year, semester, day_of_week, start_time, end_time, class_id, teacher_id, subject_id, school_id)` +
            ` values ('2026/2027', '1', 'SENIN', '07:00', '08:00', '${kelas}', '${guru}', '${mapel}', '${sid}');` +
            ` insert into teaching_assignments (user_id, class_id, subject_id, academic_year, semester, school_id)` +
            ` values ('${guru}', '${kelas}', '${mapel}', '2026/2027', '1', '${sid}');`
        );
    };

    let rows = null;
    try {
        rows = await mgmtQuery(
            `begin;` +
            ` create temp table _f23 (k text primary key, v text) on commit drop;` +
            ` insert into regions (region_id, name) values ('${R1}', 'CHECK23');` +
            sekolah('A') + sekolah('B') +
            // keadaan awal (bukti data benar-benar ada, sehingga uji tidak vacuous)
            rantai('0A', S.A) + rantai('0B', S.B) +
            // reset oleh admin sekolah A
            ` ${claims(AU.ADM_A)}` +
            ` do $b$ declare r jsonb; begin r := public.fn_wizard_reset_schedules('${S.A}'::uuid);` +
            `   insert into _f23 values ('D1', (r->>'deleted_schedules') || '/' || (r->>'deleted_templates') || '/' || (r->>'deleted_assignments'));` +
            ` exception when others then insert into _f23 values ('D1', 'ERR ' || sqlstate || '|' || left(sqlerrm, 80)); end $b$;` +
            rantai('1A', S.A) + rantai('1B', S.B) +
            hitung('stuA', 'students', S.A) + hitung('klsA', 'classes', S.A) + hitung('mpA', 'subjects', S.A) +
            hitung('obtA', 'observations', S.A, ' and schedule_id is null') +
            // reset kedua pada sekolah yang sudah kosong
            ` do $b$ declare r jsonb; begin r := public.fn_wizard_reset_schedules('${S.A}'::uuid);` +
            `   insert into _f23 values ('D5', (r->>'deleted_schedules') || '/' || (r->>'deleted_templates') || '/' || (r->>'deleted_assignments'));` +
            ` exception when others then insert into _f23 values ('D5', 'ERR ' || sqlstate || '|' || left(sqlerrm, 80)); end $b$;` +
            ` select k, v from _f23 order by k;` +
            ` rollback;`
        );
    } catch (e) {
        log.fail(`CHECK 23 — Transaksi sintetis gagal: ${String(e.message).slice(0, 300)}`);
        return;
    }

    const R = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    const eq = (k, want, okMsg, failMsg) => {
        if (R[k] === undefined) log.fail(`${k}: tidak ada hasil terukur`);
        else if (R[k] === want) log.pass(okMsg);
        else log.fail(`${failMsg} (terukur=${String(R[k]).slice(0, 160)}, diharapkan=${want})`);
    };
    const bentuk = (s) => ['jad', 'abs', 'log', 'pen', 'obsj', 'tpl', 'asg'].map((p) => R[p + s]).join(',');
    // Keadaan awal tiap sekolah: 2 sesi, 4 absensi, 2 log, 1 pengganti, 2 observasi bersesi, 1 template, 1 penugasan.
    const AWAL = '2,4,2,1,2,1,1';
    const KOSONG = '0,0,0,0,0,0,0';
    if (bentuk('0A') !== AWAL || bentuk('0B') !== AWAL) {
        log.fail(`D0: data sintetis awal tidak sesuai rancangan (A=${bentuk('0A')} B=${bentuk('0B')}, diharapkan ${AWAL}); uji tidak valid`);
        return;
    }
    log.pass(`D0: sekolah A dan B masing-masing berisi rantai lengkap (jadwal,absensi,log,pengganti,obs,template,penugasan = ${AWAL})`);
    eq('D1', '2/1/1', 'D1: admin sekolah A mereset sekolah berisi data tanpa galat (2 sesi, 1 template, 1 penugasan)', 'D1: reset sekolah berisi data GAGAL atau hasil tidak sesuai');
    if (bentuk('1A') === KOSONG) log.pass('D2: seluruh rantai turunan sekolah A kosong setelah reset');
    else log.fail(`D2: rantai sekolah A tidak kosong (jadwal,absensi,log,pengganti,obs,template,penugasan = ${bentuk('1A')})`);
    if (R.stuA === '3' && R.klsA === '1' && R.mpA === '1' && R.obtA === '1')
        log.pass('D3: siswa, kelas, mapel, dan observasi tanpa sesi sekolah A tetap utuh');
    else log.fail(`D3: data non-jadwal sekolah A berubah (siswa=${R.stuA}, kelas=${R.klsA}, mapel=${R.mpA}, obs tanpa sesi=${R.obtA})`);
    if (bentuk('1B') === AWAL) log.pass('D4: seluruh rantai sekolah B utuh (tidak ada sentuhan lintas sekolah)');
    else log.fail(`D4: sekolah B BERUBAH oleh reset sekolah A (${bentuk('1B')}, diharapkan ${AWAL})`);
    eq('D5', '0/0/0', 'D5: reset kedua pada sekolah kosong tidak galat dan melaporkan nol (idempoten)', 'D5: reset kedua galat atau menghapus sesuatu');
}
