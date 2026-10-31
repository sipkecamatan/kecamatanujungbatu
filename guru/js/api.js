/**
 * @file guru/js/api.js
 * Supabase wrapper untuk Portal Guru (semua peran staf sekolah).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { saveObservation, saveJournalEntry, saveCase, deleteJournalEntryOffline } from './offline.js';

// Diekspor agar offline.js dapat memakainya di postEdgeFn tanpa membuat
// client Supabase duplikat (regresi 6ded3e5: konstanta ini pernah terhapus
// bersama client duplikat, membuat postEdgeFn lempar ReferenceError → semua
// submit edge-function guru gagal senyap dan mengantre selamanya).
export const SUPABASE_URL      = 'https://lqgzpiohxdzkkmxjtwor.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ3pwaW9oeGR6a2tteGp0d29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTA2MjksImV4cCI6MjEwNzQ2NjYyOX0.omL9CGL5Ckcm2SXquYbXHr-aE8mLUe6H9FewDou-Lp4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage, storageKey: 'sip-guru' },
});

// Semua role_type yang boleh masuk portal ini
export const GURU_ROLES = ['GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','WAKASEK'];

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });
    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('NIP/NIK tidak ditemukan di sekolah ini. Hubungi admin untuk memastikan akun sudah dibuat.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Kalau ini login pertama Anda, gunakan password awal 12345678. Kalau lupa password, minta admin sekolah mengembalikannya ke 12345678 lewat tombol Reset PW.');
    }
}

export async function logout() {
    await supabase.auth.signOut();
}

// ── Peringatan login dari perangkat baru (Item 5, Opsi A) ─────
// Menghitung "sidik jari" perangkat stabil (id acak persisten di
// localStorage + userAgent) lalu mendaftarkannya lewat RPC. Bila
// perangkat belum pernah dipakai (dan bukan yang pertama), server
// menaruh notifikasi "Login dari perangkat baru" di lonceng.
// Non-blocking & fail-safe: kegagalan tidak pernah menghalangi login.
function parseDeviceLabel(ua) {
    ua = ua || '';
    let browser = 'Browser';
    if (/Edg\//.test(ua))            browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua))    browser = 'Chrome';
    else if (/Firefox\//.test(ua))   browser = 'Firefox';
    else if (/Safari\//.test(ua))    browser = 'Safari';
    let os = 'perangkat';
    if (/Windows/.test(ua))                 os = 'Windows';
    else if (/Android/.test(ua))            os = 'Android';
    else if (/iPhone|iPad|iOS/.test(ua))    os = 'iOS';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac';
    else if (/Linux/.test(ua))              os = 'Linux';
    return `${browser} di ${os}`;
}

export async function registerLoginDevice() {
    try {
        let devId = localStorage.getItem('sip_device_id');
        if (!devId) { devId = crypto.randomUUID(); localStorage.setItem('sip_device_id', devId); }
        const ua  = navigator.userAgent || '';
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(devId + '|' + ua));
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        const { data, error } = await supabase.rpc('fn_register_login_device', {
            p_device_hash: hash,
            p_user_agent:  ua.slice(0, 400),
            p_label:       parseDeviceLabel(ua),
        });
        if (error) { console.warn('[login-device]', error.message); return null; }
        return data; // 'known' | 'first' | 'new'
    } catch (e) {
        console.warn('[login-device]', e);
        return null;
    }
}

export async function getCurrentUserRow(authUser = null) {
    const user = authUser ?? (await supabase.auth.getUser()).data?.user;
    if (!user) return null;
    const { data, error } = await supabase
        .from('users')
        .select(`
            user_id, school_id, full_name, role_type, login_identifier, teacher_code,
            wali_kelas_class_id, kaprodi_program_id,
            is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, is_waka_humas, is_active,
            deleted_at,
            must_change_password, last_seen_at, last_seen_ua,
            teaching_assignments(count)
        `)
        .eq('auth_user_id', user.id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Kembalikan daftar jabatan aktif user berdasarkan role_type + flag tambahan.
 * Dipakai untuk menentukan tab mana yang muncul di dashboard.
 */
export function getJabatan(u) {
    if (!u) return [];
    const j = [];
    if (u.role_type === 'WALI_KELAS' || u.wali_kelas_class_id) j.push('wali_kelas');
    if (u.role_type === 'BK'         || u.is_bk)               j.push('bk');
    if (u.role_type === 'KAPRODI'    || u.kaprodi_program_id)   j.push('kaprodi');
    if (u.role_type === 'WAKA_KESISWAAN' || u.role_type === 'WAKASEK' || u.is_waka_kesiswaan) j.push('waka_kesiswaan');
    if (u.role_type === 'WAKA_KURIKULUM' || u.role_type === 'WAKASEK' || u.is_waka_kurikulum) j.push('waka_kurikulum');
    if (u.role_type === 'KEPSEK'     || u.is_kepsek)            j.push('kepsek');
    if (u.role_type === 'WAKA_HUMAS' || u.role_type === 'WAKASEK' || u.is_waka_humas)        j.push('waka_humas');
    return j;
}

export function jabatanLabel(key) {
    return {
        wali_kelas:    'Wali Kelas',
        bk:            'BK',
        kaprodi:       'Kaprodi',
        waka_kesiswaan:'Waka Kesiswaan',
        waka_kurikulum:'Waka Kurikulum',
        kepsek:        'Kepala Sekolah',
        waka_humas:    'Waka Humas',
    }[key] ?? key;
}

// ─── JADWAL GURU ────────────────────────────────────────────

export async function getSchoolConfig() {
    const { data } = await supabase.from('school_config')
        .select('current_academic_year, current_semester, schools!inner(jenjang)')
        .single();
    if (!data) return data;
    return { ...data, jenjang: data.schools?.jenjang ?? null };
}

/**
 * Jadwal mengajar guru pada tanggal tertentu.
 * Filter langsung via scheduled_teacher_id (tidak perlu join ke assignments).
 */
export async function getMyScheduleForDate(userId, date) {
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select(`
            schedule_id, session_date, session_start, session_end, subject_label,
            class:classes ( class_id, name )
        `)
        .eq('session_date', date)
        .eq('scheduled_teacher_id', userId)
        .order('session_start');
    if (error) throw error;
    return data ?? [];
}

/**
 * Kelas unik yang diampu guru ini pada tahun ajaran + semester tertentu.
 * Dipakai untuk dropdown rekap absensi guru.
 */
export async function getMyClasses(userId, academicYear, semester) {
    const { data, error } = await supabase
        .from('teaching_assignments')
        .select('class:classes ( class_id, name )')
        .eq('user_id', userId)
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('is_active', true);
    if (error) throw error;
    const seen = new Set();
    const classes = [];
    for (const ta of data ?? []) {
        const c = ta.class;
        if (c && !seen.has(c.class_id)) {
            seen.add(c.class_id);
            classes.push(c);
        }
    }
    return classes.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

/**
 * Semua kelas aktif dalam satu program keahlian.
 * Dipakai sebagai fallback rekap untuk Kaprodi yang tidak punya teaching_assignments.
 */
export async function getClassesByProgram(programId) {
    const { data, error } = await supabase
        .from('classes')
        .select('class_id, name')
        .eq('program_id', programId)
        .eq('is_active', true)
        .order('name');
    if (error) throw error;
    return data ?? [];
}

// ─── SISWA & KEHADIRAN ───────────────────────────────────────

/**
 * Daftar siswa aktif di suatu kelas (via class_enrollments, tidak withdrawn).
 */
export async function getEnrolledStudents(classId, academicYear, semester = null) {
    let req = supabase
        .from('class_enrollments')
        .select('semester, student:students ( student_id, nis, full_name, student_status )')
        .eq('class_id', classId)
        .eq('academic_year', academicYear)
        .is('withdrawn_at', null);
    // DG-02: pendaftaran bersifat per semester; tanpa filter ini roster Semester 1 dan 2 tercampur (siswa ganda).
    if (semester) req = req.eq('semester', semester);
    const { data, error } = await req;
    if (error) throw error;
    // DROPOUT-1 (Tema I): roster kelas hanya siswa AKTIF — siswa KELUAR/LULUS/PKL
    // tak ikut diabsen di kelas (PKL diabsen via pkl_attendance). Riwayat mereka
    // tetap terlihat di tampilan lain; ini hanya menyaring daftar absen harian.
    const unik = new Map();
    for (const r of (data ?? [])) if (r.student && !unik.has(r.student.student_id)) unik.set(r.student.student_id, r.student);
    return [...unik.values()]
        .filter(s => s.student_status === 'AKTIF')
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

/**
 * Kehadiran yang sudah ada untuk satu sesi jadwal.
 * Returns Map: student_id → { attendance_id, status, notes }
 */
export async function getAttendanceForSession(scheduleId) {
    const { data, error } = await supabase
        .from('attendance')
        .select('attendance_id, student_id, status, notes')
        .eq('schedule_id', scheduleId);
    if (error) throw error;
    const map = new Map();
    for (const r of data ?? []) map.set(r.student_id, r);
    return map;
}

// Catatan (ABS-5, audit absensi 2026-07-04): fungsi upsertAttendance dihapus.
// Ia menulis langsung ke tabel attendance tanpa validasi enrolmen (yang hanya
// ada di jalur edge sync-attendance-batch) dan sudah tidak dipakai — semua
// penyimpanan absensi lewat saveAttendanceBatch → edge. Jangan hidupkan kembali
// jalur tulis langsung tanpa validasi siswa-terdaftar setara jalur edge.

// ─── OBSERVASI ───────────────────────────────────────────────

/**
 * Semua siswa di kelas-kelas yang diajar guru ini (untuk selector observasi).
 * Ambil via teaching_assignments aktif periode berjalan.
 */
export async function getMyStudents(userId, academicYear, semester) {
    const { data, error } = await supabase
        .from('teaching_assignments')
        .select('class:classes ( class_id, name, enrollments:class_enrollments ( withdrawn_at, academic_year, semester, student:students ( student_id, nis, full_name, student_status ) ) )')
        .eq('user_id', userId)
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('is_active', true);
    if (error) throw error;

    const seen = new Set();
    const students = [];
    for (const ta of data ?? []) {
        for (const en of ta.class?.enrollments ?? []) {
            const s = en.student;
            if (en.withdrawn_at || s?.student_status !== 'AKTIF') continue;
            if (en.academic_year && en.academic_year !== academicYear) continue;   // A-09: hanya pendaftaran tahun ajaran berjalan
            if (en.semester && semester && String(en.semester) !== String(semester)) continue;   // DG-02: dan semester berjalan
            if (s && !seen.has(s.student_id)) {
                seen.add(s.student_id);
                students.push({ ...s, class_id: ta.class?.class_id, class_name: ta.class?.name });
            }
        }
    }
    return students.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

/**
 * Pencarian siswa sisi-server untuk observer berjangkauan luas
 * (BK / Kaprodi / Waka Kesiswaan / Kepsek) yang mungkin tidak mengajar
 * sehingga getMyStudents (berbasis teaching_assignments) kosong.
 * Cakupan hasil dibatasi RLS sesuai peran pemanggil.
 */
export async function searchStudents(query, schoolId) {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const term = `%${q}%`;
    let req = supabase
        .from('students')
        .select('student_id, nis, full_name, student_status, class_enrollments(classes(name))')
        .or(`full_name.ilike.${term},nis.ilike.${term}`)
        .in('student_status', ['AKTIF', 'PKL'])
        .order('full_name')
        .limit(15);
    if (schoolId) req = req.eq('school_id', schoolId);
    const { data, error } = await req;
    if (error) throw error;
    return (data ?? []).map(s => ({
        ...s,
        class_name: s.class_enrollments?.[0]?.classes?.name ?? '',
    }));
}

// Sengaja tidak di-import dari dashboard.js — api.js
// tidak boleh bergantung pada lapisan UI. Pola sama
// dengan dudi/js/api.js.
function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function jakartaDateStr(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Simpan observasi baru. Offline-capable: antre ke IndexedDB bila jaringan mati.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function insertObservation({ obsId, authorId, studentId, dimension, sentiment, visibility, content }) {
    const observation_id = obsId ?? crypto.randomUUID();
    const payload = {
        idempotency_key: crypto.randomUUID(),
        observation_id,
        author_user_id:  authorId,
        student_id:      studentId,
        dimension,
        sentiment,
        visibility,
        content,
        observed_at:     jakartaDateStr(),   // A-06: tanggal WIB, bukan zona waktu perangkat
    };
    const result = await saveObservation(payload);
    return { ...result, observation_id };
}

// ─── WALI KELAS ──────────────────────────────────────────────

export async function getWaliKelasInfo(classId) {
    if (!classId) return null;
    const { data } = await supabase
        .from('classes')
        .select('class_id, name, grade_level')
        .eq('class_id', classId)
        .maybeSingle();
    return data;
}

/**
 * Rekap kehadiran per siswa di kelas wali kelas (untuk dashboard wali).
 * Returns [{ student_id, full_name, nis, HADIR, ALPA, IZIN, SAKIT, total }]
 * Catatan: EKSKUL dihapus dari absensi → data lama berstatus EKSKUL dihitung HADIR.
 */
export async function getWaliAttendanceSummary(classId, academicYear, dateStart, dateEnd, semester = null) {
    const { data, error } = await supabase.rpc('fn_class_attendance_summary', {
        p_class_id:      classId,
        p_academic_year: academicYear,
        p_date_start:    dateStart || null,
        p_date_end:      dateEnd   || null,
        p_teacher_id:    null,
        p_semester:      semester  || null,
    });
    if (error) throw error;
    return (data ?? []).map(r => ({
        student_id:  r.student_id,
        full_name:   r.full_name,
        nis:         r.nis,
        HADIR:       Number(r.hadir),
        ALPA:        Number(r.alpa),
        IZIN:        Number(r.izin),
        SAKIT:       Number(r.sakit),
        total:       Number(r.total),
    }));
}

export async function getWaliCoachingStudents(classId, academicYear) {
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('student:students ( student_id, nis, full_name, student_status )')
        .eq('class_id', classId)
        .eq('academic_year', academicYear)
        .is('withdrawn_at', null);
    if (error) throw error;
    return (data ?? []).map(r => r.student)
        .filter(s => s && ['AKTIF', 'PKL'].includes(s.student_status));
}

export async function getWaliAttendanceSessions(classId, academicYear, studentId, dateStart, dateEnd) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.rpc('fn_wali_attendance_sessions', {
            p_class_id: classId,
            p_academic_year: academicYear,
            p_student_id: studentId,
            p_date_start: dateStart || null,
            p_date_end: dateEnd || null,
        }).range(offset, offset + pageSize - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
    }
    return rows.map(r => ({
        attendance_id: r.attendance_id, status: r.status, notes: r.notes,
        schedule: {
            session_date: r.session_date, session_start: r.session_start,
            session_end: r.session_end, subject_label: r.subject_label,
            teacher: { full_name: r.teacher_full_name },
        },
    }));
}

// ─── KAPRODI (pindahan dari /kaprodi/) ───────────────────────

export async function getProgram(programId) {
    if (!programId) return null;
    const { data, error } = await supabase.from('programs').select('program_id, code, name').eq('program_id', programId).maybeSingle();
    if (error) throw error;
    return data;
}

export async function getPrograms() {
    const { data, error } = await supabase
        .from('programs')
        .select('program_id, name')
        .eq('is_active', true)
        .order('name');
    if (error) throw error;
    return data ?? [];
}

export async function getStudentAttendanceSessions(studentId, dateStart, dateEnd, teacherId = null, academicYear = null) {
    if (!dateStart || !dateEnd) {
        return [];
    }
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        let q = supabase
            .from('attendance')
            .select(`
                attendance_id, status, is_void, notes,
                schedule:teaching_schedules!inner (
                    schedule_id, block_group_id, session_date, session_start, session_end,
                    subject_label, academic_year,
                    teacher:users ( full_name )
                )
            `)
            .eq('student_id', studentId)
            .eq('is_void', false)
            .gte('teaching_schedules.session_date', dateStart)
            .lte('teaching_schedules.session_date', dateEnd)
            .order('created_at', { ascending: false })
            .order('attendance_id', { ascending: false });
        if (teacherId) q = q.eq('teaching_schedules.scheduled_teacher_id', teacherId);
        if (academicYear) q = q.eq('teaching_schedules.academic_year', academicYear);
        q = q.range(offset, offset + pageSize - 1);
        const { data, error } = await q;
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows
        .filter(r => r.schedule)
        .sort((a, b) => (b.schedule.session_date ?? '').localeCompare(a.schedule.session_date ?? ''));
}

export async function fetchPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id, nis, full_name, student_status,
            placements:pkl_placements (
                placement_id, start_date, end_date, is_active,
                dudi:users!pkl_placements_dudi_user_id_fkey ( user_id, full_name, dudi_org_name )
            )
        `)
        .eq('program_id', programId)
        .eq('student_status', 'PKL')
        .order('full_name');
    if (error) throw error;
    return (data ?? []).map(s => {
        const active = (s.placements ?? []).find(p => p.is_active) ?? null;
        return {
            student_id:   s.student_id, nis: s.nis, full_name: s.full_name,
            placement_id: active?.placement_id ?? null,
            dudi_name:    active?.dudi?.dudi_org_name ?? active?.dudi?.full_name ?? '—',
            start_date:   active?.start_date ?? null, end_date: active?.end_date ?? null,
            has_placement: !!active,
        };
    });
}

export async function fetchNonPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name')
        .eq('program_id', programId)
        .in('student_status', ['AKTIF'])
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

export async function fetchDudiPartners(programId) {
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, dudi_org_name')
        .eq('role_type', 'DUDI')
        .eq('program_id', programId)
        .order('dudi_org_name');
    if (error) throw error;
    return (data ?? []).map(u => ({ user_id: u.user_id, org_name: u.dudi_org_name ?? u.full_name, pic_name: u.full_name }));
}

export async function fetchPklAttendance(studentIds, dateStart, dateEnd) {
    if (!studentIds?.length) return [];
    const { data, error } = await supabase.rpc('fn_pkl_attendance_recap', {
        p_student_ids: studentIds,
        p_date_start:  dateStart || null,
        p_date_end:    dateEnd   || null,
    });
    if (error) throw error;
    return (data ?? []).map(r => ({
        student_id:  r.student_id,
        HADIR:       Number(r.hadir),
        ALPA:        Number(r.alpa),
        IZIN:        Number(r.izin),
        SAKIT:       Number(r.sakit),
        total:       Number(r.total),
    }));
}

export async function fetchDudiObservations(studentIds) {
    if (!studentIds?.length) return [];
    const pageSize = 200;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from('observations')
            .select(`
                observation_id, student_id, sentiment, dimension, content, observed_at, created_at,
                author:users!observations_author_user_id_fkey ( full_name, role_type, dudi_org_name )
            `)
            .in('student_id', studentIds)
            .eq('author.role_type', 'DUDI')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows
        .filter(r => r.author?.role_type === 'DUDI')
        .map(r => ({
            id:         r.observation_id,
            student_id: r.student_id,
            sentiment:  r.sentiment,
            dimension:  r.dimension,
            content:    r.content,
            author:     r.author?.dudi_org_name ?? r.author?.full_name ?? '—',
            date:       r.observed_at ?? r.created_at,
        }));
}

// Semua siswa PKL lintas program (untuk Waka Humas)
export async function fetchAllPklStudents() {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id, nis, full_name, student_status,
            program:programs ( name ),
            placements:pkl_placements (
                placement_id, start_date, end_date, is_active,
                dudi:users!pkl_placements_dudi_user_id_fkey ( user_id, full_name, dudi_org_name )
            )
        `)
        .eq('student_status', 'PKL')
        .order('full_name');
    if (error) throw error;
    return (data ?? []).map(s => {
        const active = (s.placements ?? []).find(p => p.is_active) ?? null;
        return {
            student_id:   s.student_id, nis: s.nis, full_name: s.full_name,
            program_name: s.program?.name ?? '—',
            placement_id: active?.placement_id ?? null,
            dudi_name:    active?.dudi?.dudi_org_name ?? active?.dudi?.full_name ?? '—',
            start_date:   active?.start_date ?? null, end_date: active?.end_date ?? null,
            has_placement: !!active,
        };
    });
}

// Semua mitra DUDI lintas program (untuk Waka Humas)
export async function fetchAllDudiPartners() {
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, dudi_org_name, program_id')
        .eq('role_type', 'DUDI')
        .order('dudi_org_name');
    if (error) throw error;

    const programIds = [...new Set((data ?? []).map(u => u.program_id).filter(Boolean))];
    const programNames = {};
    if (programIds.length) {
        const { data: progs, error: progErr } = await supabase
            .from('programs')
            .select('program_id, name')
            .in('program_id', programIds);
        if (progErr) {
            console.warn('fetchAllDudiPartners: gagal muat nama program, fallback ke —', progErr.message);
        } else {
            for (const p of (progs ?? [])) programNames[p.program_id] = p.name;
        }
    }

    return (data ?? []).map(u => ({
        user_id: u.user_id,
        org_name: u.dudi_org_name ?? u.full_name,
        pic_name: u.full_name,
        program_name: u.program_id ? (programNames[u.program_id] ?? '—') : '—',
    }));
}


export async function createPlacement({ studentId, dudiUserId, startDate, endDate }) {
    const { error } = await supabase.rpc('fn_create_placement', {
        p_student_id:   studentId,
        p_dudi_user_id: dudiUserId,
        p_start_date:   startDate,
        p_end_date:     endDate,
    });
    if (error) throw error;
}

export async function finishPlacement(studentId, placementId) {
    const { error } = await supabase.rpc('fn_finish_placement', {
        p_student_id:   studentId,
        p_placement_id: placementId,
    });
    if (error) throw error;
}

export async function bulkImportPkl(csvText) {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;
    if (!token) throw new Error('Sesi tidak valid. Silakan login ulang.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/bulk-import-pkl`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/csv' },
        body: csvText,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return json.data;
}

// ─── KEPSEK / WAKA ──────────────────────────────────────────

export async function getSchoolStats(academicYear, semester) {
    const today = localDateStr();
    const [studentsRes, staffRes, schedToday, attToday] = await Promise.all([
        supabase.from('students').select('student_id', { count: 'exact', head: true }).eq('student_status', 'AKTIF'),
        supabase.from('v_users_staff_directory').select('user_id', { count: 'exact', head: true }).not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")').is('deleted_at', null),
        supabase.from('teaching_schedules').select('schedule_id, class_id', { count: 'exact' }).eq('session_date', today).eq('academic_year', academicYear),
        supabase.from('attendance').select('status', { count: 'exact' }).gte('created_at', today + 'T00:00:00').eq('status', 'HADIR'),
    ]);
    return {
        total_siswa:       studentsRes.count ?? 0,
        total_staf:        staffRes.count ?? 0,
        sesi_hari_ini:     schedToday.count ?? 0,
        kehadiran_hari_ini: attToday.count ?? 0,
    };
}

/** Ringkasan sekolah (siswa, staf, kelas, sesi hari ini) — fungsi sama dengan stakeholder. */
export async function getSchoolSummary() {
    const { data, error } = await supabase.rpc('fn_stakeholder_summary');
    if (error) throw error;
    return data ?? {};
}

/** Ringkasan agregat pembinaan siswa untuk dashboard Kepala Sekolah (hanya angka; migrasi 20261018180000). */
export async function getKepsekCaseSummary() {
    const { data, error } = await supabase.rpc('fn_kepsek_case_summary');
    if (error) throw error;
    return data;
}

export async function getKepsekMonitoring(period = 'hari_ini', academicYear = null, dateStart = null, dateEnd = null) {
    const { data, error } = await supabase.rpc('fn_kepsek_monitoring', {
        p_period:        period,
        p_academic_year: academicYear,
        p_date_start:    dateStart,
        p_date_end:      dateEnd,
    });
    if (error) throw error;
    return data;
}

export async function getAttendanceFillRate(dateStart, dateEnd) {
    const { data, error } = await supabase.rpc('fn_attendance_fill_rate', {
        p_date_start: dateStart ?? null,
        p_date_end:   dateEnd   ?? null,
    });
    if (error) throw error;
    const rows   = data ?? [];
    const get    = key => Number(rows.find(r => r.teacher_indicator === key)?.jumlah ?? 0);
    const hadir  = get('HADIR');
    const pending = get('PENDING_EVALUATION');
    const tidak  = get('TIDAK_HADIR');
    return { total: hadir + pending + tidak, hadir, pending, tidak };
}

export async function getWakaKurStats(dateStart, dateEnd) {
    const { data, error } = await supabase.rpc('fn_waka_kur_stats', {
        p_date_start: dateStart ?? null,
        p_date_end:   dateEnd   ?? null,
    });
    if (error) throw error;
    const r = data?.[0] ?? {};
    return {
        guru_hadir: Number(r.guru_hadir ?? 0),
        guru_total: Number(r.guru_total ?? 0),
        guru_belum: Number(r.guru_belum ?? 0),
        pct_hadir:  r.pct_hadir != null ? Number(r.pct_hadir) : null,
    };
}

// Panel 1 tabel "Sesi Belum Diisi Hari Ini" — via RPC SECURITY DEFINER untuk
// tenant isolation (RLS waka hanya cek role, tidak filter school_id).
// Hasil di-map ke shape {teacher,subject,class} agar loadWkKur1 tidak perlu diubah.
export async function getPendingAttendanceSessions(date) {
    const { data, error } = await supabase.rpc('fn_pending_attendance_sessions', {
        p_date: date ?? null,
    });
    if (error) throw error;
    return (data ?? []).map(r => ({
        session_start: r.session_start,
        session_end:   r.session_end,
        teacher_id:    r.teacher_id,
        teacher: { full_name: r.teacher_name },
        subject: { name: r.subject_name },
        class:   { name: r.class_name },
    }));
}

export async function getPendingSessionsByTeacher(dateStart, dateEnd) {
    const { data, error } = await supabase.rpc('fn_pending_sessions_by_teacher', {
        p_date_start: dateStart ?? null,
        p_date_end:   dateEnd   ?? null,
    });
    if (error) throw error;
    return data ?? [];
}

export async function getPendingSessionsDetail(teacherId, dateStart, dateEnd) {
    const { data, error } = await supabase.rpc('fn_pending_sessions_detail', {
        p_teacher_id: teacherId,
        p_date_start: dateStart ?? null,
        p_date_end:   dateEnd   ?? null,
    });
    if (error) throw error;
    return data ?? [];
}

// ─── WAKA KESISWAAN ─────────────────────────────────────────

export async function getAttendanceRecapPerClass(dateStart, dateEnd) {
    const { data, error } = await supabase.rpc('fn_attendance_recap_per_class', {
        p_date_start: dateStart ?? null,
        p_date_end:   dateEnd   ?? null,
    });
    if (error) throw error;
    return (data ?? []).map(r => ({
        class_id:    r.class_id,
        name:        r.name,
        HADIR:       Number(r.hadir),
        ALPA:        Number(r.alpa),
        IZIN:        Number(r.izin),
        SAKIT:       Number(r.sakit),
        total:       Number(r.total),
    }));
}

/**
 * Rekap akumulasi kehadiran kelas (tabel attendance) untuk daftar student_id tertentu.
 * Dipakai Kaprodi untuk siswa AKTIF di programnya.
 */
export async function getClassStudents(classId) {
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('student:students ( student_id, nis, full_name, student_status )')
        .eq('class_id', classId)
        .is('withdrawn_at', null);
    if (error) throw error;
    return (data ?? [])
        .map(r => r.student)
        .filter(s => s && s.student_status === 'AKTIF')
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

export async function getAttendanceSummaryByStudents(classId, academicYear, dateStart, dateEnd, teacherId = null) {
    const { data, error } = await supabase.rpc('fn_class_attendance_summary', {
        p_class_id:      classId,
        p_academic_year: academicYear,
        p_date_start:    dateStart ?? null,
        p_date_end:      dateEnd   ?? null,
        p_teacher_id:    teacherId ?? null,
    });
    if (error) throw error;
    return (data ?? []).map(r => ({
        student_id:  r.student_id,
        full_name:   r.full_name,
        nis:         r.nis,
        HADIR:       Number(r.hadir),
        ALPA:        Number(r.alpa),
        IZIN:        Number(r.izin),
        SAKIT:       Number(r.sakit),
        total:       Number(r.total),
    }));
}

/**
 * Detail kehadiran per siswa per pertemuan untuk satu kelas — untuk export Excel pivot.
 * Mengembalikan { student_id, block_group_id, session_date, status } per baris.
 * Satu pertemuan (block_group_id) = satu satuan kehadiran; bisa ada beberapa pertemuan per tanggal.
 */
/**
 * Semua sesi terjadwal × semua siswa untuk satu kelas — untuk Excel wali kelas.
 * status = null  → sesi belum diinput guru (tampil "—" di Excel).
 * status = text  → status terburuk; 'HADIR' jika sesi diinput tapi siswa tidak tercatat.
 */
export async function getClassScheduleFull(classId, academicYear, dateStart, dateEnd) {
    const all = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
            .rpc('fn_class_schedule_full', {
                p_class_id:      classId,
                p_academic_year: academicYear,
                p_date_start:    dateStart ?? null,
                p_date_end:      dateEnd   ?? null,
            })
            .range(offset, offset + pageSize - 1);
        if (error) throw error;
        all.push(...(data ?? []));
        if ((data ?? []).length < pageSize) break;
    }
    return all.map(r => ({
        block_group_id: r.block_group_id,
        session_date:   r.session_date,
        subject_label:  r.subject_label ?? '',
        teacher_name:   r.teacher_name  ?? '',
        student_id:     r.student_id,
        status:         r.status ?? null,   // null = belum diinput
    }));
}

export async function getClassAttendanceByDate(classId, academicYear, dateStart, dateEnd, teacherId = null) {
    // Pakai SECURITY DEFINER agar semua peran (Waka, BK, Wali, Kaprodi)
    // bisa melihat semua pertemuan di kelas, bukan hanya yang mereka ajar.
    // teacherId diisi hanya oleh tab guru — menyaring ke sesi milik guru itu saja.
    const all = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
            .rpc('fn_class_attendance_detail', {
                p_class_id:      classId,
                p_academic_year: academicYear,
                p_date_start:    dateStart  ?? null,
                p_date_end:      dateEnd    ?? null,
                p_teacher_id:    teacherId  ?? null,
            })
            .range(offset, offset + pageSize - 1);
        if (error) throw error;
        all.push(...(data ?? []));
        if ((data ?? []).length < pageSize) break;
    }
    return all.map(r => ({
        student_id:     r.student_id,
        block_group_id: r.block_group_id,
        session_date:   r.session_date,
        status:         r.status,
        subject_label:  r.subject_label ?? '',
    }));
}

export async function getOpenCases(schoolId, track = null) {
    let q = supabase
        .from('coaching_cases')
        .select('case_id, title, status, track, current_handler_user_id, created_at, student:students(full_name, nis), handler:users!coaching_cases_current_handler_user_id_fkey(full_name)')
        .neq('status', 'CLOSED')
        .order('created_at', { ascending: false });
    if (schoolId) q = q.eq('school_id', schoolId);
    if (track)    q = q.eq('track', track);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
}

// ─── JURNAL MENGAJAR ─────────────────────────────────────────

export async function getJournalEntries(userId) {
    const { data, error } = await supabase
        .from('teacher_journals')
        .select('journal_id, entry_date, content, created_at')
        .eq('owner_user_id', userId)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) throw error;
    return data ?? [];
}

/**
 * Simpan entri jurnal baru. Offline-capable: antre ke IndexedDB bila jaringan mati.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function insertJournalEntry(userId, entryDate, content) {
    const payload = {
        idempotency_key: crypto.randomUUID(),
        journal_id:      crypto.randomUUID(),
        owner_user_id:   userId,
        entry_date:      entryDate,
        content,
    };
    const r = await saveJournalEntry(payload);
    return { ...r, journal_id: payload.journal_id };
}

export async function deleteJournalEntry(journalId) {
    return deleteJournalEntryOffline(journalId);
}

export async function updateJournalEntry(journalId, entryDate, content, userId) {
    // Reuse saveJournalEntry (fn_sync_journal adalah UPSERT by journal_id).
    // Dengan begitu edit jurnal ikut jalur offline-capable yang sama dengan insert.
    return saveJournalEntry({
        idempotency_key: crypto.randomUUID(),
        journal_id:      journalId,
        owner_user_id:   userId,
        entry_date:      entryDate,
        content,
    });
}

/** Penulis membatalkan catatannya sendiri (disembunyikan dari siswa/orang tua, tidak dihapus). Alasan minimal 5 karakter. */
export async function voidObservation(observationId, reason) {
    const { data, error } = await supabase.rpc('fn_void_observation', { p_observation_id: observationId, p_reason: reason });
    if (error) throw error;
    return data;
}

export async function getMyObservations(userId, { limit = 100, offset = 0 } = {}) {
    const { data, error, count } = await supabase
        .from('observations')
        .select(`
            observation_id, dimension, sentiment, visibility, content, observed_at, created_at,
            student_id, author_user_id, is_void, void_reason, voided_by,
            student:students!observations_student_id_fkey ( full_name, nis )
        `, { count: 'exact' })
        .eq('author_user_id', userId)
        .order('created_at', { ascending: false })
        .order('observation_id', { ascending: false })   // A-08: pemecah seri agar halaman tidak melewatkan/menggandakan baris
        .range(offset, offset + limit - 1);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
}

export async function getStudentUserId(studentId) {
    const { data } = await supabase
        .from('students')
        .select('student_id, user_id')
        .eq('student_id', studentId)
        .maybeSingle();
    return data?.user_id ?? null;
}

export async function getStudentParents(studentId) {
    const { data, error } = await supabase
        .from('student_parents')
        .select('parent_user_id, users:parent_user_id(full_name)')
        .eq('student_id', studentId);
    if (error) throw error;
    return data ?? [];
}


// ─── KASUS ───────────────────────────────────────────────────

// Diganti oleh getUnreadNotifCount — tetap diekspor untuk kompatibilitas sementara
export async function countNewCoachingCases(handlerUserId, since) {
    const { count, error } = await supabase
        .from('coaching_cases')
        .select('case_id', { count: 'exact', head: true })
        .eq('current_handler_user_id', handlerUserId)
        .gt('updated_at', since)
        .neq('status', 'CLOSED');
    if (error) throw error;
    return count ?? 0;
}

export async function getUnreadNotifCount() {
    const { data, error } = await supabase.rpc('fn_count_unread_notifications');
    if (error) throw error;
    return Number(data ?? 0);
}

export async function getRecentNotifications(limit = 20) {
    const { data, error } = await supabase
        .from('notifications')
        .select('notification_id, type, title, body, is_read, case_id, forum_post_id, late_arrival_id, created_at')
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data ?? [];
}

export async function markNotificationsRead(ids) {
    if (!ids?.length) return;
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('notification_id', ids);
    if (error) throw error;
}

/**
 * Daftar kasus pembinaan.
 * @param {string}   status          filter satu status persis (paling spesifik, menang atas statusNotClosed)
 * @param {string}   track           SEKOLAH | PKL
 * @param {string[]} studentIds      batasi ke siswa tertentu (wali kelas / kaprodi).
 *                                   Array kosong = tidak ada kasus (fail closed).
 * @param {boolean}  statusNotClosed hanya kasus aktif (kepsek). Diabaikan jika `status` diisi.
 */
export async function getCases({
    status = '',
    track = '',
    studentIds = null,
    statusNotClosed = false,
    allRows = false,
    offset = 0,
    limit = 51
} = {}) {
    if (Array.isArray(studentIds) && studentIds.length === 0) return [];
    let req = supabase
        .from('coaching_cases')
        .select(`
            case_id, title, status, track, current_handler_user_id, created_by_user_id,
            created_at,
            student:students(student_id, full_name, nis),
            handler:users!coaching_cases_current_handler_user_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false });
    if (!allRows) {
        req = req.range(offset, offset + limit - 1);
    }
    if (status) {
        req = req.eq('status', status);
    } else if (statusNotClosed) {
        req = req.neq('status', 'CLOSED');
    }
    if (studentIds && studentIds.length > 0) req = req.in('student_id', studentIds);
    if (track)  req = req.eq('track', track);
    const { data, error } = await req;
    if (error) throw error;
    return data ?? [];
}

/**
 * Ambil SEMUA kasus tanpa ceiling — pagination otomatis per PAGE_SIZE.
 * Cocok untuk generate rekap. Jangan pakai untuk tampilan UI (gunakan getCases).
 */
export async function getCasesAll(params = {}) {
    const PAGE_SIZE = 1000;
    let offset = 0;
    let allCases = [];
    while (true) {
        const page = await getCases({ ...params, offset, limit: PAGE_SIZE });
        allCases = allCases.concat(page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    return allCases;
}

/**
 * Jumlah kasus per status — untuk rekap ringkas tab Waka Kesiswaan.
 * Scope tenant mengandalkan RLS `coaching_cases`, sama seperti getCases().
 * @returns {Promise<Object>} { OPEN: n, UNDER_REVIEW: n, INTERVENTION: n, MONITORING: n, CLOSED: n }
 */
export async function getCoachingCasesCount() {
    const statuses = ['OPEN', 'UNDER_REVIEW', 'INTERVENTION', 'MONITORING', 'CLOSED'];
    const results = await Promise.all(
        statuses.map(async s => {
            const { count, error } = await supabase
                .from('coaching_cases')
                .select('case_id', { count: 'exact', head: true })
                .eq('status', s);
            if (error) throw error;
            return { status: s, count: count ?? 0 };
        })
    );
    return Object.fromEntries(results.map(r => [r.status, r.count]));
}

export async function getCase(caseId) {
    const { data, error } = await supabase
        .from('coaching_cases')
        .select(`
            case_id, title, description, status, track, current_handler_user_id,
            created_at, closed_at, closed_by_user_id, created_by_user_id,
            is_shared_to_student, is_shared_to_parent,
            student:students(student_id, user_id, full_name, nis),
            created_by:users!coaching_cases_created_by_user_id_fkey(full_name),
            handler:users!coaching_cases_current_handler_user_id_fkey(full_name)
        `)
        .eq('case_id', caseId)
        .single();
    if (error) throw error;
    return data;
}

// ── Pembaca kasus (penonton) — migrasi 20261017040000 ──
export async function listCaseViewers(caseId) {
    const { data, error } = await supabase.rpc('fn_case_list_viewers', { p_case_id: caseId });
    if (error) throw error;
    return data ?? [];
}
export async function getCaseTagCandidates(caseId) {
    const { data, error } = await supabase.rpc('fn_case_tag_candidates', { p_case_id: caseId });
    if (error) throw error;
    return data ?? [];
}
export async function addCaseViewer(caseId, userId) {
    const { data, error } = await supabase.rpc('fn_case_add_viewer', { p_case_id: caseId, p_user_id: userId });
    if (error) throw error;
    return data;
}
export async function removeCaseViewer(caseId, userId) {
    const { data, error } = await supabase.rpc('fn_case_remove_viewer', { p_case_id: caseId, p_user_id: userId });
    if (error) throw error;
    return data;
}
export async function logCaseOversightView(caseId) {
    const { error } = await supabase.rpc('fn_case_log_oversight_view', { p_case_id: caseId });
    if (error) throw error;
}
export async function listCaseAccessLog(caseId) {
    const { data, error } = await supabase.rpc('fn_case_list_access_log', { p_case_id: caseId });
    if (error) throw error;
    return data ?? [];
}

export async function getEscalationCandidates(caseId) {
    const { data, error } = await supabase.rpc('fn_get_escalation_candidates', {
        p_case_id: caseId,
    });
    if (error) throw error;
    return data ?? [];
}

export async function getCoachingCaseEvents(caseId) {
    const { data, error } = await supabase
        .from('coaching_case_events')
        .select(`
            event_id, event_type, is_visible_to_student,
            payload, created_at,
            author:users!coaching_case_events_author_user_id_fkey(full_name)
        `)
        .eq('case_id', caseId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

export async function createCase({ studentId, studentName = null, title, description, track, audience = 'PRIVATE', authorUserId, authorRole }) {
    const payload = {
        idempotency_key:    crypto.randomUUID(),
        case_id:            crypto.randomUUID(),
        student_id:         studentId,
        created_by_user_id: authorUserId,
        initiated_by_role:  authorRole,
        track,
        title,
        description,
        audience,
        // Hanya untuk tampilan antrean luring di perangkat (server mengabaikan kunci berawalan garis bawah).
        _nama_siswa:        studentName,
    };
    const r = await saveCase(payload);
    if (r.status === 'error') throw new Error(r.error);
    return { case_id: payload.case_id, _queued: r.status === 'queued' };
}

// coaching_case_events.school_id NOT NULL tanpa DEFAULT, dan tidak ada trigger
// yang mengisinya (mig 20260802020000 + 20260802030000). RLS rls_cce_insert
// hanya memvalidasi school_id = fn_current_school_id(), tidak mengisi.
// Karena itu setiap fungsi di bawah wajib menerima schoolId dari pemanggil.

export async function shareCoachingCaseToStudent(caseId, authorUserId, schoolId) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'SHARED_TO_STUDENT',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            payload:               {},
        });
    if (error) throw error;
}

export async function unshareCoachingCaseFromStudent(caseId, authorUserId, schoolId) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'UNSHARED_FROM_STUDENT',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            payload:               {},
        });
    if (error) throw error;
}

export async function shareCoachingCaseToParent(caseId, authorUserId, schoolId) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'SHARED_TO_PARENT',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            payload:               {},
        });
    if (error) throw error;
}

export async function unshareCoachingCaseFromParent(caseId, authorUserId, schoolId) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'UNSHARED_FROM_PARENT',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            payload:               {},
        });
    if (error) throw error;
}

export async function getCaseAudienceMembers(caseId) {
    const { data, error } = await supabase
        .from('case_audience_members')
        .select('user_id, users:user_id(full_name, role_type)')
        .eq('case_id', caseId);
    if (error) throw error;
    return data ?? [];
}

export async function addCaseAudienceMember({ caseId, userId, schoolId, addedByUserId }) {
    const { error } = await supabase
        .from('case_audience_members')
        .insert({ case_id: caseId, user_id: userId, school_id: schoolId, added_by_user_id: addedByUserId });
    if (error) throw error;
}

export async function removeCaseAudienceMember({ caseId, userId }) {
    const { error } = await supabase
        .from('case_audience_members')
        .delete()
        .eq('case_id', caseId)
        .eq('user_id', userId);
    if (error) throw error;
}

export async function searchInternalUsers(query) {
    const INTERNAL_ROLES = ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKA_HUMAS','WAKASEK'];   // Kepsek dikeluarkan dari Pembinaan Siswa (18 Okt 2026)
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, role_type')
        .in('role_type', INTERNAL_ROLES)
        .ilike('full_name', `%${query}%`)
        .eq('is_active', true)
        .limit(10);
    if (error) throw error;
    return data ?? [];
}

export async function addCoachingNote({ caseId, text, authorUserId, schoolId, isVisibleToStudent = false }) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'NOTE_ADDED',
            author_user_id:        authorUserId,
            is_visible_to_student: isVisibleToStudent,
            payload:               { text },
        });
    if (error) throw error;
}

export async function escalateCoachingCase({ caseId, newHandlerUserId, note, authorUserId, schoolId }) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'ESCALATED',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            payload:               {
                new_handler_user_id: newHandlerUserId,
                note:                note ?? '',
            },
        });
    if (error) throw error;
}

export async function changeCoachingCaseStatus({ caseId, previousStatus, newStatus, note, authorUserId, schoolId }) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'STATUS_CHANGED',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            // previous_status/new_status tidak ada sebagai kolom di coaching_case_events —
            // riwayat status hidup di payload JSONB (lihat mig 20260802020000).
            payload:               note ? { old_status: previousStatus, new_status: newStatus, note } : { old_status: previousStatus, new_status: newStatus },
        });
    if (error) throw error;
}

export async function closeCoachingCase({ caseId, note, authorUserId, previousStatus, schoolId }) {
    const { error } = await supabase
        .from('coaching_case_events')
        .insert({
            case_id:               caseId,
            school_id:             schoolId,
            event_type:            'CLOSED',
            author_user_id:        authorUserId,
            is_visible_to_student: false,
            // Sama seperti STATUS_CHANGED: kolom previous_status/new_status tidak ada,
            // status lama & baru ikut di payload agar timeline bisa menampilkannya.
            payload:               {
                old_status: previousStatus ?? null,
                new_status: 'CLOSED',
                ...(note ? { summary: note } : {}),
            },
        });
    if (error) throw error;
}


// ─── KELOLA ADMIN (kepsek only) ───────────────────────────────

export async function listSchoolAdmins() {
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, login_identifier')
        .eq('role_type', 'ADMINISTRATIVE')
        .eq('is_active', true)
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

async function _callManageAdmin(method, body) {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-admin-account`, {
        method,
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? 'Permintaan gagal');
    return json.data;
}

export async function addSchoolAdmin({ full_name, login_identifier, identifier_type }) {
    return _callManageAdmin('POST', { full_name, login_identifier, identifier_type });
}

export async function removeSchoolAdmin(user_id) {
    return _callManageAdmin('DELETE', { user_id });
}

// ─── Forum Sekolah ────────────────────────────────────────────

/**
 * Ambil kandidat penerima berdasarkan target group dan filter.
 * Memanggil fn_get_forum_recipient_candidates.
 */
export async function getForumRecipientCandidates(
    targetGroup, { programId = null, classId = null, dayOfWeek = null, academicYear = null } = {}
) {
    const { data, error } = await supabase.rpc('fn_get_forum_recipient_candidates', {
        p_target_group:  targetGroup,
        p_program_id:    programId,
        p_class_id:      classId,
        p_day_of_week:   dayOfWeek,
        p_academic_year: academicYear,
    });
    if (error) throw error;
    return data ?? [];
}

// Audit Forum A-10: halaman berikutnya = posting yang LEBIH LAMA daripada kursor (tanggal, lalu post_id sebagai pembeda). Berbeda dengan offset,
// daftar tidak bergeser bila ada posting baru masuk di antara dua permintaan dan tidak ragu-ragu pada posting berwaktu sama.
// after = { created_at, post_id } milik posting terakhir yang sudah tampil (created_at dipakai apa adanya sebagai teks, jangan diubah ke Date: presisi mikrodetik).
function sesudahKursorForum(q, after) {
    if (!after) return q;
    return q.or(`created_at.lt."${after.created_at}",and(created_at.eq."${after.created_at}",post_id.lt.${after.post_id})`);
}
/**
 * Ambil posting Forum Sekolah untuk inbox caller.
 * Filter: scope_type='SEKOLAH', caller ada di forum_post_audience.
 * after: kursor halaman berikutnya ({ created_at, post_id } posting terakhir yang tampil); null = halaman pertama.
 */
export async function getForumSekolahPosts(schoolId, callerId, limit = 20, after = null) {
    const q = supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, attachment_url, attachment_name, attachment_path,
            is_edited, is_withdrawn, edited_at, deleted_at, created_at, updated_at,
            author_user_id,
            author:users!forum_posts_author_user_id_fkey(user_id, full_name, role_type),
            comments:forum_post_comments(comment_id),
            acknowledgements:forum_post_acknowledgements(user_id),
            audience:forum_post_audience!inner(user_id)
        `)
        .eq('scope_type', 'SEKOLAH')
        .eq('school_id', schoolId)
        .is('deleted_at', null)
        .eq('forum_post_audience.user_id', callerId);
    const { data, error } = await sesudahKursorForum(q, after)
        .order('created_at', { ascending: false })
        .order('post_id', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return (data ?? []).map(({ audience: _a, ...rest }) => rest);
}

/**
 * Ambil satu posting masuk berdasarkan post_id (untuk openForumDetail).
 */
export async function getForumSekolahPostById(postId, schoolId, callerId) {
    const { data, error } = await supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, attachment_url, attachment_name, attachment_path,
            is_edited, is_withdrawn, edited_at, deleted_at, created_at, updated_at,
            author_user_id,
            author:users!forum_posts_author_user_id_fkey(user_id, full_name, role_type),
            comments:forum_post_comments(comment_id),
            acknowledgements:forum_post_acknowledgements(user_id),
            audience:forum_post_audience!inner(user_id)
        `)
        .eq('post_id', postId)
        .eq('scope_type', 'SEKOLAH')
        .eq('school_id', schoolId)
        .is('deleted_at', null)
        .eq('forum_post_audience.user_id', callerId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Posting tidak ditemukan');
    const { audience: _a, ...rest } = data;
    return rest;
}

/**
 * Ambil satu posting terkirim berdasarkan post_id (untuk openForumDetail tab Terkirim).
 */
export async function getForumSekolahSentPostById(postId, schoolId, callerId) {
    const { data, error } = await supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, attachment_url, attachment_name, attachment_path,
            is_edited, is_withdrawn, edited_at, deleted_at, created_at, updated_at,
            author_user_id,
            author:users!forum_posts_author_user_id_fkey(user_id, full_name, role_type),
            comments:forum_post_comments(comment_id),
            acknowledgements:forum_post_acknowledgements(user_id),
            audience:forum_post_audience(user_id)
        `)
        .eq('post_id', postId)
        .eq('scope_type', 'SEKOLAH')
        .eq('school_id', schoolId)
        .eq('author_user_id', callerId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Posting tidak ditemukan');
    return data;
}

/**
 * Ambil posting yang dibuat oleh caller (tab Terkirim). after: lihat getForumSekolahPosts.
 */
export async function getForumSekolahSentPosts(schoolId, callerId, limit = 20, after = null) {
    const q = supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, attachment_url, attachment_name, attachment_path,
            is_edited, is_withdrawn, edited_at, deleted_at, created_at, updated_at,
            author_user_id,
            author:users!forum_posts_author_user_id_fkey(user_id, full_name, role_type),
            comments:forum_post_comments(comment_id),
            acknowledgements:forum_post_acknowledgements(user_id),
            audience:forum_post_audience(user_id)
        `)
        .eq('scope_type', 'SEKOLAH')
        .eq('school_id', schoolId)
        .eq('author_user_id', callerId)
        .is('deleted_at', null);
    const { data, error } = await sesudahKursorForum(q, after)
        .order('created_at', { ascending: false })
        .order('post_id', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data ?? [];
}

/**
 * Ambil komentar untuk satu posting.
 */
export async function getForumSekolahComments(postId) {
    const { data, error } = await supabase
        .from('forum_post_comments')
        .select(`
            comment_id, body, created_at, updated_at,
            author_user_id,
            author:users!forum_post_comments_author_user_id_fkey(user_id, full_name, role_type)
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .limit(100);
    if (error) throw error;
    return data ?? [];
}

/**
 * Buat posting Forum Sekolah baru.
 * recipientUserIds: array user_id yang sudah di-resolve di sisi client.
 *
 * FUNC-01: lampiran TIDAK lagi dipasang di sini. Versi lama memanggil
 * .update() tanpa memeriksa `error`, sehingga kegagalan pemasangan
 * lampiran hilang diam-diam dan file di storage jadi orphan permanen.
 * Pemasangan lampiran sekarang lewat setForumAttachment() yang melempar,
 * supaya pemanggil bisa membersihkan file yang terlanjur ter-upload.
 *
 * FUNC-03: idempotencyKey (UUID dari klien) membuat retry/double-click
 * mengembalikan posting yang sama, bukan duplikat.
 */
export async function createForumSekolahPost(
    title, body, recipientUserIds, academicYear, idempotencyKey = null
) {
    const { data, error } = await supabase.rpc('fn_create_forum_post', {
        p_class_id:            null,
        p_academic_year:       academicYear,
        p_content:             body,
        p_category_code:       null,
        p_subject_student_ids: [],
        p_audience_type:       'ORANG_TERTENTU',
        p_specific_user_ids:   recipientUserIds,
        p_audience_type_2:     null,
        p_specific_user_ids_2: [],
        p_scope_type:          'SEKOLAH',
        p_title:               title,
        p_idempotency_key:     idempotencyKey,
    });
    if (error) throw error;
    return data;
}

/**
 * FUNC-01: pasang lampiran ke post_id yang pasti — dipakai jalur buat
 * maupun jalur edit. Error sengaja dilempar supaya pemanggil bisa
 * membersihkan file yang terlanjur ter-upload (rollback orphan).
 */
export async function setForumAttachment(postId, url, name, path) {
    const { error } = await supabase
        .from('forum_posts')
        .update({ attachment_url: url, attachment_name: name, attachment_path: path })
        .eq('post_id', postId);
    if (error) throw error;
}

/**
 * Edit posting (hanya author).
 */
export async function updateForumSekolahPost(postId, newTitle, newBody) {
    const { error } = await supabase
        .from('forum_posts')
        .update({
            title:      newTitle,
            body:       newBody,
            is_edited:  true,
            edited_at:  new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('post_id', postId);
    if (error) throw error;
}

// FORUM-DEL-01: toggleForumPostWithdrawn dihapus. Fitur "tarik posting"
// digantikan hard delete permanen lewat deleteForumSekolahPost().

/**
 * FORUM-DEL-01: hapus posting PERMANEN (hard delete).
 * Menggantikan soft delete + fitur "tarik posting" yang lama.
 *
 * Otorisasi dan pembersihan dilakukan di dalam RPC: penulis atau
 * moderator; notifications dibersihkan di sana (FK-nya SET NULL, jadi
 * tidak ikut CASCADE); audience/komentar/tanda-dibaca ikut terhapus
 * lewat ON DELETE CASCADE. RPC mengembalikan attachment_path supaya
 * file di storage bisa ikut dibuang -- sesudah baris hilang, path itu
 * tidak bisa ditemukan lagi oleh siapa pun.
 */
export async function deleteForumSekolahPost(postId) {
    const { data, error } = await supabase.rpc('fn_delete_forum_post', {
        p_post_id: postId,
    });
    if (error) throw error;
    const path = data?.[0]?.attachment_path ?? null;
    let attachmentCleanupError = null;
    if (path) {
        const { error: storageError } = await supabase.storage
            .from('forum-attachments')
            .remove([path]);
        if (storageError) {
            attachmentCleanupError = storageError;
            console.warn('[forum] hapus storage gagal:', storageError);
        }
    }
    return { attachmentCleanupError };
}

/**
 * Tambah komentar ke posting.
 */
// author_user_id WAJIB dikirim: kolomnya NOT NULL tanpa nilai bawaan dan kebijakan RLS menuntut author_user_id = pengguna login.
// Sebelumnya tidak dikirim, sehingga setiap komentar dari portal guru ditolak ("Tidak memiliki izin").
export async function addForumSekolahComment(postId, body, schoolId, authorUserId) {
    if (!authorUserId) throw new Error('author_user_id wajib diisi.');
    const { error } = await supabase
        .from('forum_post_comments')
        .insert({ post_id: postId, body, school_id: schoolId, author_user_id: authorUserId });
    if (error) throw error;
}

/**
 * Hapus komentar (hanya author komentar).
 */
export async function deleteForumSekolahComment(commentId) {
    const { error } = await supabase
        .from('forum_post_comments')
        .delete()
        .eq('comment_id', commentId);
    if (error) throw error;
}

/**
 * Tandai posting sudah dibaca (upsert).
 */
export async function addForumSekolahAcknowledgement(postId, userId, schoolId) {
    const { error } = await supabase
        .from('forum_post_acknowledgements')
        .upsert({ post_id: postId, user_id: userId, school_id: schoolId },
                 { ignoreDuplicates: true });
    if (error) throw error;
}

// ─── GURU PIKET ──────────────────────────────────────────────

export async function isOnDutyToday() {
    try {
        const { data, error } = await supabase.rpc('fn_is_on_duty_today');
        if (error) throw error;
        return !!data;
    } catch (e) {
        console.warn('[piket] isOnDutyToday exception:', e);
        return null;
    }
}

export async function getTodayLateArrivals() {
    try {
        const today = jakartaDateStr();
        const { data, error } = await supabase
            .from('late_arrivals')
            .select(`
                late_id, arrival_time, reason, late_date, recorded_by,
                student:students ( student_id, full_name,
                    class_enrollments ( classes ( name ) )
                ),
                recorder:users!late_arrivals_recorded_by_fkey ( full_name )
            `)
            .eq('late_date', today)
            .order('arrival_time', { ascending: true });
        if (error) throw error;
        return (data ?? []).map(r => ({
            late_id:      r.late_id,
            arrival_time: r.arrival_time,
            reason:       r.reason ?? '',
            late_date:    r.late_date,
            recorded_by:  r.recorded_by,
            student_name: r.student?.full_name ?? '—',
            class_name:   r.student?.class_enrollments?.[0]?.classes?.name ?? '—',
            recorder_name: r.recorder?.full_name ?? '—',
        }));
    } catch (e) {
        console.warn('[piket] getTodayLateArrivals exception:', e);
        throw e;
    }
}

export async function recordLateArrival(studentId, arrivalTime, reason, schoolId) {
    const today = jakartaDateStr();
    const userRow = await getCurrentUserRow();
    if (!userRow) throw new Error('Sesi tidak valid. Silakan login ulang.');
    const payload = {
        student_id:  studentId,
        arrival_time: arrivalTime,
        reason:      reason ?? null,
        late_date:   today,
        recorded_by: userRow.user_id,
        school_id:   schoolId,
    };
    const { error } = await supabase.from('late_arrivals').insert(payload);
    if (error) throw error;
    return { success: true };
}

export async function deleteLateArrival(lateId) {
    const { error } = await supabase
        .from('late_arrivals')
        .delete()
        .eq('late_id', lateId);
    if (error) throw error;
}

export async function getTodayExits() {
    try {
        const today = jakartaDateStr();
        const { data, error } = await supabase
            .from('student_exits')
            .select(`
                exit_id, exit_time, return_time, reason, exit_date,
                student:students(student_id, full_name, nis,
                    class_enrollment:class_enrollments(class:classes(name))),
                recorder:users!student_exits_recorded_by_fkey(full_name, user_id)
            `)
            .eq('exit_date', today)
            .order('exit_time', { ascending: true });
        if (error) throw error;
        return (data ?? []).map(r => {
            const enrollment = r.student?.class_enrollment ?? [];
            const latest = enrollment[enrollment.length - 1];
            return {
                exit_id:      r.exit_id,
                exit_time:    r.exit_time,
                return_time:  r.return_time,
                reason:       r.reason ?? '',
                student_name: r.student?.full_name ?? '—',
                nis:          r.student?.nis ?? '—',
                class_name:   latest?.class?.name ?? '—',
                recorder:     r.recorder?.full_name ?? '—',
                recorder_id:  r.recorder?.user_id ?? null,
            };
        });
    } catch (e) { console.warn('[piket] getTodayExits exception:', e); throw e; }
}

export async function recordExit(studentId, exitTime, reason, schoolId, recordedBy) {
    const today = jakartaDateStr();
    const { data, error } = await supabase
        .from('student_exits')
        .insert({ student_id: studentId, exit_time: exitTime,
                  reason: reason || null, school_id: schoolId,
                  exit_date: today, recorded_by: recordedBy })
        .select('exit_id').single();
    if (error) throw error;
    return data;
}

export async function updateReturnTime(exitId, returnTime) {
    const { error } = await supabase
        .from('student_exits')
        .update({ return_time: returnTime })
        .eq('exit_id', exitId);
    if (error) throw error;
}

export async function deleteExit(exitId) {
    const { error } = await supabase
        .from('student_exits')
        .delete()
        .eq('exit_id', exitId);
    if (error) throw error;
}

export async function getWaliLateArrivals(dateStart, dateEnd) {
    const { data, error } = await supabase
        .from('late_arrivals')
        .select(`
            late_id, late_date, arrival_time, reason,
            student:students(student_id, full_name, nis)
        `)
        .gte('late_date', dateStart)
        .lte('late_date', dateEnd)
        .order('late_date', { ascending: false })
        .order('arrival_time', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(r => ({
        late_id:      r.late_id,
        date:         r.late_date,
        arrival_time: r.arrival_time,
        reason:       r.reason ?? '',
        student_id:   r.student?.student_id,
        student_name: r.student?.full_name ?? '—',
        nis:          r.student?.nis ?? '—',
    }));
}

export async function getWaliExits(dateStart, dateEnd) {
    const { data, error } = await supabase
        .from('student_exits')
        .select(`
            exit_id, exit_date, exit_time, return_time, reason,
            student:students(student_id, full_name, nis)
        `)
        .gte('exit_date', dateStart)
        .lte('exit_date', dateEnd)
        .order('exit_date', { ascending: false })
        .order('exit_time', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(r => ({
        exit_id:      r.exit_id,
        date:         r.exit_date,
        exit_time:    r.exit_time,
        return_time:  r.return_time ?? '—',
        reason:       r.reason ?? '',
        student_id:   r.student?.student_id,
        student_name: r.student?.full_name ?? '—',
        nis:          r.student?.nis ?? '—',
    }));
}

export async function getLateArrivalsByRange(dateStart, dateEnd, academicYear = null) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        let q = supabase
            .from('late_arrivals')
            .select(`
                late_id, late_date, arrival_time, reason,
                student:students(
                    student_id, full_name, nis, student_status,
                    class_enrollment:class_enrollments(
                        academic_year, withdrawn_at, class:classes(name)
                    )
                ),
                recorder:users!late_arrivals_recorded_by_fkey(full_name)
            `)
            .gte('late_date', dateStart)
            .lte('late_date', dateEnd)
            .order('late_date', { ascending: false })
            .order('arrival_time', { ascending: true })
            .order('late_id', { ascending: true })
            .range(offset, offset + pageSize - 1);
        const { data, error } = await q;
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows.map(r => {
        const enrollment = (r.student?.class_enrollment ?? [])
            .filter(e => !e.withdrawn_at && (!academicYear || e.academic_year === academicYear))
            .sort((a, b) => String(b.academic_year ?? '').localeCompare(String(a.academic_year ?? '')));
        const current = enrollment[0];
        return {
            late_id:      r.late_id,
            date:         r.late_date,
            arrival_time: r.arrival_time,
            reason:       r.reason ?? '',
            student_name: r.student?.full_name ?? '—',
            nis:          r.student?.nis ?? '—',
            class_name:   current?.class?.name ?? '—',
            recorder:     r.recorder?.full_name ?? '—',
        };
    });
}

export async function getLateArrivalsAggregate(dateStart, dateEnd) {
    const { data, error } = await supabase
        .from('late_arrivals')
        .select('late_date')
        .gte('late_date', dateStart)
        .lte('late_date', dateEnd);
    if (error) throw error;
    const countMap = new Map();
    for (const r of (data ?? [])) {
        countMap.set(r.late_date, (countMap.get(r.late_date) ?? 0) + 1);
    }
    return Array.from(countMap.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, total]) => ({ date, total }));
}

export async function getClassProgramContext(classId) {
    const { data, error } = await supabase
        .from('classes')
        .select('grade_level, programs(code)')
        .eq('class_id', classId)
        .single();
    if (error) throw error;
    return {
        grade_level:  data.grade_level ?? null,
        program_code: data.programs?.code ?? null,
    };
}

export async function getCpForSubject(subjectId, programCode, gradeLevel) {
    const { data, error } = await supabase.rpc('fn_get_cp_for_subject', {
        p_subject_id:   subjectId,
        p_program_code: programCode,
        p_grade_level:  gradeLevel,
    });
    if (error) throw error;
    return data;
}

export async function fnToggleTpTaught(p_class_id, p_tp_id, p_is_taught) {
    const { data, error } = await supabase.rpc('fn_toggle_tp_taught', {
        p_class_id,
        p_tp_id,
        p_is_taught,
    });
    if (error) throw error;
    return data;
}

export async function getTpTaughtStatus(classId) {
    const { data, error } = await supabase
        .from('tp_taught_status')
        .select('tp_id, is_taught')
        .eq('class_id', classId);
    if (error) throw error;
    return Object.fromEntries((data || []).map(r => [r.tp_id, r.is_taught]));
}

export async function checkElementDuplicate(elementId, schoolId, loId) {
    const { data, error } = await supabase.rpc('fn_check_element_duplicate', {
        p_element_id: elementId,
        p_school_id:  schoolId,
        p_lo_id:      loId ?? null,
    });
    if (error) throw error;
    return data ?? [];
}

// ─── Penilaian: Tujuan Pembelajaran (learning_objectives) ────────────────────

export async function getTps(kelasId, subjectId, year, semester) {
    const { data, error } = await supabase
        .from('learning_objectives')
        .select('id, kode_tp, deskripsi_tp, urutan')
        .eq('class_id', kelasId)
        .eq('subject_id', subjectId)
        .eq('academic_year', year)
        .eq('semester', semester)
        .order('urutan', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function createTp(payload) {
    const { data, error } = await supabase
        .from('learning_objectives')
        .insert(payload)
        .select('id, kode_tp, deskripsi_tp, urutan')
        .single();
    if (error) throw error;
    return data;
}

export async function updateTp(id, payload) {
    const { data, error } = await supabase
        .from('learning_objectives')
        .update(payload)
        .eq('id', id)
        .select('id, kode_tp, deskripsi_tp, urutan')
        .single();
    if (error) throw error;
    return data;
}

export async function deleteTp(id) {
    const { error } = await supabase
        .from('learning_objectives')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// ── KKTP (assessment_criteria) ────────────────────────────────────────────────

export async function getKktps(learningObjectiveId) {
    const { data, error } = await supabase
        .from('assessment_criteria')
        .select('id,predikat,batas_bawah,batas_atas,keterangan,urutan,rentang')
        .eq('learning_objective_id', learningObjectiveId)
        .order('urutan')
        .order('batas_bawah');
    if (error) throw error;
    return data || [];
}

export async function createKktp(payload) {
    const { data, error } = await supabase
        .from('assessment_criteria')
        .insert(payload)
        .select('id,predikat,batas_bawah,batas_atas,keterangan,urutan,rentang')
        .single();
    if (error) throw error;
    return data;
}

export async function updateKktp(id, payload) {
    const { data, error } = await supabase
        .from('assessment_criteria')
        .update(payload)
        .eq('id', id)
        .select('id,predikat,batas_bawah,batas_atas,keterangan,urutan,rentang')
        .single();
    if (error) throw error;
    return data;
}

export async function deleteKktp(id) {
    const { error } = await supabase
        .from('assessment_criteria')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// ─── Penilaian: Students roster per kelas ────────────────────────────────────

/**
 * Ambil SEMUA baris sebuah kueri dengan paginasi (PostgREST memotong respons di 1000 baris tanpa pemberitahuan).
 * `buat` harus mengembalikan kueri BARU berurutan stabil (order unik) pada setiap pemanggilan.
 */
async function ambilSemuaHalaman(buat, ukuran = 1000) {
    const semua = [];
    for (let dari = 0; ; dari += ukuran) {
        const { data, error } = await buat().range(dari, dari + ukuran - 1);
        if (error) throw error;
        const baris = data ?? [];
        semua.push(...baris);
        if (baris.length < ukuran) break;
    }
    return semua;
}

/**
 * Roster penilaian: siswa AKTIF/PKL yang terdaftar di kelas ini pada tahun ajaran + semester yang diminta (A-01),
 * tanpa duplikat dan tanpa pendaftaran yang sudah ditarik. Membawa NIS untuk ekspor (A-10).
 */
export async function getStudentsForClass(classId, academicYear = null, semester = null) {
    const baris = await ambilSemuaHalaman(() => {
        let q = supabase
            .from('class_enrollments')
            .select('enrollment_id, student_id, students!inner(student_id, nis, full_name, student_status)')
            .eq('class_id', classId)
            .is('withdrawn_at', null)
            .order('enrollment_id');
        if (academicYear) q = q.eq('academic_year', academicYear);
        if (semester != null && semester !== '') q = q.eq('semester', String(semester));
        return q;
    });
    const unik = new Map();
    for (const r of baris) {
        const s = r.students;
        if (!s || !['AKTIF', 'PKL'].includes(s.student_status) || unik.has(s.student_id)) continue;
        unik.set(s.student_id, { id: s.student_id, nama: s.full_name ?? '', nis: s.nis ?? '' });
    }
    return [...unik.values()].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

// ─── Penilaian: Assessments ───────────────────────────────────────────────────

export async function getAssessments(schoolId, classId, subjectId, year, semester) {
    // Dipaginasi: PostgREST memotong respons di 1000 baris tanpa pemberitahuan. `id` sebagai pembeda terakhir membuat urutan UNIK, syarat paginasi yang stabil.
    const data = await ambilSemuaHalaman(() => supabase
        .from('assessments')
        .select('*, assessment_tps(learning_objective_id)')
        .eq('school_id', schoolId)
        .eq('class_id', classId)
        .eq('subject_id', subjectId)
        .eq('academic_year', year)
        .eq('semester', semester)
        // Urutan TUNGGAL untuk semua layar: kronologis (tanggal, lalu waktu dibuat); lihat urutkanPenilaian di penilaian-label.js
        .order('tanggal', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }));
    return data.map(normalisasiPenilaian);
}

/** Satu pintu bentuk penilaian di klien: tautan TP (banyak) menjadi `tpIds`. Pembaca lain memakai tpIdsPenilaian (penilaian-label.js), bukan kolom mentah. */
function normalisasiPenilaian(row) {
    const { assessment_tps: taut, ...sisa } = row;
    return { ...sisa, tpIds: (taut ?? []).map((t) => t.learning_objective_id) };
}

/** Samakan tautan TP sebuah penilaian dengan daftar `tpIds` (hapus yang dilepas, tambah yang baru). */
export async function setAssessmentTps(schoolId, assessmentId, tpIds) {
    const target = [...new Set((tpIds ?? []).filter(Boolean))];
    const { data, error } = await supabase.from('assessment_tps').select('learning_objective_id').eq('assessment_id', assessmentId);
    if (error) throw error;
    const ada = new Set((data ?? []).map((r) => r.learning_objective_id));
    const hapus = [...ada].filter((id) => !target.includes(id));
    const tambah = target.filter((id) => !ada.has(id));
    if (hapus.length) {
        const { error: e1 } = await supabase.from('assessment_tps').delete().eq('assessment_id', assessmentId).in('learning_objective_id', hapus);
        if (e1) throw e1;
    }
    if (tambah.length) {
        const { error: e2 } = await supabase.from('assessment_tps')
            .insert(tambah.map((id) => ({ assessment_id: assessmentId, learning_objective_id: id, school_id: schoolId })));
        if (e2) throw e2;
    }
}

export async function createAssessment(schoolId, classId, subjectId, year, semester, teacherId, payload) {
    const { tpIds, ...kolom } = payload ?? {};
    const { data, error } = await supabase
        .from('assessments')
        .insert({ school_id: schoolId, class_id: classId, subject_id: subjectId,
                  academic_year: year, semester, teacher_id: teacherId, ...kolom })
        .select()
        .single();
    if (error) throw error;
    if (tpIds) {
        try { await setAssessmentTps(schoolId, data.id, tpIds); }
        catch (e) { await supabase.from('assessments').delete().eq('id', data.id); throw e; }   // jangan tinggalkan penilaian tanpa tautan TP yang diminta
    }
    return { ...data, tpIds: tpIds ?? [] };
}

export async function updateAssessment(id, payload, schoolId) {
    const { tpIds, ...kolom } = payload ?? {};
    const { error } = await supabase
        .from('assessments')
        .update({ ...kolom, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
    if (tpIds) await setAssessmentTps(schoolId, id, tpIds);
}

export async function deleteAssessment(id) {
    const { error } = await supabase.from('assessments').delete().eq('id', id);
    if (error) throw error;
}

// ─── Penilaian: Assessment Results ───────────────────────────────────────────

export async function getAssessmentResults(assessmentId) {
    return ambilSemuaHalaman(() => supabase
        .from('assessment_results')
        .select('*')
        .eq('assessment_id', assessmentId)
        .order('student_id'));
}

/** Hasil banyak asesmen sekaligus, dipaginasi agar tidak terpotong di 1000 baris (A-11). */
export async function getResultsForAssessments(assessmentIds, schoolId) {
    if (!assessmentIds?.length) return [];
    return ambilSemuaHalaman(() => supabase
        .from('assessment_results')
        .select('assessment_id, student_id, nilai, status, tindak_lanjut')
        .in('assessment_id', assessmentIds)
        .eq('school_id', schoolId)
        .order('assessment_id').order('student_id'));
}

/** Hapus hasil satu siswa pada satu asesmen (nilai yang dikosongkan guru; A-04). */
export async function deleteAssessmentResult(assessmentId, studentId) {
    const { error } = await supabase
        .from('assessment_results')
        .delete()
        .eq('assessment_id', assessmentId)
        .eq('student_id', studentId);
    if (error) throw error;
}

export async function upsertAssessmentResult(schoolId, classId, assessmentId, studentId, payload) {
    const { error } = await supabase
        .from('assessment_results')
        .upsert(
            { school_id: schoolId, class_id: classId,
              assessment_id: assessmentId, student_id: studentId,
              ...payload, updated_at: new Date().toISOString() },
            { onConflict: 'assessment_id,student_id' }
        );
    if (error) throw error;
}

// ─── Penilaian: Student Groups ────────────────────────────────────────────────

export async function getStudentGroups(schoolId, classId) {
    const { data, error } = await supabase
        .from('student_groups')
        .select('student_id, grup, updated_at')
        .eq('school_id', schoolId)
        .eq('class_id', classId);
    if (error) throw error;
    return data ?? [];
}

export async function upsertStudentGroup(schoolId, classId, studentId, grup) {
    const { error } = await supabase
        .from('student_groups')
        .upsert(
            { school_id: schoolId, class_id: classId, student_id: studentId,
              grup, updated_at: new Date().toISOString() },
            { onConflict: 'class_id,student_id' }
        );
    if (error) throw error;
}


// ─── Waka Kurikulum / Kepala Sekolah: nilai setiap TP (dihitung otomatis; migrasi 20261017150000) ───

export async function getNilaiPerTp(year = null, semester = null) {
    const { data, error } = await supabase.rpc('fn_nilai_per_tp', { p_year: year, p_semester: semester });
    if (error) throw error;
    return data ?? [];
}

export async function getNilaiPerTpSiswa(tpId) {
    const { data, error } = await supabase.rpc('fn_nilai_per_tp_siswa', { p_tp_id: tpId });
    if (error) throw error;
    return data ?? [];
}

// ─── Layar baca nilai rapor kelas (wali kelas, Kepsek, Waka Kurikulum; hak baca ditegakkan RLS grade_final) ───

/** Semua kelas sekolah (RLS membatasi ke sekolah sendiri); untuk pilihan kelas pimpinan. */
export async function getKelasSekolah() {
    const { data, error } = await supabase.from('classes').select('class_id, name').eq('is_active', true).order('name');
    if (error) throw error;
    return (data ?? []).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

/** Nilai rapor SEMUA mata pelajaran satu kelas pada satu periode, dengan nama mapel dan guru pengisi. */
export async function getGradeFinalKelas(classId, year, semester) {
    return ambilSemuaHalaman(() => supabase
        .from('grade_final')
        .select('student_id, subject_id, teacher_id, nilai_rapor, updated_at, subject:subjects(name), teacher:users(full_name)')
        .eq('class_id', classId)
        .eq('academic_year', year)
        .eq('semester', Number(semester))
        .order('id'));
}

// ─── Nilai rapor per mata pelajaran (tabel grade_final; migrasi 20261017140000) ───

/** Nilai rapor tersimpan satu kelas + mapel + periode (hanya milik guru pemanggil, ditegakkan RLS), dipaginasi. */
export async function getGradeFinal(schoolId, classId, subjectId, year, semester) {
    return ambilSemuaHalaman(() => supabase
        .from('grade_final')
        .select('*')
        .eq('school_id', schoolId)
        .eq('class_id', classId)
        .eq('subject_id', subjectId)
        .eq('academic_year', year)
        .eq('semester', Number(semester))
        .order('id'));
}

/**
 * Simpan nilai rapor banyak siswa sekaligus (satu permintaan: semua atau tidak sama sekali).
 * rows: [{ studentId, nilai_rapor, metode, rumus, tp_optimal, tp_perlu, deskripsi_tertinggi, deskripsi_terendah }]
 */
/**
 * Simpan nilai rapor. Angka yang tersimpan DITETAPKAN DATABASE dari rumus (grade_final.rumus) dan nilai penilaian sumatif (migrasi 20261020150000); angka kiriman diabaikan.
 * Mengembalikan baris yang benar-benar tersimpan ({student_id, nilai_rapor, metode}) agar layar dapat membandingkannya dengan yang dikirim.
 */
export async function upsertGradeFinalBatch(schoolId, classId, subjectId, teacherId, year, semester, rows) {
    if (!rows?.length) return [];
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('grade_final')
        .upsert(
            rows.map((r) => ({
                school_id: schoolId, class_id: classId, subject_id: subjectId, teacher_id: teacherId,
                student_id: r.studentId, academic_year: year, semester: Number(semester),
                nilai_rapor: r.nilai_rapor, metode: r.metode ?? 'MANUAL',
                tp_optimal: r.tp_optimal ?? [], tp_perlu: r.tp_perlu ?? [],
                deskripsi_tertinggi: r.deskripsi_tertinggi || null, deskripsi_terendah: r.deskripsi_terendah || null,
                // Izin tampil di portal (bawaan tidak terlihat; migrasi 20261017150000)
                is_visible_siswa: r.is_visible_siswa === true, is_visible_ortu: r.is_visible_ortu === true,
                // Rumus yang ditetapkan guru (metode + bobot persen), disimpan sekali agar tidak diisi ulang (migrasi 20261018200000)
                rumus: r.rumus ?? null,
                updated_at: now,
            })),
            { onConflict: 'class_id,subject_id,student_id,academic_year,semester,teacher_id' }
        )
        .select('student_id, nilai_rapor, metode');
    if (error) throw error;
    return data ?? [];
}

/** Hapus nilai rapor siswa tertentu (nilai dikosongkan guru) pada satu kelas + mapel + periode. */
export async function deleteGradeFinalForStudents(schoolId, classId, subjectId, teacherId, year, semester, studentIds) {
    if (!studentIds?.length) return;
    const { error } = await supabase
        .from('grade_final')
        .delete()
        .eq('school_id', schoolId)
        .eq('class_id', classId)
        .eq('subject_id', subjectId)
        .eq('teacher_id', teacherId)
        .eq('academic_year', year)
        .eq('semester', Number(semester))
        .in('student_id', studentIds);
    if (error) throw error;
}

/** Hapus rekap siswa tertentu pada satu TP: siswa yang nilainya kini kosong tidak boleh meninggalkan rekap lama (A-05). */
export async function deleteGradeRecapForStudents(schoolId, classId, loId, semester, year, studentIds) {
    if (!studentIds?.length) return;
    const { error } = await supabase
        .from('grade_recap')
        .delete()
        .eq('school_id', schoolId)
        .eq('class_id', classId)
        .eq('learning_objective_id', loId)
        .eq('semester', semester)
        .eq('academic_year', year)
        .in('student_id', studentIds);
    if (error) throw error;
}


// ─── CP Manual (teaching_cp + teaching_cp_elements) ───────────────────────────

export async function getCp(kelasId, subjectId, year) {
    const { data: cp, error } = await supabase
        .from('teaching_cp')
        .select('cp_id, cp_umum')
        .eq('class_id', kelasId)
        .eq('subject_id', subjectId)
        .eq('academic_year', year)
        .maybeSingle();
    if (error) throw error;
    if (!cp) return null;
    const { data: elemen, error: err2 } = await supabase
        .from('teaching_cp_elements')
        .select('element_id, nama_elemen, deskripsi_cp, urutan')
        .eq('cp_id', cp.cp_id)
        .order('urutan', { ascending: true })
        .order('created_at', { ascending: true });
    if (err2) throw err2;
    return { cp_id: cp.cp_id, cp_umum: cp.cp_umum, elemen: elemen || [] };
}

export async function upsertCp(schoolId, teacherId, kelasId, subjectId, year, cpUmum) {
    const { data: existing } = await supabase
        .from('teaching_cp')
        .select('cp_id')
        .eq('school_id', schoolId)
        .eq('teacher_id', teacherId)
        .eq('class_id', kelasId)
        .eq('subject_id', subjectId)
        .eq('academic_year', year)
        .maybeSingle();
    if (existing) {
        const { error } = await supabase
            .from('teaching_cp')
            .update({ cp_umum: cpUmum })
            .eq('cp_id', existing.cp_id);
        if (error) throw error;
        return existing.cp_id;
    }
    const { data, error } = await supabase
        .from('teaching_cp')
        .insert({ school_id: schoolId, teacher_id: teacherId, class_id: kelasId,
                  subject_id: subjectId, academic_year: year, cp_umum: cpUmum })
        .select('cp_id')
        .single();
    if (error) throw error;
    return data.cp_id;
}

export async function createCpElemen(cpId, schoolId, teacherId, namaElemen, deskripsiCp, urutan) {
    const { data, error } = await supabase
        .from('teaching_cp_elements')
        .insert({ cp_id: cpId, school_id: schoolId, teacher_id: teacherId,
                  nama_elemen: namaElemen, deskripsi_cp: deskripsiCp, urutan })
        .select('element_id')
        .single();
    if (error) throw error;
    return data.element_id;
}

export async function updateCpElemen(elementId, namaElemen, deskripsiCp) {
    const { error } = await supabase
        .from('teaching_cp_elements')
        .update({ nama_elemen: namaElemen, deskripsi_cp: deskripsiCp })
        .eq('element_id', elementId);
    if (error) throw error;
}

export async function deleteCpElemen(elementId) {
    const { error } = await supabase
        .from('teaching_cp_elements')
        .delete()
        .eq('element_id', elementId);
    if (error) throw error;
}

// ── Berbagi ringkasan ke wilayah (kecamatan) — hanya KEPSEK yang dapat mengubah ──
export async function getRegionSharingStatus() {
    const { data, error } = await supabase.rpc('fn_region_sharing_status');
    if (error) throw error;
    return data;
}

export async function setRegionSharing(share) {
    const { data, error } = await supabase.rpc('fn_set_region_sharing', { p_share: !!share });
    if (error) throw error;
    return data;
}

// Persetujuan per tingkat: level = 'KECAMATAN' | 'KABUPATEN' | 'PROVINSI'
export async function setRegionSharingLevel(level, share) {
    const { data, error } = await supabase.rpc('fn_set_region_sharing_level', { p_level: level, p_share: !!share });
    if (error) throw error;
    return data;
}

// ─── Kunci nilai semester (B-07; migrasi 20261018120000) ───

/** Status kunci satu kelas pada satu periode (Kepala Sekolah / Waka Kurikulum). */
export async function getGradePeriodStatus(classId, year, semester) {
    const { data, error } = await supabase.rpc('fn_get_grade_period_status', { p_class: classId, p_year: year, p_semester: Number(semester) });
    if (error) throw error;
    return data;
}

/** Membuka kunci nilai satu kelas dengan alasan tertulis (minimal 10 karakter; tercatat di server). */
export async function unlockGradePeriod(classId, year, semester, reason) {
    const { data, error } = await supabase.rpc('fn_unlock_grade_period', { p_class: classId, p_year: year, p_semester: Number(semester), p_reason: reason });
    if (error) throw error;
    return data;
}

/** Mengunci kembali kelas yang tadinya dibuka. */
export async function relockGradePeriod(classId, year, semester) {
    const { data, error } = await supabase.rpc('fn_relock_grade_period', { p_class: classId, p_year: year, p_semester: Number(semester) });
    if (error) throw error;
    return data;
}
