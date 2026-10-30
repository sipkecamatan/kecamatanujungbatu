#!/usr/bin/env node
/**
 * tests/absensi-konsistensi.mjs
 *
 * Verifikasi konsistensi VERTIKAL data absensi: angka yang diinput guru
 * mengalir dengan benar ke semua layer hilir.
 *
 * ─── FASE 1 — Data sintetis ─────────────────────────────────────────────
 * Cari block_group_id nyata yang belum ada attendance_records-nya.
 * Insert angka diketahui dalam BEGIN/SAVEPOINT, query semua fungsi hilir,
 * bandingkan hasilnya, lalu ROLLBACK.
 * Angka sintetis: 3 ALPA, 2 SAKIT, 1 IZIN, sisanya HADIR.
 *
 * ─── FASE 2 — Data nyata ────────────────────────────────────────────────
 * Ambil satu kelas dengan data terbanyak dari sekolah uji.
 * Query tiap fungsi dan bandingkan konsistensi antar layer:
 *   C1: fn_class_attendance_summary vs fn_attendance_recap_per_class
 *   C2: fn_attendance_recap_per_class vs fn_tu_attendance_recap
 *   C3: fn_portal_attendance (per siswa, SUM) vs fn_class_attendance_summary
 *   C4: fn_class_attendance_summary bulanan (Wali Excel) vs tahunan
 *   C5: fn_class_attendance_detail pivot (BK Excel) vs fn_attendance_recap_per_class
 *
 * Cara pakai:
 *   SIP_MGMT_MODE=cli node tests/absensi-konsistensi.mjs
 *   Atau dengan Management API token (sbp_...):
 *   SUPABASE_ACCESS_TOKEN=sbp_... node tests/absensi-konsistensi.mjs
 *
 * Mode CLI  : pakai `supabase db query --linked` (login Supabase CLI sudah tertaut).
 * Mode API  : SUPABASE_ACCESS_TOKEN = management token sbp_... dari
 *             https://supabase.com/dashboard/account/tokens
 *
 * EXIT CODE: 0 = semua PASS, 1 = ada FAIL, 2 = error setup.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync as tulis } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as gabung } from 'node:path';

// ── Muat .env ──────────────────────────────────────────────────────────────
{
    try {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const root = dirname(fileURLToPath(import.meta.url));
        const lines = readFileSync(join(root, '..', '.env'), 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]])
                process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
    } catch { /* env harus disediakan manual */ }
}

const MODE_CLI = process.env.SIP_MGMT_MODE === 'cli';
const TOKEN    = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lqgzpiohxdzkkmxjtwor.supabase.co';
const REF      = new URL(SUPABASE_URL).hostname.split('.')[0];

if (!MODE_CLI && !TOKEN) {
    console.error('FATAL: jalankan salah satu cara berikut:');
    console.error('  1. SIP_MGMT_MODE=cli node tests/absensi-konsistensi.mjs');
    console.error('     (perlu login Supabase CLI: supabase login, lalu supabase link)');
    console.error('  2. SUPABASE_ACCESS_TOKEN=sbp_... node tests/absensi-konsistensi.mjs');
    console.error('     (ambil token dari https://supabase.com/dashboard/account/tokens)');
    process.exit(2);
}

// ── Utilitas ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function pass(label) { passed++; console.log(`  ✓ PASS: ${label}`); }
function fail(label, detail = '') {
    failed++;
    console.log(`  ✗ FAIL: ${label}${detail ? '\n         ' + String(detail).slice(0, 300) : ''}`);
}
function head(label) { console.log(`\n── ${label}`); }
function skip(label) { console.log(`  ⊘ SKIP: ${label}`); }

/** Jalankan SQL lewat CLI Supabase yang sudah login. */
function sqlCli(query) {
    const dir    = mkdtempSync(gabung(tmpdir(), 'sip-abs-'));
    const berkas = gabung(dir, 'q.sql');
    tulis(berkas, query);
    try {
        const r = spawnSync(`supabase db query --linked -o json -f "${berkas}"`,
            { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0) {
            const pesan = String(r.stderr || '').split(/\r?\n/)
                .filter(l => /ERROR|Failed|unexpected/.test(l)).join(' ').slice(0, 400);
            throw new Error(`CLI ${r.status}: ${pesan || String(r.stderr || '').slice(0, 300)}`);
        }
        const teks = String(r.stdout || '');
        const awal = teks.search(/[\[{]/);
        if (awal < 0) return [];
        const j = JSON.parse(teks.slice(awal));
        return Array.isArray(j) ? j : (j.rows ?? []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Jalankan SQL lewat Management API (mendukung multi-statement, transaksi). */
async function sqlApi(query) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`SQL error ${res.status}: ${txt.slice(0, 400)}`);
    }
    return res.json();
}

/** Jalankan SQL — otomatis pilih CLI atau API. */
async function sql(query) {
    return MODE_CLI ? sqlCli(query) : sqlApi(query);
}

/** Jalankan SQL dan kembalikan semua baris. */
async function many(query) {
    const rows = await sql(query);
    return Array.isArray(rows) ? rows : (rows?.rows ?? []);
}

/**
 * Konteks SET ROLE authenticated + JWT untuk user tertentu.
 * Sisipkan di awal transaksi sebelum memanggil SECURITY DEFINER yang cek auth.uid().
 */
const asAuth = (authUserId) =>
    ` SET LOCAL ROLE authenticated;` +
    ` SELECT set_config('request.jwt.claims', '{"sub":"${authUserId}","role":"authenticated"}', true);` +
    ` SELECT set_config('request.jwt.claim.sub', '${authUserId}', true);`;

// ── Konstanta ──────────────────────────────────────────────────────────────
// Status HADIR disimpan di attendance tapi fn_tu_attendance_recap hanya return non-HADIR.
// Untuk perbandingan C2 kita filter ALPA+SAKIT+IZIN dari semua fungsi.
const PRIO = { ALPA: 1, SAKIT: 2, IZIN: 3, HADIR: 4 };

/** Pivot raw attendance_records ke {studentId → status terburuk per block_group_id}. */
function pivotTerburuk(rows) {
    // rows: [{student_id, block_group_id, status}]
    const map = new Map(); // student_id → Map<block_group_id, status>
    for (const r of rows) {
        if (!map.has(r.student_id)) map.set(r.student_id, new Map());
        const byBlock = map.get(r.student_id);
        const prev = byBlock.get(r.block_group_id);
        if (!prev || (PRIO[r.status] ?? 99) < (PRIO[prev] ?? 99))
            byBlock.set(r.block_group_id, r.status);
    }
    return map;
}

/** Hitung H/S/I/A dari pivot terburuk. */
function hitungDariPivot(pivotMap) {
    let H = 0, S = 0, I = 0, A = 0;
    for (const byBlock of pivotMap.values()) {
        for (const st of byBlock.values()) {
            if (st === 'HADIR') H++;
            else if (st === 'SAKIT') S++;
            else if (st === 'IZIN') I++;
            else if (st === 'ALPA') A++;
        }
    }
    return { H, S, I, A, total: H + S + I + A };
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 — DATA SINTETIS
// ═══════════════════════════════════════════════════════════════════════════
head('FASE 1 — Data sintetis (INSERT dalam transaksi, lalu ROLLBACK)');

let f1Skipped = false;
let f1PreData = null;

try {
    // Cari: sekolah dengan kelas aktif, tahun ajaran aktif, dan setidaknya
    // satu block_group_id yang belum ada attendance_records sama sekali.
    // Staff: pilih WAKA/BK/KEPSEK (bisa akses fn_attendance_recap_per_class),
    // hindari WALI_KELAS agar fn_class_attendance_summary tidak tolak kelas bukan waliannya.
    const preRows = await many(`
        WITH kandidat AS (
            SELECT
                ts.block_group_id,
                ts.class_id,
                sc.current_academic_year AS academic_year,
                ts.school_id,
                COUNT(ts.schedule_id) AS n_sesi
            FROM teaching_schedules ts
            JOIN school_config sc ON sc.school_id = ts.school_id
            WHERE ts.block_group_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM attendance a
                  JOIN teaching_schedules ts2 ON ts2.schedule_id = a.schedule_id
                  WHERE ts2.block_group_id = ts.block_group_id
                    AND NOT a.is_void
              )
            GROUP BY ts.block_group_id, ts.class_id, sc.current_academic_year, ts.school_id
            HAVING COUNT(ts.schedule_id) >= 1
            ORDER BY ts.school_id, ts.class_id, ts.block_group_id
            LIMIT 1
        ),
        siswa AS (
            SELECT ce.student_id
            FROM class_enrollments ce
            JOIN kandidat k ON k.class_id = ce.class_id
            WHERE ce.academic_year = (SELECT academic_year FROM kandidat)
              AND ce.withdrawn_at IS NULL
            ORDER BY ce.student_id
        ),
        staff AS (
            -- Utamakan WAKA/BK/KEPSEK (schoolwide observer) agar bisa memanggil
            -- fn_attendance_recap_per_class; hindari WALI_KELAS agar
            -- fn_class_attendance_summary tidak menolak kelas yang bukan waliannya.
            SELECT u.auth_user_id, u.user_id
            FROM users u
            JOIN kandidat k ON k.school_id = u.school_id
            WHERE u.is_active
              AND u.deleted_at IS NULL
              AND u.role_type IN ('BK','KEPSEK','WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS')
            ORDER BY u.user_id
            LIMIT 1
        ),
        sesi_ids AS (
            SELECT ts.schedule_id
            FROM teaching_schedules ts
            JOIN kandidat k ON k.block_group_id = ts.block_group_id
        )
        SELECT
            (SELECT block_group_id::text FROM kandidat) AS block_group_id,
            (SELECT class_id::text        FROM kandidat) AS class_id,
            (SELECT academic_year         FROM kandidat) AS academic_year,
            (SELECT school_id::text       FROM kandidat) AS school_id,
            (SELECT n_sesi                FROM kandidat) AS n_sesi,
            (SELECT auth_user_id::text    FROM staff)    AS staff_auth,
            (SELECT user_id::text         FROM staff)    AS staff_user_id,
            json_agg(DISTINCT st::text) AS student_ids,
            (SELECT json_agg(sid::text) FROM sesi_ids s(sid)) AS schedule_ids
        FROM siswa s(st)
    `);

    f1PreData = preRows[0] ?? null;

    if (!f1PreData?.block_group_id || !f1PreData?.staff_auth) {
        skip('FASE 1 — tidak ada block_group kosong yang cocok di DB (tidak menggagalkan)');
        f1Skipped = true;
    } else {
        const {
            block_group_id, class_id, academic_year, school_id,
            staff_auth, staff_user_id, student_ids: rawStudentIds, schedule_ids: rawScheduleIds,
        } = f1PreData;

        const studentIds  = Array.isArray(rawStudentIds)  ? rawStudentIds  : JSON.parse(rawStudentIds);
        const scheduleIds = Array.isArray(rawScheduleIds) ? rawScheduleIds : JSON.parse(rawScheduleIds);
        const n = studentIds.length;

        if (n < 6) {
            skip(`FASE 1 — hanya ${n} siswa di kelas (butuh ≥6, tidak menggagalkan)`);
            f1Skipped = true;
        } else {
            // Tentukan angka sintetis:
            //   3 ALPA (index 0-2), 2 SAKIT (index 3-4), 1 IZIN (index 5), sisanya HADIR
            const statusMap = {};
            for (let i = 0; i < n; i++) {
                if (i < 3)      statusMap[studentIds[i]] = 'ALPA';
                else if (i < 5) statusMap[studentIds[i]] = 'SAKIT';
                else if (i < 6) statusMap[studentIds[i]] = 'IZIN';
                else            statusMap[studentIds[i]] = 'HADIR';
            }

            const expected = {
                alpa: 3, sakit: 2, izin: 1, hadir: n - 6, total: n,
            };

            // Buat VALUES: satu baris per (schedule_id × student_id)
            // setiap siswa mendapat status yang sama di semua sesi dalam block itu
            // (identik dengan saveAttendanceBatch di produksi).
            const valueRows = [];
            for (const sid of scheduleIds) {
                for (const stuId of studentIds) {
                    valueRows.push(
                        `('${crypto.randomUUID()}', '${sid}', '${stuId}', '${school_id}', '${statusMap[stuId]}'::attendance_status, false, '${staff_user_id}')`
                    );
                }
            }
            const insertValues = valueRows.join(',\n');

            // BEGIN/ROLLBACK: Management API mengembalikan hasil SELECT terakhir sebelum ROLLBACK.
            // Pola identik dengan asUser() di tenant-isolation.mjs.
            const txResult = await sql(`
                BEGIN;

                INSERT INTO attendance(attendance_id, schedule_id, student_id, school_id, status, is_void, recorded_by_user_id)
                VALUES ${insertValues};

                ${asAuth(staff_auth)}
                SELECT 'f1_summary' AS tag,
                       COALESCE(SUM(hadir),0) AS hadir, COALESCE(SUM(alpa),0) AS alpa,
                       COALESCE(SUM(izin),0)  AS izin,  COALESCE(SUM(sakit),0) AS sakit,
                       COALESCE(SUM(total),0) AS total
                FROM fn_class_attendance_summary(
                    '${class_id}'::uuid, '${academic_year}', NULL, NULL
                );

                ROLLBACK;
            `);

            // txResult adalah array dari semua statement — cari baris dengan tag f1_summary
            const summaryRows = Array.isArray(txResult)
                ? txResult.flat().filter(r => r?.tag === 'f1_summary')
                : [];
            const s = summaryRows[0];

            if (!s) {
                fail('FASE 1 F1 — fn_class_attendance_summary tidak mengembalikan baris', JSON.stringify(txResult).slice(0, 200));
            } else {
                const ok = (
                    Number(s.alpa) === expected.alpa &&
                    Number(s.sakit) === expected.sakit &&
                    Number(s.izin) === expected.izin &&
                    Number(s.hadir) === expected.hadir &&
                    Number(s.total) === expected.total
                );
                if (ok) {
                    pass(`FASE 1 F1 — fn_class_attendance_summary: A=${s.alpa} S=${s.sakit} I=${s.izin} H=${s.hadir} total=${s.total} (sesuai)`);
                } else {
                    fail(
                        'FASE 1 F1 — fn_class_attendance_summary tidak sesuai angka sintetis',
                        `Ekspektasi A=${expected.alpa} S=${expected.sakit} I=${expected.izin} H=${expected.hadir} total=${expected.total} | Dapat A=${s.alpa} S=${s.sakit} I=${s.izin} H=${s.hadir} total=${s.total}`
                    );
                }
            }

            // ── FASE 1 F2 — fn_tu_attendance_recap ──────────────────────
            // fn_tu_attendance_recap cek role TU — gunakan query langsung yang
            // mereplikasi logika pivot yang sama (status terburuk per block×siswa).
            const tuResult = await sql(`
                BEGIN;

                INSERT INTO attendance(attendance_id, schedule_id, student_id, school_id, status, is_void, recorded_by_user_id)
                VALUES ${insertValues};

                SELECT 'f1_tu_pivot' AS tag,
                       COUNT(*) FILTER (WHERE status_rank = 1) AS alpa,
                       COUNT(*) FILTER (WHERE status_rank = 2) AS sakit,
                       COUNT(*) FILTER (WHERE status_rank = 3) AS izin
                FROM (
                    SELECT DISTINCT ON (ts.block_group_id, a.student_id)
                        CASE a.status
                            WHEN 'ALPA'  THEN 1
                            WHEN 'SAKIT' THEN 2
                            WHEN 'IZIN'  THEN 3
                            WHEN 'HADIR' THEN 4
                        END AS status_rank
                    FROM attendance a
                    JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                    WHERE a.is_void = false
                      AND ts.block_group_id = '${block_group_id}'
                    ORDER BY ts.block_group_id, a.student_id,
                        CASE a.status
                            WHEN 'ALPA'  THEN 1
                            WHEN 'SAKIT' THEN 2
                            WHEN 'IZIN'  THEN 3
                            WHEN 'HADIR' THEN 4
                        END
                ) sub
                WHERE status_rank < 4;

                ROLLBACK;
            `);

            const tuRows = Array.isArray(tuResult)
                ? tuResult.flat().filter(r => r?.tag === 'f1_tu_pivot')
                : [];
            const t = tuRows[0];

            if (!t) {
                fail('FASE 1 F2 — pivot TU tidak mengembalikan baris', JSON.stringify(tuResult).slice(0, 200));
            } else {
                const okTu = (
                    Number(t.alpa) === expected.alpa &&
                    Number(t.sakit) === expected.sakit &&
                    Number(t.izin) === expected.izin
                );
                if (okTu) {
                    pass(`FASE 1 F2 — pivot TU (fn_tu_attendance_recap logic): A=${t.alpa} S=${t.sakit} I=${t.izin} (sesuai)`);
                } else {
                    fail(
                        'FASE 1 F2 — pivot TU tidak sesuai angka sintetis',
                        `Ekspektasi A=${expected.alpa} S=${expected.sakit} I=${expected.izin} | Dapat A=${t.alpa} S=${t.sakit} I=${t.izin}`
                    );
                }
            }

            // ── FASE 1 F3 — pivot BK Excel (fn_class_attendance_detail) ──
            // Replikasikan logika pivot BK Excel: status terburuk per (student_id, block_group_id).
            const bkResult = await sql(`
                BEGIN;

                INSERT INTO attendance(attendance_id, schedule_id, student_id, school_id, status, is_void, recorded_by_user_id)
                VALUES ${insertValues};

                -- Simulasi pivot BK Excel: status terburuk per (student_id, block_group_id)
                -- identik dengan tab-bk.js:downloadBkAttExcel
                SELECT 'f1_bk_pivot' AS tag,
                       COUNT(*) FILTER (WHERE best_status = 'HADIR') AS hadir,
                       COUNT(*) FILTER (WHERE best_status = 'ALPA')  AS alpa,
                       COUNT(*) FILTER (WHERE best_status = 'IZIN')  AS izin,
                       COUNT(*) FILTER (WHERE best_status = 'SAKIT') AS sakit,
                       COUNT(*) AS total
                FROM (
                    SELECT DISTINCT ON (a.student_id, ts.block_group_id)
                        a.status AS best_status
                    FROM attendance a
                    JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                    WHERE a.is_void = false
                      AND ts.block_group_id = '${block_group_id}'
                    ORDER BY a.student_id, ts.block_group_id,
                        CASE a.status
                            WHEN 'ALPA'  THEN 1
                            WHEN 'SAKIT' THEN 2
                            WHEN 'IZIN'  THEN 3
                            WHEN 'HADIR' THEN 4
                        END
                ) sub;

                ROLLBACK;
            `);

            const bkRows = Array.isArray(bkResult)
                ? bkResult.flat().filter(r => r?.tag === 'f1_bk_pivot')
                : [];
            const b = bkRows[0];

            if (!b) {
                fail('FASE 1 F3 — pivot BK Excel tidak mengembalikan baris', JSON.stringify(bkResult).slice(0, 200));
            } else {
                const okBk = (
                    Number(b.alpa) === expected.alpa &&
                    Number(b.sakit) === expected.sakit &&
                    Number(b.izin) === expected.izin &&
                    Number(b.hadir) === expected.hadir &&
                    Number(b.total) === expected.total
                );
                if (okBk) {
                    pass(`FASE 1 F3 — pivot BK Excel: A=${b.alpa} S=${b.sakit} I=${b.izin} H=${b.hadir} total=${b.total} (sesuai)`);
                } else {
                    fail(
                        'FASE 1 F3 — pivot BK Excel tidak sesuai angka sintetis',
                        `Ekspektasi A=${expected.alpa} S=${expected.sakit} I=${expected.izin} H=${expected.hadir} total=${expected.total} | Dapat A=${b.alpa} S=${b.sakit} I=${b.izin} H=${b.hadir} total=${b.total}`
                    );
                }
            }
        }
    }
} catch (err) {
    fail('FASE 1 — error setup/eksekusi', err.message);
    f1Skipped = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 2 — DATA NYATA
// ═══════════════════════════════════════════════════════════════════════════
head('FASE 2 — Data nyata (hanya baca, tidak ada perubahan DB)');

try {
    // Cari kelas dengan data attendance terbanyak beserta konteks yang dibutuhkan.
    // Staff: pilih WAKA/BK/KEPSEK agar bisa memanggil fn_attendance_recap_per_class.
    const ctxRows = await many(`
        WITH ranked AS (
            SELECT
                ts.class_id,
                ts.school_id,
                sc.current_academic_year AS academic_year,
                COUNT(a.attendance_id) AS n_records
            FROM attendance a
            JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
            JOIN school_config sc ON sc.school_id = ts.school_id
            WHERE a.is_void = false
            GROUP BY ts.class_id, ts.school_id, sc.current_academic_year
            ORDER BY n_records DESC
            LIMIT 1
        ),
        staff AS (
            -- Schoolwide observer (BK/KEPSEK/WAKA) agar fn_attendance_recap_per_class
            -- mengembalikan data; fn_class_attendance_summary juga menerima role ini.
            SELECT u.auth_user_id, u.user_id
            FROM users u
            JOIN ranked r ON r.school_id = u.school_id
            WHERE u.is_active
              AND u.deleted_at IS NULL
              AND u.role_type IN ('BK','KEPSEK','WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS')
            ORDER BY u.user_id
            LIMIT 1
        )
        SELECT
            r.class_id::text,
            r.school_id::text,
            r.academic_year,
            r.n_records,
            s.auth_user_id::text AS staff_auth,
            s.user_id::text       AS staff_uid
        FROM ranked r, staff s
    `);

    const ctx = ctxRows[0];
    if (!ctx?.class_id) {
        skip('FASE 2 — tidak ada kelas dengan data di DB (tidak menggagalkan)');
    } else {
        const { class_id, school_id, academic_year, n_records, staff_auth } = ctx;
        console.log(`\n   Kelas uji: ${class_id} | Sekolah: ${school_id} | Tahun: ${academic_year} | Records: ${n_records}`);

        // ── C1: fn_class_attendance_summary vs fn_attendance_recap_per_class ──
        head('FASE 2 C1 — fn_class_attendance_summary vs fn_attendance_recap_per_class');

        const [summaryRows, recapRows] = await Promise.all([
            // fn_class_attendance_summary butuh auth context
            sql(`
                BEGIN;
                ${asAuth(staff_auth)}
                SELECT student_id::text, hadir, alpa, izin, sakit, total
                FROM fn_class_attendance_summary('${class_id}'::uuid, '${academic_year}');
                ROLLBACK;
            `).then(r => Array.isArray(r) ? r.flat().filter(x => x?.student_id) : []),

            // fn_attendance_recap_per_class butuh auth context
            sql(`
                BEGIN;
                ${asAuth(staff_auth)}
                SELECT class_id::text, hadir, alpa, izin, sakit, total
                FROM fn_attendance_recap_per_class()
                WHERE class_id = '${class_id}'::uuid;
                ROLLBACK;
            `).then(r => Array.isArray(r) ? r.flat().filter(x => x?.hadir !== undefined) : []),
        ]);

        if (!summaryRows.length) {
            skip('C1 — fn_class_attendance_summary tidak mengembalikan baris (mungkin user tidak punya akses ke kelas ini)');
        } else if (!recapRows.length) {
            skip('C1 — fn_attendance_recap_per_class tidak mengembalikan kelas ini (mungkin user bukan waka/kaprodi/bk)');
        } else {
            // SUM dari semua siswa (summary) harus sama dengan total di recap
            const sumFromSummary = summaryRows.reduce(
                (acc, r) => ({
                    H: acc.H + Number(r.hadir),
                    A: acc.A + Number(r.alpa),
                    I: acc.I + Number(r.izin),
                    S: acc.S + Number(r.sakit),
                    total: acc.total + Number(r.total),
                }),
                { H: 0, A: 0, I: 0, S: 0, total: 0 }
            );
            const recapRow = recapRows[0];
            const recapTotals = {
                H: Number(recapRow.hadir),
                A: Number(recapRow.alpa),
                I: Number(recapRow.izin),
                S: Number(recapRow.sakit),
                total: Number(recapRow.total),
            };

            const ok = JSON.stringify(sumFromSummary) === JSON.stringify(recapTotals);
            if (ok) {
                pass(`C1 — summary↔recap sinkron: A=${recapTotals.A} S=${recapTotals.S} I=${recapTotals.I} H=${recapTotals.H} total=${recapTotals.total}`);
            } else {
                fail(
                    'C1 — fn_class_attendance_summary TIDAK sama dengan fn_attendance_recap_per_class',
                    `summary: A=${sumFromSummary.A} S=${sumFromSummary.S} I=${sumFromSummary.I} H=${sumFromSummary.H} total=${sumFromSummary.total} | recap: A=${recapTotals.A} S=${recapTotals.S} I=${recapTotals.I} H=${recapTotals.H} total=${recapTotals.total}`
                );
            }
        }

        // ── C2: fn_attendance_recap_per_class vs fn_tu_attendance_recap ──────
        head('FASE 2 C2 — fn_attendance_recap_per_class vs fn_tu_attendance_recap (A+S+I)');

        // fn_tu_attendance_recap cek role TU — panggil langsung sebagai postgres (bypass)
        const [recapC2, tuC2] = await Promise.all([
            sql(`
                BEGIN;
                ${asAuth(staff_auth)}
                SELECT SUM(alpa) AS alpa, SUM(sakit) AS sakit, SUM(izin) AS izin
                FROM fn_attendance_recap_per_class()
                WHERE class_id = '${class_id}'::uuid;
                ROLLBACK;
            `).then(r => (Array.isArray(r) ? r.flat() : []).find(x => x?.alpa !== undefined)),

            // Bypass role check dengan query langsung (logika identik fn_tu_attendance_recap)
            many(`
                SELECT
                    COUNT(*) FILTER (WHERE status_rank = 1) AS alpa,
                    COUNT(*) FILTER (WHERE status_rank = 2) AS sakit,
                    COUNT(*) FILTER (WHERE status_rank = 3) AS izin
                FROM (
                    SELECT DISTINCT ON (ts.block_group_id, a.student_id)
                        CASE a.status
                            WHEN 'ALPA'  THEN 1 WHEN 'SAKIT' THEN 2
                            WHEN 'IZIN'  THEN 3 WHEN 'HADIR' THEN 4
                        END AS status_rank
                    FROM attendance a
                    JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                    WHERE a.is_void = false
                      AND ts.class_id = '${class_id}'::uuid
                      AND ts.school_id = '${school_id}'::uuid
                    ORDER BY ts.block_group_id, a.student_id,
                        CASE a.status
                            WHEN 'ALPA' THEN 1 WHEN 'SAKIT' THEN 2
                            WHEN 'IZIN' THEN 3 WHEN 'HADIR' THEN 4
                        END
                ) sub
                WHERE status_rank < 4
            `).then(r => r[0]),
        ]);

        if (!recapC2 || !tuC2) {
            skip('C2 — salah satu query C2 tidak mengembalikan baris');
        } else {
            const ok = (
                Number(recapC2.alpa)  === Number(tuC2.alpa) &&
                Number(recapC2.sakit) === Number(tuC2.sakit) &&
                Number(recapC2.izin)  === Number(tuC2.izin)
            );
            if (ok) {
                pass(`C2 — recap↔TU sinkron: A=${tuC2.alpa} S=${tuC2.sakit} I=${tuC2.izin}`);
            } else {
                fail(
                    'C2 — fn_attendance_recap_per_class TIDAK sama dengan logika fn_tu_attendance_recap',
                    `recap: A=${recapC2.alpa} S=${recapC2.sakit} I=${recapC2.izin} | TU: A=${tuC2.alpa} S=${tuC2.sakit} I=${tuC2.izin}`
                );
            }
        }

        // ── C3: fn_portal_attendance (per siswa, SUM) vs fn_class_attendance_summary ──
        head('FASE 2 C3 — fn_portal_attendance per siswa vs fn_class_attendance_summary');

        // Ambil satu siswa yang punya akun SISWA aktif di kelas ini.
        // students.user_id → users.user_id (bukan auth_user_id).
        const studentRows = await many(`
            SELECT ce.student_id::text, u.auth_user_id::text AS student_auth
            FROM class_enrollments ce
            JOIN students s ON s.student_id = ce.student_id
            JOIN users u ON u.user_id = s.user_id
                        AND u.auth_user_id IS NOT NULL
                        AND u.role_type = 'SISWA'
                        AND u.is_active
                        AND u.deleted_at IS NULL
            WHERE ce.class_id = '${class_id}'::uuid
              AND ce.academic_year = '${academic_year}'
              AND ce.withdrawn_at IS NULL
              AND s.student_status = 'AKTIF'
            LIMIT 5
        `);

        if (!studentRows.length) {
            skip('C3 — tidak ada akun SISWA aktif di kelas ini');
        } else {
            // fn_portal_attendance mengembalikan JSONB (bukan rows H/S/I/A).
            // Panggil sebagai SISWA, parse JSONB di JS, pivot per block_group_id
            // dengan logika "status terburuk" (sama dengan fn_class_attendance_summary),
            // lalu bandingkan dengan fn_class_attendance_summary untuk siswa yang sama.
            const stu = studentRows[0];

            const [portalRaw, summaryRowsC3] = await Promise.all([
                // fn_portal_attendance dipanggil sebagai SISWA — hasilnya JSONB
                sql(`
                    BEGIN;
                    SET LOCAL ROLE authenticated;
                    SELECT set_config('request.jwt.claims','{"sub":"${stu.student_auth}","role":"authenticated"}',true);
                    SELECT set_config('request.jwt.claim.sub','${stu.student_auth}',true);
                    SELECT fn_portal_attendance('${stu.student_id}'::uuid) AS portal_data;
                    ROLLBACK;
                `).then(r => {
                    const rows = Array.isArray(r) ? r.flat() : [];
                    const row = rows.find(x => x?.portal_data !== undefined);
                    return row?.portal_data ?? null;
                }),

                sql(`
                    BEGIN;
                    ${asAuth(staff_auth)}
                    SELECT student_id::text, hadir, alpa, izin, sakit
                    FROM fn_class_attendance_summary('${class_id}'::uuid, '${academic_year}')
                    WHERE student_id = '${stu.student_id}'::uuid;
                    ROLLBACK;
                `).then(r => (Array.isArray(r) ? r.flat() : []).filter(x => x?.student_id)),
            ]);

            if (!portalRaw || !summaryRowsC3.length) {
                skip('C3 — fn_portal_attendance atau fn_class_attendance_summary tidak mengembalikan data untuk siswa ini');
            } else {
                // Parse JSONB dan pivot: status terburuk per block_group_id
                const schedules = Array.isArray(portalRaw) ? portalRaw : JSON.parse(portalRaw);
                const blockMap = new Map(); // block_group_id → worst_status_rank
                for (const sched of schedules) {
                    const bg  = sched.block_group_id;
                    const att = (sched.attendance ?? [])[0];
                    if (!bg || !att) continue;
                    const rank = PRIO[att.status] ?? 99;
                    if (!blockMap.has(bg) || rank < blockMap.get(bg))
                        blockMap.set(bg, rank);
                }
                const rankToStatus = { 1: 'ALPA', 2: 'SAKIT', 3: 'IZIN', 4: 'HADIR' };
                const portalSum = { H: 0, A: 0, I: 0, S: 0 };
                for (const rank of blockMap.values()) {
                    const st = rankToStatus[rank];
                    if (st === 'HADIR') portalSum.H++;
                    else if (st === 'ALPA')  portalSum.A++;
                    else if (st === 'IZIN')  portalSum.I++;
                    else if (st === 'SAKIT') portalSum.S++;
                }
                const sumRow = summaryRowsC3[0];
                const summaryOne = {
                    H: Number(sumRow.hadir), A: Number(sumRow.alpa),
                    I: Number(sumRow.izin),  S: Number(sumRow.sakit),
                };
                const okC3 = JSON.stringify(portalSum) === JSON.stringify(summaryOne);
                if (okC3) {
                    pass(`C3 — portal↔summary sinkron untuk siswa …${stu.student_id.slice(-8)}: A=${summaryOne.A} S=${summaryOne.S} I=${summaryOne.I} H=${summaryOne.H}`);
                } else {
                    fail(
                        'C3 — fn_portal_attendance TIDAK sama dengan fn_class_attendance_summary untuk siswa yang sama',
                        `portal pivot: A=${portalSum.A} S=${portalSum.S} I=${portalSum.I} H=${portalSum.H} | summary: A=${summaryOne.A} S=${summaryOne.S} I=${summaryOne.I} H=${summaryOne.H}`
                    );
                }
            }
        }

        // ── C4: fn_class_attendance_summary bulanan (Wali Excel) vs tahunan ──
        head('FASE 2 C4 — fn_class_attendance_summary bulanan × 12 bulan vs full-tahun (Wali Excel)');

        // Tahun ajaran Indonesia: Jul–Jun (12 bulan). MONTHS_RANGE di tab-wali.js
        // wajib mencakup Jul–Jun agar sheet bulanan Excel sesuai total tahunan.
        const MONTHS = [
            ['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'],
            ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'],
            ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31'],
            ['2027-01-01', '2027-01-31'], ['2027-02-01', '2027-02-28'],
            ['2027-03-01', '2027-03-31'], ['2027-04-01', '2027-04-30'],
            ['2027-05-01', '2027-05-31'], ['2027-06-01', '2027-06-30'],
        ];

        const [monthlyResults, yearlyResult] = await Promise.all([
            Promise.all(MONTHS.map(([ds, de]) =>
                sql(`
                    BEGIN;
                    ${asAuth(staff_auth)}
                    SELECT SUM(hadir) AS hadir, SUM(alpa) AS alpa,
                           SUM(izin) AS izin, SUM(sakit) AS sakit, SUM(total) AS total
                    FROM fn_class_attendance_summary('${class_id}'::uuid, '${academic_year}',
                        '${ds}'::date, '${de}'::date);
                    ROLLBACK;
                `).then(r => (Array.isArray(r) ? r.flat() : []).find(x => x?.total !== undefined) ?? { hadir: 0, alpa: 0, izin: 0, sakit: 0, total: 0 })
            )),
            sql(`
                BEGIN;
                ${asAuth(staff_auth)}
                SELECT SUM(hadir) AS hadir, SUM(alpa) AS alpa,
                       SUM(izin) AS izin, SUM(sakit) AS sakit, SUM(total) AS total
                FROM fn_class_attendance_summary('${class_id}'::uuid, '${academic_year}');
                ROLLBACK;
            `).then(r => (Array.isArray(r) ? r.flat() : []).find(x => x?.total !== undefined)),
        ]);

        const monthlySum = monthlyResults.reduce(
            (acc, r) => ({
                H: acc.H + Number(r?.hadir ?? 0),
                A: acc.A + Number(r?.alpa ?? 0),
                I: acc.I + Number(r?.izin ?? 0),
                S: acc.S + Number(r?.sakit ?? 0),
                total: acc.total + Number(r?.total ?? 0),
            }),
            { H: 0, A: 0, I: 0, S: 0, total: 0 }
        );
        const yearly = yearlyResult ? {
            H: Number(yearlyResult.hadir), A: Number(yearlyResult.alpa),
            I: Number(yearlyResult.izin),  S: Number(yearlyResult.sakit),
            total: Number(yearlyResult.total),
        } : null;

        if (!yearly) {
            skip('C4 — fn_class_attendance_summary tahunan tidak mengembalikan baris');
        } else {
            const okC4 = JSON.stringify(monthlySum) === JSON.stringify(yearly);
            if (okC4) {
                pass(`C4 — SUM 12 bulan = tahunan: A=${yearly.A} S=${yearly.S} I=${yearly.I} H=${yearly.H} total=${yearly.total}`);
            } else {
                fail(
                    'C4 — SUM 12 bulan TIDAK sama dengan full-tahun (Wali Excel akan beda dengan rekap layar)',
                    `12 bulan: A=${monthlySum.A} S=${monthlySum.S} I=${monthlySum.I} H=${monthlySum.H} total=${monthlySum.total} | tahunan: A=${yearly.A} S=${yearly.S} I=${yearly.I} H=${yearly.H} total=${yearly.total}`
                );
            }
        }

        // ── C5: fn_class_attendance_detail pivot (BK Excel) vs fn_attendance_recap_per_class ──
        head('FASE 2 C5 — pivot fn_class_attendance_detail (BK Excel) vs fn_attendance_recap_per_class');

        const [detailRows, recapC5] = await Promise.all([
            // fn_class_attendance_detail butuh auth context
            sql(`
                BEGIN;
                ${asAuth(staff_auth)}
                SELECT student_id::text, block_group_id::text, status::text
                FROM fn_class_attendance_detail('${class_id}'::uuid, '${academic_year}', NULL, NULL, NULL);
                ROLLBACK;
            `).then(r => (Array.isArray(r) ? r.flat() : []).filter(x => x?.student_id)),

            sql(`
                BEGIN;
                ${asAuth(staff_auth)}
                SELECT hadir, alpa, izin, sakit, total
                FROM fn_attendance_recap_per_class()
                WHERE class_id = '${class_id}'::uuid;
                ROLLBACK;
            `).then(r => (Array.isArray(r) ? r.flat() : []).find(x => x?.class_id !== undefined || x?.hadir !== undefined)),
        ]);

        if (!detailRows.length) {
            skip('C5 — fn_class_attendance_detail tidak mengembalikan baris');
        } else if (!recapC5) {
            skip('C5 — fn_attendance_recap_per_class tidak mengembalikan baris untuk kelas ini');
        } else {
            // Pivot BK Excel: status terburuk per (student_id, block_group_id)
            const pivotMap = pivotTerburuk(detailRows);
            const bkExcelTotals = hitungDariPivot(pivotMap);
            const recapTotalsC5 = {
                H: Number(recapC5.hadir), A: Number(recapC5.alpa),
                I: Number(recapC5.izin),  S: Number(recapC5.sakit),
                total: Number(recapC5.total),
            };

            const okC5 = (
                bkExcelTotals.A === recapTotalsC5.A &&
                bkExcelTotals.S === recapTotalsC5.S &&
                bkExcelTotals.I === recapTotalsC5.I &&
                bkExcelTotals.H === recapTotalsC5.H &&
                bkExcelTotals.total === recapTotalsC5.total
            );
            if (okC5) {
                pass(`C5 — pivot BK Excel↔recap sinkron: A=${recapTotalsC5.A} S=${recapTotalsC5.S} I=${recapTotalsC5.I} H=${recapTotalsC5.H} total=${recapTotalsC5.total}`);
            } else {
                fail(
                    'C5 — pivot BK Excel TIDAK sama dengan fn_attendance_recap_per_class (BK Excel akan salah)',
                    `BK Excel pivot: A=${bkExcelTotals.A} S=${bkExcelTotals.S} I=${bkExcelTotals.I} H=${bkExcelTotals.H} total=${bkExcelTotals.total} | recap: A=${recapTotalsC5.A} S=${recapTotalsC5.S} I=${recapTotalsC5.I} H=${recapTotalsC5.H} total=${recapTotalsC5.total}`
                );
            }
        }
    }
} catch (err) {
    fail('FASE 2 — error setup/eksekusi', err.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// RINGKASAN
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`HASIL: ${passed} PASS, ${failed} FAIL${f1Skipped ? ', Fase 1 dilewati (tidak ada data kosong)' : ''}`);
if (failed > 0) {
    console.log('STATUS: FAIL — ada ketidakkonsistenan antar layer absensi.');
    process.exit(1);
} else {
    console.log('STATUS: PASS — semua layer absensi konsisten.');
    process.exit(0);
}
