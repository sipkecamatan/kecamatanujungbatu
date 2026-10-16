// CHECK 22 — Kebijakan RLS teacher_piket_assignments: admin sekolah LAIN tidak boleh membaca/mengubah/menghapus/menambah
// (migrasi 20261016065000). Dipakai oleh tests/tenant-isolation.mjs (LIVE) dan tests/piket-check-pglite.mjs (PGlite).
//
// MANDIRI: data sintetis dalam satu transaksi BEGIN...ROLLBACK. Peran dibatasi dengan SET LOCAL ROLE authenticated agar RLS
// benar-benar berlaku (sesi Management API/CLI berjalan sebagai superuser yang menembus RLS).
// Temuan audit jalur API 16 Okt 2026: rls_piket_admin_write memeriksa pemanggil, bukan baris, sehingga admin sekolah B dapat
// membaca, mengubah, menghapus, dan menambah piket sekolah A.
//   X1..X4 : admin sekolah B: baca, ubah, hapus piket sekolah A = 0 baris; menambah untuk sekolah A ditolak (42501)
//   X5     : pegawai wilayah dan akun tanpa profil: baca piket sekolah A = 0; menambah ditolak
//   X6     : piket sekolah A (2) dan B (1) utuh setelah semua percobaan itu
//   K1..K3 : KONTROL POSITIF: admin sekolah A membaca 2, mengubah 2, menambah, dan tidak melihat piket B
export async function checkPiketPolicy({ mgmtQuery, log }) {
    log.head('CHECK 22 — RLS teacher_piket_assignments: batas baris lintas sekolah (BEGIN...ROLLBACK)');
    const U = (n) => `00000000-0000-0000-0000-0000000f22${String(n).padStart(2, '0')}`;
    const R1 = U(1), SA = U(11), SB = U(12), PA = U(21), PB = U(22);
    const STAFF = U(31), ORPHAN = U(32);
    const UA_ADM = U(41), UA_GURU = U(42), UB_ADM = U(43), UB_GURU = U(44);
    const AA_ADM = U(51), AA_GURU = U(52), AB_ADM = U(53), AB_GURU = U(54);
    const sebagai = (sub) =>
        ` reset role; select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); set local role authenticated;`;
    const hitung = (k, sid) =>
        ` do $b$ declare n int; begin select count(*) into n from teacher_piket_assignments where school_id = '${sid}';` +
        ` insert into _f22 values ('${k}', n::text); end $b$;`;
    const ubah = (k, sid) =>
        ` do $b$ declare n int; begin with u as (update teacher_piket_assignments set is_active = false where school_id = '${sid}' returning 1)` +
        ` select count(*) into n from u; insert into _f22 values ('${k}', n::text); end $b$;`;
    const hapus = (k, sid) =>
        ` do $b$ declare n int; begin with d as (delete from teacher_piket_assignments where school_id = '${sid}' returning 1)` +
        ` select count(*) into n from d; insert into _f22 values ('${k}', n::text); end $b$;`;
    const tambah = (k, sid, guru) =>
        ` do $b$ begin insert into teacher_piket_assignments (user_id, school_id, day_of_week, academic_year)` +
        ` values ('${guru}', '${sid}', 3, '2026/2027'); insert into _f22 values ('${k}', 'BERHASIL');` +
        ` exception when others then insert into _f22 values ('${k}', sqlstate); end $b$;`;

    let rows = null;
    try {
        rows = await mgmtQuery(
            `begin;` +
            ` create temp table _f22 (k text primary key, v text) on commit drop; grant all on _f22 to authenticated;` +
            ` insert into regions (region_id, name) values ('${R1}', 'CHECK22-A');` +
            [[SA, 'c22-a', 'C22 A', PA], [SB, 'c22-b', 'C22 B', PB]].map(([sid, slug, nama, pid]) =>
                ` insert into schools (school_id, name, slug, region_id, jenjang, share_with_region, is_active)` +
                ` values ('${sid}', '${nama}', '${slug}', '${R1}', 'SMA', false, true);` +
                ` insert into programs (program_id, code, name, school_id) values ('${pid}', 'UMUM', 'Umum', '${sid}');`).join('') +
            ` insert into region_staff (auth_user_id, region_id, full_name) values ('${STAFF}', '${R1}', 'Staf C22');` +
            ` insert into users (user_id, auth_user_id, full_name, email, login_identifier, identifier_type, role_type, school_id, is_kepsek) values` +
            `  ('${UA_ADM}', '${AA_ADM}', 'Admin A C22', 'adm-a-c22@staff.internal', 'C22-ADM-A', 'NIP', 'ADMINISTRATIVE', '${SA}', false),` +
            `  ('${UA_GURU}', '${AA_GURU}', 'Guru A C22', 'guru-a-c22@staff.internal', 'C22-GURU-A', 'NIP', 'GURU', '${SA}', false),` +
            `  ('${UB_ADM}', '${AB_ADM}', 'Admin B C22', 'adm-b-c22@staff.internal', 'C22-ADM-B', 'NIP', 'ADMINISTRATIVE', '${SB}', false),` +
            `  ('${UB_GURU}', '${AB_GURU}', 'Guru B C22', 'guru-b-c22@staff.internal', 'C22-GURU-B', 'NIP', 'GURU', '${SB}', false);` +
            ` insert into teacher_piket_assignments (user_id, school_id, day_of_week, academic_year) values` +
            `  ('${UA_GURU}', '${SA}', 1, '2026/2027'), ('${UA_GURU}', '${SA}', 2, '2026/2027'), ('${UB_GURU}', '${SB}', 1, '2026/2027');` +

            // ── X1..X4: admin sekolah B menyerang piket sekolah A ──
            sebagai(AB_ADM) + hitung('X1', SA) + ubah('X2', SA) + hapus('X3', SA) + tambah('X4', SA, UA_GURU) +
            // ── X5: pegawai wilayah dan akun tanpa profil ──
            sebagai(STAFF) + hitung('X5a', SA) + tambah('X5b', SA, UA_GURU) +
            sebagai(ORPHAN) + hitung('X5c', SA) + tambah('X5d', SA, UA_GURU) +
            // ── X6: keadaan sesudah semua serangan (dibaca sebagai superuser) ──
            ` reset role;` +
            ` insert into _f22 values ('X6a', (select count(*)::text from teacher_piket_assignments where school_id = '${SA}'));` +
            ` insert into _f22 values ('X6b', (select count(*)::text from teacher_piket_assignments where school_id = '${SB}'));` +
            // ── K1..K3: kontrol positif admin sekolah A ──
            sebagai(AA_ADM) + hitung('K1', SA) + hitung('K3', SB) + ubah('K2', SA) + tambah('K4', SA, UA_GURU) +

            ` reset role; select k, v from _f22 order by k;` +
            ` rollback;`
        );
    } catch (e) {
        log.fail(`CHECK 22 — Transaksi sintetis gagal: ${String(e.message).slice(0, 240)}`);
        return;
    }
    const R = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    const eq = (k, want, okMsg, failMsg) => {
        if (R[k] === undefined) log.fail(`${k}: tidak ada hasil terukur`);
        else if (R[k] === want) log.pass(okMsg);
        else log.fail(`${failMsg} (terukur=${String(R[k]).slice(0, 120)})`);
    };
    const RLS = '42501';
    eq('X1', '0', 'X1: admin sekolah LAIN tidak dapat MEMBACA piket sekolah A', 'X1: admin sekolah lain MEMBACA piket sekolah A');
    eq('X2', '0', 'X2: admin sekolah LAIN tidak dapat MENGUBAH piket sekolah A', 'X2: admin sekolah lain MENGUBAH piket sekolah A');
    eq('X3', '0', 'X3: admin sekolah LAIN tidak dapat MENGHAPUS piket sekolah A', 'X3: admin sekolah lain MENGHAPUS piket sekolah A');
    eq('X4', RLS, 'X4: admin sekolah LAIN ditolak MENAMBAH piket untuk sekolah A (42501)', 'X4: admin sekolah lain dapat MENAMBAH piket sekolah A');
    eq('X5a', '0', 'X5: pegawai wilayah tidak melihat piket sekolah A', 'X5: pegawai wilayah membaca piket sekolah A');
    eq('X5b', RLS, 'X5: pegawai wilayah ditolak menambah piket', 'X5: pegawai wilayah dapat menambah piket');
    eq('X5c', '0', 'X5: akun tanpa profil tidak melihat piket sekolah A', 'X5: akun tanpa profil membaca piket sekolah A');
    eq('X5d', RLS, 'X5: akun tanpa profil ditolak menambah piket', 'X5: akun tanpa profil dapat menambah piket');
    eq('X6a', '2', 'X6: piket sekolah A utuh (2 baris) setelah semua serangan', 'X6: piket sekolah A BERUBAH oleh pihak luar');
    eq('X6b', '1', 'X6: piket sekolah B utuh (1 baris)', 'X6: piket sekolah B berubah');
    eq('K1', '2', 'K1: KONTROL POSITIF: admin sekolah A membaca 2 piket sekolahnya', 'K1: admin sekolah A tidak melihat piketnya sendiri');
    eq('K2', '2', 'K2: KONTROL POSITIF: admin sekolah A dapat mengubah piket sekolahnya', 'K2: admin sekolah A tidak dapat mengubah piketnya');
    eq('K3', '0', 'K3: admin sekolah A tidak melihat piket sekolah B', 'K3: admin sekolah A membaca piket sekolah B');
    eq('K4', 'BERHASIL', 'K4: KONTROL POSITIF: admin sekolah A dapat menambah piket sekolahnya', 'K4: admin sekolah A tidak dapat menambah piket');
}
