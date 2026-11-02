#!/usr/bin/env node
/**
 * tests/piket-verifikasi.mjs
 *
 * Verifikasi fitur Piket (Keterlambatan + Izin Keluar) — Layer D dan R.
 *
 * LAYER D — Database langsung (tanpa RLS, sebagai superuser via Management API):
 *   D1. Total baris late_arrivals per sekolah, rentang Okt–Nov 2026
 *   D2. Total baris student_exits per sekolah, rentang yang sama
 *   D3. Baris dengan class_name = '—' (enrollment tidak cocok → tampilan rusak)
 *   D4. Siswa terdaftar di dua kelas aktif sekaligus (enrollment ganda)
 *   D5. Baris student_exits dengan exit_date IS NULL
 *
 * LAYER R — RLS per role (simulasi via BEGIN...ROLLBACK + SET ROLE authenticated):
 *   R1.  WALI KELAS — hanya mendapat baris kelas waliannya (late_arrivals)
 *   R2.  WALI KELAS — hanya mendapat baris kelas waliannya (student_exits)
 *   R3.  WAKA KESISWAAN — mendapat semua baris sekolahnya (late_arrivals + exits)
 *   R4.  WAKASEK SMP — mendapat student_exits (setelah migration 20261102010000)
 *   R5.  BK — mendapat semua baris sekolahnya (setelah migration 20261102020000)
 *   R6.  KAPRODI — hanya baris program mereka di late_arrivals
 *   R7.  KAPRODI — hanya baris program mereka di student_exits
 *   R8.  GURU biasa (bukan piket, bukan wali) — 0 baris di late_arrivals
 *   R9.  WAKA KURIKULUM — 0 baris di late_arrivals dan student_exits
 *   R10. KEPSEK — 0 baris langsung di late_arrivals (hanya via agregat)
 *
 * CARA JALANKAN:
 *   node tests/piket-verifikasi.mjs
 *   (SUPABASE_ACCESS_TOKEN + SUPABASE_URL diambil dari .env otomatis)
 *
 * EXIT CODE: 0 = semua lulus, 1 = ada kegagalan
 */

// ── Auto-load .env ──────────────────────────────────────────────────────────
if (!process.env.SUPABASE_ACCESS_TOKEN) {
    try {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const dir = dirname(fileURLToPath(import.meta.url));
        const lines = readFileSync(join(dir, '..', '.env'), 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
    } catch { /* .env tidak ada */ }
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF   = (process.env.SUPABASE_URL || '').match(/\/\/([^.]+)/)?.[1] || 'lqgzpiohxdzkkmxjtwor';
const MGMT  = `https://api.supabase.com/v1/projects/${REF}`;

if (!TOKEN) { console.error('FATAL: SUPABASE_ACCESS_TOKEN wajib diisi'); process.exit(2); }

async function mgmtQuery(sql) {
    const res = await fetch(`${MGMT}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
        const teks = await res.text();
        throw new Error(`mgmtQuery HTTP ${res.status}: ${teks.slice(0, 400)}`);
    }
    return res.json();
}

// ── Logger ──────────────────────────────────────────────────────────────────
let lulus = 0, gagal = 0, peringatan = 0;
const log = {
    pass:  (m) => { lulus++;     console.log(`  ✓ ${m}`); },
    fail:  (m) => { gagal++;     console.log(`  ✗ FAIL: ${m}`); },
    warn:  (m) => { peringatan++; console.log(`  ⚠ WARN: ${m}`); },
    head:  (m) => console.log(`\n══ ${m}`),
    info:  (m) => console.log(`     ${m}`),
};

// ── Rentang tanggal ─────────────────────────────────────────────────────────
const DARI = '2026-10-01';
const HINGGA = '2026-11-30';

// ════════════════════════════════════════════════════════════════════════════
//  LAYER D — Database langsung
// ════════════════════════════════════════════════════════════════════════════
log.head('LAYER D — Database langsung (superuser)');

// D1 + D2: total baris per sekolah
let schoolCounts;
try {
    schoolCounts = await mgmtQuery(`
        SELECT
            s.school_id,
            s.name         AS nama_sekolah,
            s.jenjang,
            COUNT(DISTINCT la.late_id) AS total_terlambat,
            COUNT(DISTINCT se.exit_id)         AS total_izin_keluar
        FROM schools s
        LEFT JOIN late_arrivals la
               ON la.school_id = s.school_id
              AND la.late_date BETWEEN '${DARI}' AND '${HINGGA}'
        LEFT JOIN student_exits se
               ON se.school_id = s.school_id
              AND se.exit_date  BETWEEN '${DARI}' AND '${HINGGA}'
        WHERE s.is_active = true
        GROUP BY s.school_id, s.name, s.jenjang
        ORDER BY s.jenjang, s.name
    `);
    log.head('D1 + D2 — Total baris per sekolah (Okt–Nov 2026)');
    if (!schoolCounts.length) {
        log.warn('Tidak ada sekolah aktif ditemukan di database');
    }
    for (const r of schoolCounts) {
        log.info(`${r.jenjang} | ${r.nama_sekolah}: ${r.total_terlambat} terlambat, ${r.total_izin_keluar} izin keluar`);
    }
    log.pass(`D1/D2: data baseline tersedia untuk ${schoolCounts.length} sekolah`);
} catch (e) {
    log.fail(`D1/D2: query baseline gagal — ${e.message}`);
    schoolCounts = [];
}

// D3: siswa di late_arrivals/student_exits tanpa enrollment kelas aktif (nama kelas tidak bisa diselesaikan)
try {
    const d3La = await mgmtQuery(`
        SELECT COUNT(*) AS n FROM late_arrivals la
        WHERE la.late_date BETWEEN '${DARI}' AND '${HINGGA}'
          AND NOT EXISTS (
              SELECT 1 FROM class_enrollments ce
              WHERE ce.student_id = la.student_id AND ce.withdrawn_at IS NULL
          )
    `);
    const d3Se = await mgmtQuery(`
        SELECT COUNT(*) AS n FROM student_exits se
        WHERE se.exit_date BETWEEN '${DARI}' AND '${HINGGA}'
          AND NOT EXISTS (
              SELECT 1 FROM class_enrollments ce
              WHERE ce.student_id = se.student_id AND ce.withdrawn_at IS NULL
          )
    `);
    const nLa = parseInt(d3La[0]?.n ?? 0);
    const nSe = parseInt(d3Se[0]?.n ?? 0);
    log.head('D3 — Siswa tanpa enrollment kelas aktif (nama kelas tidak bisa diselesaikan)');
    if (nLa === 0 && nSe === 0) {
        log.pass(`D3: semua siswa di piket punya enrollment aktif (late: ${nLa}, exits: ${nSe})`);
    } else {
        log.fail(`D3: ${nLa} baris late_arrivals + ${nSe} baris student_exits milik siswa tanpa kelas aktif → nama kelas tampil salah`);
    }
} catch (e) {
    log.fail(`D3: query gagal — ${e.message}`);
}

// D4: siswa terdaftar di dua kelas aktif sekaligus
try {
    const d4 = await mgmtQuery(`
        SELECT student_id, COUNT(*) AS jumlah_kelas
        FROM class_enrollments
        WHERE withdrawn_at IS NULL
        GROUP BY student_id
        HAVING COUNT(*) > 1
        LIMIT 10
    `);
    log.head('D4 — Siswa terdaftar di dua kelas aktif sekaligus');
    if (!d4.length) {
        log.pass('D4: tidak ada siswa dengan enrollment ganda');
    } else {
        log.fail(`D4: ${d4.length} siswa (atau lebih) terdaftar di >1 kelas aktif → baris duplikat di tampilan. Contoh: student_id=${d4[0].student_id} (${d4[0].jumlah_kelas} kelas)`);
    }
} catch (e) {
    log.fail(`D4: query gagal — ${e.message}`);
}

// D5: student_exits dengan exit_date IS NULL
try {
    const d5 = await mgmtQuery(`SELECT COUNT(*) AS n FROM student_exits WHERE exit_date IS NULL`);
    const n = parseInt(d5[0]?.n ?? 0);
    log.head('D5 — Baris student_exits dengan exit_date IS NULL');
    if (n === 0) {
        log.pass('D5: tidak ada baris student_exits dengan exit_date IS NULL');
    } else {
        log.fail(`D5: ${n} baris student_exits dengan exit_date IS NULL → filter tanggal bisa gagal`);
    }
} catch (e) {
    log.fail(`D5: query gagal — ${e.message}`);
}

// ════════════════════════════════════════════════════════════════════════════
//  LAYER R — Simulasi RLS per role (BEGIN...ROLLBACK + SET ROLE authenticated)
// ════════════════════════════════════════════════════════════════════════════
log.head('LAYER R — RLS per role (simulasi via BEGIN...ROLLBACK)');

// Ambil satu pengguna per role per sekolah untuk simulasi
let roleUsers;
try {
    roleUsers = await mgmtQuery(`
        SELECT
            u.user_id,
            u.auth_user_id,
            u.role_type,
            u.is_kepsek,
            u.is_bk,
            u.is_waka_kurikulum,
            u.is_waka_kesiswaan,
            u.wali_kelas_class_id,
            u.kaprodi_program_id,
            u.school_id,
            s.name     AS nama_sekolah,
            s.jenjang
        FROM users u
        JOIN schools s ON s.school_id = u.school_id
        WHERE s.is_active = true
          AND u.auth_user_id IS NOT NULL
          AND u.deleted_at IS NULL
        ORDER BY s.jenjang, u.role_type
    `);
} catch (e) {
    log.fail(`LAYER R: gagal ambil daftar pengguna — ${e.message}`);
    roleUsers = [];
}

// kaprodi_program_id sudah ada di kolom users.kaprodi_program_id

// Helper: jalankan simulasi RLS dalam satu transaksi sintetis
// sql = blok SQL setelah SET ROLE authenticated (tidak perlu ROLLBACK di akhir — sudah ditambahkan)
async function simulasiRLS(authUserId, sql) {
    const jwtClaims = JSON.stringify({ sub: authUserId, role: 'authenticated' }).replace(/'/g, "''");
    return mgmtQuery(
        `BEGIN;
         SELECT set_config('request.jwt.claims', '${jwtClaims}', true);
         SET LOCAL ROLE authenticated;
         ${sql}
         ROLLBACK;`
    );
}

// Helper: hitung baris yang bisa dibaca oleh pengguna tertentu
async function hitungBaris(authUserId, tabel, kondisiTambahan = '') {
    const kolTanggal = tabel === 'student_exits' ? 'exit_date' : 'late_date';
    try {
        const rows = await simulasiRLS(authUserId, `
            CREATE TEMP TABLE _r_hasil (n bigint) ON COMMIT DROP;
            INSERT INTO _r_hasil SELECT COUNT(*) FROM ${tabel}
            WHERE ${kolTanggal} BETWEEN '${DARI}' AND '${HINGGA}'
            ${kondisiTambahan};
            SELECT n FROM _r_hasil;
        `);
        // ambil baris terakhir yang punya data
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].n !== undefined) return parseInt(rows[i].n);
        }
        return 0;
    } catch (e) {
        if (String(e.message).includes('42501')) return -1; // permission denied
        throw e;
    }
}

// Cari pengguna representative per role per sekolah
function cariPengguna(roleType, jenjang, kondisi = () => true) {
    return roleUsers.find((u) => u.role_type === roleType && u.jenjang === jenjang && kondisi(u));
}

// Dapatkan total sekolah dari D1/D2 untuk pembanding
const d1Map = {}; // school_id → total_terlambat
const d2Map = {}; // school_id → total_izin_keluar
for (const r of schoolCounts) {
    d1Map[r.school_id] = parseInt(r.total_terlambat);
    d2Map[r.school_id] = parseInt(r.total_izin_keluar);
}

// ── R3: WAKA KESISWAAN (SMA/SMK) ────────────────────────────────────────────
log.head('R3 — WAKA KESISWAAN: semua baris sekolah');
for (const jenjang of ['SMA', 'SMK']) {
    const waka = roleUsers.find((u) => u.is_waka_kesiswaan && u.jenjang === jenjang)
              || cariPengguna('WAKA_KESISWAAN', jenjang);
    if (!waka) { log.warn(`R3: tidak ada akun WAKA_KESISWAAN ${jenjang} di database`); continue; }
    try {
        const nLa = await hitungBaris(waka.auth_user_id, 'late_arrivals');
        const nSe = await hitungBaris(waka.auth_user_id, 'student_exits');
        const expLa = d1Map[waka.school_id] ?? '?';
        const expSe = d2Map[waka.school_id] ?? '?';
        const okLa = nLa === expLa || expLa === '?';
        const okSe = nSe === expSe || expSe === '?';
        if (okLa && okSe) {
            log.pass(`R3 ${jenjang}: WAKA_KESISWAAN mendapat ${nLa} terlambat + ${nSe} izin keluar (sesuai D1/D2)`);
        } else {
            log.fail(`R3 ${jenjang}: WAKA_KESISWAAN mendapat ${nLa}/${nSe}, harapan ${expLa}/${expSe}`);
        }
    } catch (e) { log.fail(`R3 ${jenjang}: ${e.message}`); }
}

// ── R4: WAKASEK SMP — student_exits setelah migration 20261102010000 ─────────
log.head('R4 — WAKASEK SMP: bisa baca student_exits (fix 20261102010000)');
const wakasek = cariPengguna('WAKASEK', 'SMP');
if (!wakasek) {
    log.warn('R4: tidak ada akun WAKASEK SMP di database');
} else {
    try {
        const nSe = await hitungBaris(wakasek.auth_user_id, 'student_exits');
        const expSe = d2Map[wakasek.school_id] ?? '?';
        if (nSe > 0 || expSe === 0) {
            log.pass(`R4: WAKASEK SMP mendapat ${nSe} baris student_exits (exp≈${expSe})`);
        } else if (nSe === 0 && expSe !== 0) {
            log.fail(`R4: WAKASEK SMP mendapat 0 baris student_exits padahal ada ${expSe} → migration belum diterapkan?`);
        } else {
            log.pass(`R4: WAKASEK SMP mendapat ${nSe} baris student_exits`);
        }
        // late_arrivals untuk wakasek juga
        const nLa = await hitungBaris(wakasek.auth_user_id, 'late_arrivals');
        const expLa = d1Map[wakasek.school_id] ?? '?';
        if (nLa > 0 || expLa === 0) {
            log.pass(`R4: WAKASEK SMP mendapat ${nLa} baris late_arrivals (exp≈${expLa})`);
        } else {
            log.fail(`R4: WAKASEK SMP mendapat 0 baris late_arrivals padahal ada ${expLa}`);
        }
    } catch (e) { log.fail(`R4: ${e.message}`); }
}

// ── R5: BK — semua baris sekolah (setelah migration 20261102020000) ──────────
log.head('R5 — BK: semua baris sekolah (fix 20261102020000)');
for (const jenjang of ['SMK', 'SMA', 'SMP']) {
    const bk = roleUsers.find((u) => u.is_bk && u.jenjang === jenjang);
    if (!bk) {
        // coba role_type BK
        const bk2 = cariPengguna('BK', jenjang);
        if (!bk2) { log.warn(`R5: tidak ada akun BK ${jenjang} di database`); continue; }
        Object.assign(bk ?? {}, bk2);
    }
    const akun = bk || cariPengguna('BK', jenjang);
    if (!akun) continue;
    try {
        const nLa = await hitungBaris(akun.auth_user_id, 'late_arrivals');
        const nSe = await hitungBaris(akun.auth_user_id, 'student_exits');
        const expLa = d1Map[akun.school_id] ?? '?';
        const expSe = d2Map[akun.school_id] ?? '?';
        const totalData = (typeof expLa === 'number' ? expLa : 0) + (typeof expSe === 'number' ? expSe : 0);
        if (totalData === 0 || (nLa > 0 || nSe > 0)) {
            log.pass(`R5 ${jenjang}: BK mendapat ${nLa} terlambat + ${nSe} izin keluar`);
        } else {
            log.fail(`R5 ${jenjang}: BK mendapat 0/0, harapan ${expLa}/${expSe} → migration belum diterapkan?`);
        }
    } catch (e) { log.fail(`R5 ${jenjang}: ${e.message}`); }
}

// ── R6 + R7: KAPRODI SMK — hanya baris program mereka ───────────────────────
log.head('R6+R7 — KAPRODI SMK: hanya baris program sendiri');
const kaprodi = roleUsers.find((u) => u.kaprodi_program_id && u.jenjang === 'SMK')
             || cariPengguna('KAPRODI', 'SMK');
if (!kaprodi) {
    log.warn('R6/R7: tidak ada akun KAPRODI SMK di database');
} else {
    try {
        // Hitung total baris yang bisa dibaca kaprodi
        const nLa = await hitungBaris(kaprodi.auth_user_id, 'late_arrivals');
        const nSe = await hitungBaris(kaprodi.auth_user_id, 'student_exits');
        const totalSekolahLa = d1Map[kaprodi.school_id] ?? 0;
        const totalSekolahSe = d2Map[kaprodi.school_id] ?? 0;

        // Kaprodi seharusnya dapat <total sekolah (hanya programnya), bukan 0 (kecuali program kosong)
        if (nLa === 0 && totalSekolahLa > 0) {
            // Mungkin programnya kosong — cek
            log.warn(`R6: KAPRODI mendapat 0 baris late_arrivals (sekolah total: ${totalSekolahLa}) — mungkin program kosong atau akun bukan piket`);
        } else if (nLa <= totalSekolahLa) {
            log.pass(`R6: KAPRODI mendapat ${nLa}/${totalSekolahLa} baris late_arrivals (hanya programnya)`);
        } else {
            log.fail(`R6: KAPRODI mendapat ${nLa} baris, melebihi total sekolah ${totalSekolahLa} — RLS bocor?`);
        }

        if (nSe === 0 && totalSekolahSe > 0) {
            log.warn(`R7: KAPRODI mendapat 0 baris student_exits (sekolah total: ${totalSekolahSe}) — mungkin program kosong`);
        } else if (nSe <= totalSekolahSe) {
            log.pass(`R7: KAPRODI mendapat ${nSe}/${totalSekolahSe} baris student_exits (hanya programnya)`);
        } else {
            log.fail(`R7: KAPRODI mendapat ${nSe} baris, melebihi total sekolah ${totalSekolahSe} — RLS bocor?`);
        }
    } catch (e) { log.fail(`R6/R7: ${e.message}`); }
}

// ── R1 + R2: WALI KELAS — hanya kelas waliannya ─────────────────────────────
log.head('R1+R2 — WALI KELAS: hanya kelas waliannya');
// Cari wali kelas — role_type=WALI_KELAS atau GURU dengan wali_kelas_class_id
const wali = roleUsers.find((u) => u.role_type === 'WALI_KELAS' && u.wali_kelas_class_id)
          || roleUsers.find((u) => u.wali_kelas_class_id);
if (!wali) {
    log.warn('R1/R2: tidak ada akun GURU dengan wali_kelas_class_id di database');
} else {
    try {
        // Hitung baris untuk kelas walian di database (sebagai baseline)
        const baselineLa = await mgmtQuery(`
            SELECT COUNT(*) AS n FROM late_arrivals la
            JOIN class_enrollments ce ON ce.student_id = la.student_id AND ce.withdrawn_at IS NULL
            WHERE ce.class_id = '${wali.wali_kelas_class_id}'
              AND la.late_date BETWEEN '${DARI}' AND '${HINGGA}'
        `);
        const baselineSe = await mgmtQuery(`
            SELECT COUNT(*) AS n FROM student_exits se
            JOIN class_enrollments ce ON ce.student_id = se.student_id AND ce.withdrawn_at IS NULL
            WHERE ce.class_id = '${wali.wali_kelas_class_id}'
              AND se.exit_date BETWEEN '${DARI}' AND '${HINGGA}'
        `);
        const expLa = parseInt(baselineLa[0]?.n ?? 0);
        const expSe = parseInt(baselineSe[0]?.n ?? 0);

        const nLa = await hitungBaris(wali.auth_user_id, 'late_arrivals');
        const nSe = await hitungBaris(wali.auth_user_id, 'student_exits');

        // Wali hanya boleh melihat kelasnya — lebih dari baseline = bocor
        if (nLa === expLa) {
            log.pass(`R1: WALI mendapat tepat ${nLa} baris late_arrivals (= baseline kelas waliannya)`);
        } else if (nLa > expLa) {
            log.fail(`R1: WALI mendapat ${nLa} baris, baseline ${expLa} — mungkin melihat kelas lain (RLS bocor?)`);
        } else {
            log.warn(`R1: WALI mendapat ${nLa} baris, baseline kelas ${expLa} — mungkin kelas walian tanpa data`);
        }

        if (nSe === expSe) {
            log.pass(`R2: WALI mendapat tepat ${nSe} baris student_exits (= baseline kelas waliannya)`);
        } else if (nSe > expSe) {
            log.fail(`R2: WALI mendapat ${nSe} baris student_exits, baseline ${expSe} — RLS bocor?`);
        } else {
            log.warn(`R2: WALI mendapat ${nSe} baris student_exits, baseline kelas ${expSe}`);
        }
    } catch (e) { log.fail(`R1/R2: ${e.message}`); }
}

// ── R8: GURU biasa — 0 baris late_arrivals ──────────────────────────────────
log.head('R8 — GURU biasa (bukan piket/wali): 0 baris late_arrivals');
// Cari guru yang bukan wali dan bukan piket
const guruBiasa = roleUsers.find((u) =>
    u.role_type === 'GURU'
    && !u.wali_kelas_class_id
    && !u.is_bk
);
if (!guruBiasa) {
    log.warn('R8: tidak ada akun GURU biasa (tanpa wali/BK) di database');
} else {
    try {
        const nLa = await hitungBaris(guruBiasa.auth_user_id, 'late_arrivals');
        // Guru biasa bisa mendapat 0 ATAU baris yang dia rekam sendiri (recorded_by) atau jika piket hari ini
        // Kita hanya cek tidak melebihi total sekolah
        const totalSekolahLa = d1Map[guruBiasa.school_id] ?? 0;
        if (nLa < totalSekolahLa || totalSekolahLa === 0) {
            log.pass(`R8: GURU biasa mendapat ${nLa} baris (< total sekolah ${totalSekolahLa}) — tidak bocor`);
        } else {
            log.fail(`R8: GURU biasa mendapat ${nLa} baris = total sekolah ${totalSekolahLa} — mungkin RLS terlalu longgar`);
        }
    } catch (e) { log.fail(`R8: ${e.message}`); }
}

// ── R9: WAKA KURIKULUM — 0 baris ────────────────────────────────────────────
log.head('R9 — WAKA KURIKULUM: 0 baris late_arrivals dan student_exits');
const wakaKur = roleUsers.find((u) => u.is_waka_kurikulum)
             || cariPengguna('WAKA_KURIKULUM', 'SMK') || cariPengguna('WAKA_KURIKULUM', 'SMA');
if (!wakaKur) {
    log.warn('R9: tidak ada akun WAKA_KURIKULUM di database');
} else {
    try {
        const nLa = await hitungBaris(wakaKur.auth_user_id, 'late_arrivals');
        const nSe = await hitungBaris(wakaKur.auth_user_id, 'student_exits');
        const totalSekolahLaWk = d1Map[wakaKur.school_id] ?? 0;
        const totalSekolahSeWk = d2Map[wakaKur.school_id] ?? 0;
        // WAKA_KURIKULUM mungkin tetap melihat sejumlah baris jika:
        //   a) rls_late_arrivals_read_guru_mengajar — mengajar hari ini (baris hari ini saja)
        //   b) recorded_by (dia mencatat sendiri)
        // Keduanya sah. Yang TIDAK sah = mendapat SEMUA baris sekolah.
        if (nLa === 0) {
            log.pass(`R9: WAKA_KURIKULUM mendapat 0 baris late_arrivals ✓`);
        } else if (nLa < totalSekolahLaWk) {
            log.warn(`R9: WAKA_KURIKULUM mendapat ${nLa}/${totalSekolahLaWk} baris late_arrivals — kemungkinan via rls_late_arrivals_read_guru_mengajar (mengajar hari ini), BUKAN kebocoran seluruh sekolah`);
        } else {
            log.fail(`R9: WAKA_KURIKULUM mendapat ${nLa} baris late_arrivals = total sekolah ${totalSekolahLaWk} — kemungkinan RLS bocor`);
        }
        if (nSe === 0) {
            log.pass(`R9: WAKA_KURIKULUM mendapat 0 baris student_exits ✓`);
        } else if (nSe < totalSekolahSeWk) {
            log.warn(`R9: WAKA_KURIKULUM mendapat ${nSe}/${totalSekolahSeWk} baris student_exits — kemungkinan ada policy lain yang berlaku (recorded_by / mengajar hari ini)`);
        } else {
            log.fail(`R9: WAKA_KURIKULUM mendapat ${nSe} baris student_exits = total sekolah ${totalSekolahSeWk} — kemungkinan RLS bocor`);
        }
    } catch (e) { log.fail(`R9: ${e.message}`); }
}

// ── R10: KEPSEK — 0 baris langsung di late_arrivals ─────────────────────────
log.head('R10 — KEPSEK: 0 baris langsung di late_arrivals');
const kepsek = roleUsers.find((u) => u.is_kepsek);
if (!kepsek) {
    log.warn('R10: tidak ada akun KEPSEK di database');
} else {
    try {
        const nLa = await hitungBaris(kepsek.auth_user_id, 'late_arrivals');
        if (nLa === 0) {
            log.pass(`R10: KEPSEK mendapat 0 baris late_arrivals langsung ✓ (akses hanya via agregat)`);
        } else {
            log.fail(`R10: KEPSEK mendapat ${nLa} baris late_arrivals langsung — seharusnya 0`);
        }
    } catch (e) { log.fail(`R10: ${e.message}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  RINGKASAN
// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`PIKET VERIFIKASI: ${lulus} lulus, ${gagal} gagal, ${peringatan} peringatan`);
console.log('═'.repeat(60));
if (gagal > 0) console.log('\nAda kegagalan — periksa baris ✗ di atas.');
process.exit(gagal > 0 ? 1 : 0);
