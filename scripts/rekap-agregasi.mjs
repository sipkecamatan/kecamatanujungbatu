/**
 * Verifikasi rantai agregasi rekap absensi: Waka → Wali Kelas → Guru
 *
 * Membuktikan bahwa angka di lapisan atas adalah penjumlahan eksak lapisan bawah:
 *   Waka (total sekolah) = SUM wali per kelas = SUM guru per kelas
 *   Kaprodi (total prodi) = SUM wali per kelas di prodi = SUM guru per kelas di prodi
 *
 * Jalankan: node scripts/rekap-agregasi.mjs
 * Butuh:    SUPABASE_URL, SUPABASE_ACCESS_TOKEN di .env
 * Output:   docs/rekap-agregasi-<tanggal>.md
 */

import fs from 'fs';

// ── Output ke file MD ────────────────────────────────────────────────────────
const outDir  = 'docs';
const outFile = `${outDir}/rekap-agregasi-${new Date().toISOString().slice(0,10)}.md`;
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const lines = [];
function emit(...args) {
  const s = args.join(' ');
  process.stdout.write(s + '\n');
  lines.push(s);
}
function flush() {
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log(`\nHasil ditulis ke: ${outFile}`);
}

const envRaw = fs.readFileSync('.env', 'utf8');
const get = k => (envRaw.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1]?.trim().replace(/^<|>$/g, '');

const SUPABASE_URL = get('SUPABASE_URL');
const MGMT_TOKEN   = get('SUPABASE_ACCESS_TOKEN');
const PROJECT_REF  = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];

if (!PROJECT_REF || !MGMT_TOKEN) {
  console.error('ERROR: SUPABASE_URL atau SUPABASE_ACCESS_TOKEN tidak ditemukan di .env');
  process.exit(1);
}

const SCHOOLS = [
  { nama: 'SMK Uji 1', school_id: '5d67c321-ec65-4ecb-b1d3-672ce7628a17' },
  { nama: 'SMA Uji 1', school_id: 'a41a1f24-3ed2-464e-8e06-754f4dfd3c1f' },
  { nama: 'SMP Uji 1', school_id: '4ba66164-4f9d-4973-9afe-cf7e473ef91b' },
];

// Rentang tahun ajaran berjalan (Jul–Jun)
const now   = new Date();
const tahun = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const P_FROM = `${tahun}-07-01`;
const P_TO   = `${tahun + 1}-06-30`;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return Array.isArray(json) ? json : [];
}

function hsia(r) {
  return { h: +r?.hadir || 0, s: +r?.sakit || 0, i: +r?.izin || 0, a: +r?.alpa || 0 };
}

function sumHsia(rows) {
  return rows.reduce((acc, r) => {
    const v = hsia(r);
    return { h: acc.h + v.h, s: acc.s + v.s, i: acc.i + v.i, a: acc.a + v.a };
  }, { h: 0, s: 0, i: 0, a: 0 });
}

function cocok(a, b) {
  return a.h === b.h && a.s === b.s && a.i === b.i && a.a === b.a;
}

function fmt(v) {
  return `H:${String(v.h).padStart(4)} S:${String(v.s).padStart(3)} I:${String(v.i).padStart(3)} A:${String(v.a).padStart(3)}`;
}

function check(label, a, b) {
  if (cocok(a, b)) {
    emit(`    ✓ ${label}`);
    return true;
  } else {
    const selisih = {
      h: a.h - b.h, s: a.s - b.s, i: a.i - b.i, a: a.a - b.a,
    };
    emit(`    ✗ ${label}`);
    emit(`      Atas  : ${fmt(a)}`);
    emit(`      Bawah : ${fmt(b)}`);
    emit(`      Selisih: H:${selisih.h} S:${selisih.s} I:${selisih.i} A:${selisih.a}`);
    return false;
  }
}

// ── CTE pivot status terburuk per (siswa × kelas × block_group_id) ──────────
// Identik dengan logika fn_attendance_recap_per_class dan fn_class_attendance_summary.
// Menyertakan scheduled_teacher_id per block sehingga bisa di-breakdown per guru.
//
// Catatan: setelah migration 20261101050000, setiap block_group_id dijamin satu guru
// dan satu mata pelajaran (PARTITION BY class_id, session_date, teacher_id, subject_id).
// block_teacher_cte mengambil MAX(teacher_id) sebagai fallback aman jika ada sisa data lama.
function pivotCTE(school_id) {
  return `
    att_raw AS (
      SELECT
        a.student_id,
        ts.class_id,
        ts.block_group_id,
        ts.scheduled_teacher_id,
        a.status::text AS status
      FROM attendance a
      JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
      WHERE a.school_id = '${school_id}'
        AND ts.session_date BETWEEN '${P_FROM}'::date AND '${P_TO}'::date
        AND a.is_void = false
        AND a.status IS NOT NULL
    ),
    block_teacher AS (
      SELECT block_group_id, MAX(scheduled_teacher_id::text)::uuid AS teacher_id
      FROM att_raw
      GROUP BY block_group_id
    ),
    att_pivot AS (
      SELECT
        r.student_id,
        r.class_id,
        r.block_group_id,
        bt.teacher_id,
        CASE MAX(CASE r.status
          WHEN 'ALPA'  THEN 4
          WHEN 'SAKIT' THEN 3
          WHEN 'IZIN'  THEN 2
          WHEN 'HADIR' THEN 1
          ELSE 0 END)
          WHEN 4 THEN 'ALPA'
          WHEN 3 THEN 'SAKIT'
          WHEN 2 THEN 'IZIN'
          WHEN 1 THEN 'HADIR'
        END AS status
      FROM att_raw r
      JOIN block_teacher bt ON bt.block_group_id = r.block_group_id
      GROUP BY r.student_id, r.class_id, r.block_group_id, bt.teacher_id
    )
  `;
}

// ── Query builders ───────────────────────────────────────────────────────────

// Rekap per kelas (logika waka/kaprodi: fn_attendance_recap_per_class)
// Mengembalikan satu baris per kelas: class_id, name, h/s/i/a
async function rekapPerKelas(school_id, class_ids = null) {
  const filterKelas = class_ids
    ? `AND c.class_id IN (${class_ids.map(id => `'${id}'`).join(',')})`
    : '';
  return sql(`
    WITH ${pivotCTE(school_id)}
    SELECT
      ap.class_id,
      c.name AS class_name,
      COUNT(*) FILTER (WHERE ap.status = 'HADIR')::int AS hadir,
      COUNT(*) FILTER (WHERE ap.status = 'SAKIT')::int AS sakit,
      COUNT(*) FILTER (WHERE ap.status = 'IZIN') ::int AS izin,
      COUNT(*) FILTER (WHERE ap.status = 'ALPA') ::int AS alpa
    FROM att_pivot ap
    JOIN classes c ON c.class_id = ap.class_id
    WHERE TRUE ${filterKelas}
    GROUP BY ap.class_id, c.name
    ORDER BY c.name
  `);
}

// Rekap per kelas per guru (logika wali: fn_class_attendance_summary dengan filter teacher_id)
// Mengembalikan satu baris per (kelas, guru): class_id, teacher_id, teacher_name, h/s/i/a
async function rekapPerKelasPerGuru(school_id, class_ids = null) {
  const filterKelas = class_ids
    ? `AND ap.class_id IN (${class_ids.map(id => `'${id}'`).join(',')})`
    : '';
  return sql(`
    WITH ${pivotCTE(school_id)}
    SELECT
      ap.class_id,
      c.name AS class_name,
      ap.teacher_id,
      COALESCE(u.full_name, ap.teacher_id::text) AS teacher_name,
      COUNT(*) FILTER (WHERE ap.status = 'HADIR')::int AS hadir,
      COUNT(*) FILTER (WHERE ap.status = 'SAKIT')::int AS sakit,
      COUNT(*) FILTER (WHERE ap.status = 'IZIN') ::int AS izin,
      COUNT(*) FILTER (WHERE ap.status = 'ALPA') ::int AS alpa
    FROM att_pivot ap
    JOIN classes c ON c.class_id = ap.class_id
    LEFT JOIN users u ON u.user_id = ap.teacher_id
    WHERE TRUE ${filterKelas}
    GROUP BY ap.class_id, c.name, ap.teacher_id, u.full_name
    ORDER BY c.name, u.full_name
  `);
}

// Ambil daftar program (prodi) dan kelas per program untuk sekolah ini
async function getPrograms(school_id) {
  return sql(`
    SELECT
      p.program_id,
      p.name AS program_name,
      array_agg(c.class_id::text ORDER BY c.name) AS class_ids,
      array_agg(c.name ORDER BY c.name) AS class_names
    FROM programs p
    JOIN classes c ON c.program_id = p.program_id
    WHERE p.school_id = '${school_id}' AND c.is_active = true
    GROUP BY p.program_id, p.name
    ORDER BY p.name
  `);
}

// ── Verifikasi satu sekolah ──────────────────────────────────────────────────

async function cekSekolah(s) {
  emit(`\n${'═'.repeat(60)}`);
  emit(`  ${s.nama}`);
  emit(`${'═'.repeat(60)}`);

  let kelasRows, guruRows;
  try {
    [kelasRows, guruRows] = await Promise.all([
      rekapPerKelas(s.school_id),
      rekapPerKelasPerGuru(s.school_id),
    ]);
  } catch (e) {
    emit(`  [!] ERROR query utama: ${e.message}`);
    return;
  }

  if (!kelasRows.length) {
    emit(`  [-] Tidak ada data absensi tahun ajaran ini — lewati`);
    return;
  }

  // ── Tingkat 1: WAKA KESISWAAN ─────────────────────────────────────────────
  const totalWaka = sumHsia(kelasRows);

  emit(`\n  WAKA KESISWAAN — total seluruh sekolah`);
  emit(`  ${fmt(totalWaka)}`);
  emit(`  ${'─'.repeat(55)}`);

  let allKelasSum = { h: 0, s: 0, i: 0, a: 0 };
  let waka_ok = true;

  for (const kelas of kelasRows) {
    const totalKelas = hsia(kelas);

    const guruDiKelas = guruRows.filter(r => r.class_id === kelas.class_id);
    const sumGuru = sumHsia(guruDiKelas);

    emit(`\n    Kelas ${kelas.class_name}`);
    emit(`    Wali   : ${fmt(totalKelas)}`);

    if (guruDiKelas.length === 0) {
      emit(`    Guru   : (tidak ada data guru)`);
    } else {
      for (const g of guruDiKelas) {
        emit(`      └─ ${g.teacher_name.padEnd(30)} ${fmt(hsia(g))}`);
      }
      emit(`    SUM guru: ${fmt(sumGuru)}`);
      const ok = check('Wali = SUM guru', totalKelas, sumGuru);
      if (!ok) waka_ok = false;
    }

    allKelasSum.h += totalKelas.h;
    allKelasSum.s += totalKelas.s;
    allKelasSum.i += totalKelas.i;
    allKelasSum.a += totalKelas.a;
  }

  emit(`\n  SUM semua kelas : ${fmt(allKelasSum)}`);
  const wakaCheck = check('Waka = SUM kelas', totalWaka, allKelasSum);
  if (!wakaCheck) waka_ok = false;

  // ── Tingkat 2: KAPRODI (per program) ─────────────────────────────────────
  let programs;
  try {
    programs = await getPrograms(s.school_id);
  } catch (e) {
    emit(`\n  [!] Tidak bisa ambil program: ${e.message}`);
    return;
  }

  for (const prog of programs) {
    const classIds = Array.isArray(prog.class_ids)
      ? prog.class_ids
      : JSON.parse(prog.class_ids || '[]');

    if (!classIds.length) continue;

    const kelasProdi  = kelasRows.filter(r => classIds.includes(r.class_id));
    const guruProdi   = guruRows.filter(r => classIds.includes(r.class_id));

    if (!kelasProdi.length) continue;

    const totalProdi = sumHsia(kelasProdi);

    emit(`\n  ${'─'.repeat(55)}`);
    emit(`  KAPRODI ${prog.program_name}`);
    emit(`  ${fmt(totalProdi)}`);

    let prodiKelasSum = { h: 0, s: 0, i: 0, a: 0 };

    for (const kelas of kelasProdi) {
      const totalKelas = hsia(kelas);
      const guruDiKelas = guruProdi.filter(r => r.class_id === kelas.class_id);
      const sumGuru = sumHsia(guruDiKelas);

      emit(`\n    Kelas ${kelas.class_name}`);
      emit(`    Wali   : ${fmt(totalKelas)}`);

      if (guruDiKelas.length) {
        for (const g of guruDiKelas) {
          emit(`      └─ ${g.teacher_name.padEnd(30)} ${fmt(hsia(g))}`);
        }
        emit(`    SUM guru: ${fmt(sumGuru)}`);
        check('Wali = SUM guru', totalKelas, sumGuru);
      }

      prodiKelasSum.h += totalKelas.h;
      prodiKelasSum.s += totalKelas.s;
      prodiKelasSum.i += totalKelas.i;
      prodiKelasSum.a += totalKelas.a;
    }

    emit(`\n  SUM kelas di ${prog.program_name}: ${fmt(prodiKelasSum)}`);
    check(`Kaprodi ${prog.program_name} = SUM kelas`, totalProdi, prodiKelasSum);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

emit(`# Verifikasi Rantai Agregasi Absensi: Waka → Wali Kelas → Guru`);
emit(`\nTahun ajaran: ${tahun}/${tahun + 1} (${P_FROM} s.d. ${P_TO})`);
emit(`Dijalankan: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`);

for (const s of SCHOOLS) {
  await cekSekolah(s);
  // Jeda antar sekolah untuk hindari rate limit Management API
  await new Promise(r => setTimeout(r, 3000));
}

emit(`\n${'═'.repeat(60)}`);
emit(`Selesai.`);
flush();
