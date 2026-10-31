/**
 * Buat 38 akun uji untuk semua role dan jenjang.
 * Jalankan: node scripts/buat-akun-uji.mjs
 * Prasyarat: .env berisi SUPABASE_URL dan SUPABASE_SERVICE_KEY
 */

import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const get = k => (env.match(new RegExp(k + '=(.+)')) || [])[1]?.trim();

const SUPABASE_URL = get('SUPABASE_URL');
const SERVICE_KEY = get('SUPABASE_SERVICE_KEY');
const PASSWORD = '123456789';

const SCHOOLS = {
  SMK: '5d67c321-ec65-4ecb-b1d3-672ce7628a17',
  SMA: 'a41a1f24-3ed2-464e-8e06-754f4dfd3c1f',
  SMP: '4ba66164-4f9d-4973-9afe-cf7e473ef91b',
};

// Definisi akun: [email, full_name, school_id, kolom role di tabel users]
const AKUN = [
  // SMK
  { email: 'guru.smk@uji.test',             nama: 'Guru SMK Uji',            jenjang: 'SMK', role: { role_type: 'GURU' } },
  { email: 'wali.smk@uji.test',             nama: 'Wali Kelas SMK Uji',      jenjang: 'SMK', role: { role_type: 'GURU' } },
  { email: 'piket.smk@uji.test',            nama: 'Guru Piket SMK Uji',      jenjang: 'SMK', role: { role_type: 'GURU' } },
  { email: 'kaprodi.smk@uji.test',          nama: 'Kaprodi SMK Uji',         jenjang: 'SMK', role: { role_type: 'GURU' } },
  { email: 'waka-kesiswaan.smk@uji.test',   nama: 'Waka Kesiswaan SMK Uji',  jenjang: 'SMK', role: { role_type: 'WAKA_KESISWAAN' } },
  { email: 'waka-kurikulum.smk@uji.test',   nama: 'Waka Kurikulum SMK Uji',  jenjang: 'SMK', role: { role_type: 'WAKA_KURIKULUM' } },
  { email: 'waka-humas.smk@uji.test',       nama: 'Waka Humas SMK Uji',      jenjang: 'SMK', role: { role_type: 'WAKA_HUMAS' } },
  { email: 'bk.smk@uji.test',               nama: 'BK SMK Uji',              jenjang: 'SMK', role: { role_type: 'BK' } },
  { email: 'kepsek.smk@uji.test',           nama: 'Kepsek SMK Uji',          jenjang: 'SMK', role: { role_type: 'ADMINISTRATIVE', is_kepsek: true } },
  { email: 'tu.smk@uji.test',               nama: 'TU SMK Uji',              jenjang: 'SMK', role: { role_type: 'TU' } },
  { email: 'siswa.smk@uji.test',            nama: 'Siswa SMK Uji',           jenjang: 'SMK', role: { role_type: 'SISWA' } },
  { email: 'ortu.smk@uji.test',             nama: 'Ortu SMK Uji',            jenjang: 'SMK', role: { role_type: 'ORTU' } },
  { email: 'dudi.smk@uji.test',             nama: 'DUDI SMK Uji',            jenjang: 'SMK', role: { role_type: 'DUDI' } },
  { email: 'stakeholder.smk@uji.test',      nama: 'Stakeholder SMK Uji',     jenjang: 'SMK', role: { role_type: 'STAKEHOLDER' } },

  // SMA
  { email: 'guru.sma@uji.test',             nama: 'Guru SMA Uji',            jenjang: 'SMA', role: { role_type: 'GURU' } },
  { email: 'wali.sma@uji.test',             nama: 'Wali Kelas SMA Uji',      jenjang: 'SMA', role: { role_type: 'GURU' } },
  { email: 'piket.sma@uji.test',            nama: 'Guru Piket SMA Uji',      jenjang: 'SMA', role: { role_type: 'GURU' } },
  { email: 'waka-kesiswaan.sma@uji.test',   nama: 'Waka Kesiswaan SMA Uji',  jenjang: 'SMA', role: { role_type: 'WAKA_KESISWAAN' } },
  { email: 'waka-kurikulum.sma@uji.test',   nama: 'Waka Kurikulum SMA Uji',  jenjang: 'SMA', role: { role_type: 'WAKA_KURIKULUM' } },
  { email: 'bk.sma@uji.test',               nama: 'BK SMA Uji',              jenjang: 'SMA', role: { role_type: 'BK' } },
  { email: 'kepsek.sma@uji.test',           nama: 'Kepsek SMA Uji',          jenjang: 'SMA', role: { role_type: 'ADMINISTRATIVE', is_kepsek: true } },
  { email: 'tu.sma@uji.test',               nama: 'TU SMA Uji',              jenjang: 'SMA', role: { role_type: 'TU' } },
  { email: 'siswa.sma@uji.test',            nama: 'Siswa SMA Uji',           jenjang: 'SMA', role: { role_type: 'SISWA' } },
  { email: 'ortu.sma@uji.test',             nama: 'Ortu SMA Uji',            jenjang: 'SMA', role: { role_type: 'ORTU' } },
  { email: 'stakeholder.sma@uji.test',      nama: 'Stakeholder SMA Uji',     jenjang: 'SMA', role: { role_type: 'STAKEHOLDER' } },

  // SMP
  { email: 'guru.smp@uji.test',             nama: 'Guru SMP Uji',            jenjang: 'SMP', role: { role_type: 'GURU' } },
  { email: 'wali.smp@uji.test',             nama: 'Wali Kelas SMP Uji',      jenjang: 'SMP', role: { role_type: 'GURU' } },
  { email: 'piket.smp@uji.test',            nama: 'Guru Piket SMP Uji',      jenjang: 'SMP', role: { role_type: 'GURU' } },
  { email: 'wakasek.smp@uji.test',          nama: 'Wakasek SMP Uji',         jenjang: 'SMP', role: { role_type: 'WAKA_KESISWAAN' } },
  { email: 'bk.smp@uji.test',               nama: 'BK SMP Uji',              jenjang: 'SMP', role: { role_type: 'BK' } },
  { email: 'kepsek.smp@uji.test',           nama: 'Kepsek SMP Uji',          jenjang: 'SMP', role: { role_type: 'ADMINISTRATIVE', is_kepsek: true } },
  { email: 'tu.smp@uji.test',               nama: 'TU SMP Uji',              jenjang: 'SMP', role: { role_type: 'TU' } },
  { email: 'siswa.smp@uji.test',            nama: 'Siswa SMP Uji',           jenjang: 'SMP', role: { role_type: 'SISWA' } },
  { email: 'ortu.smp@uji.test',             nama: 'Ortu SMP Uji',            jenjang: 'SMP', role: { role_type: 'ORTU' } },
  { email: 'stakeholder.smp@uji.test',      nama: 'Stakeholder SMP Uji',     jenjang: 'SMP', role: { role_type: 'STAKEHOLDER' } },

  // Wilayah (tidak terikat sekolah)
  { email: 'kecamatan@uji.test',            nama: 'Pegawai Kecamatan Uji',   jenjang: null,  role: { role_type: 'ADMINISTRATIVE' } },
  { email: 'kabupaten@uji.test',            nama: 'Pegawai Kabupaten Uji',   jenjang: null,  role: { role_type: 'ADMINISTRATIVE' } },
  { email: 'provinsi@uji.test',             nama: 'Pegawai Provinsi Uji',    jenjang: null,  role: { role_type: 'ADMINISTRATIVE' } },
];

async function apiPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function buatSatuAkun(akun) {
  const { email, nama, jenjang, role } = akun;
  const school_id = jenjang ? SCHOOLS[jenjang] : null;

  // 1. Buat akun di auth.users
  const authRes = await apiPost('/auth/v1/admin/users', {
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: nama },
  });

  if (authRes.error || !authRes.id) {
    const msg = authRes.error?.message || authRes.message || JSON.stringify(authRes);
    // Lewati jika sudah ada
    if (msg.includes('already') || msg.includes('duplicate')) {
      console.log(`  SKIP  ${email} (sudah ada)`);
      return;
    }
    console.log(`  GAGAL ${email}: ${msg}`);
    return;
  }

  const auth_user_id = authRes.id;

  // 2. Tunggu trigger membuat baris di tabel users (jika ada), lalu patch
  await new Promise(r => setTimeout(r, 800));

  // Cek apakah trigger sudah membuat baris
  const cekRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?auth_user_id=eq.${auth_user_id}&select=user_id`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const cekData = await cekRes.json();

  const profileData = {
    full_name: nama,
    email,
    school_id,
    role_type: role.role_type || 'GURU',
    is_kepsek: role.is_kepsek || false,
    is_active: true,
    must_change_password: false,
  };

  if (cekData.length > 0) {
    // Trigger sudah buat baris — patch saja
    await apiPatch(
      `/rest/v1/users?auth_user_id=eq.${auth_user_id}`,
      profileData
    );
  } else {
    // Tidak ada trigger — insert manual
    await apiPost('/rest/v1/users', {
      ...profileData,
      auth_user_id,
      login_identifier: email.split('@')[0].toUpperCase(),
      identifier_type: 'EMAIL',
    });
  }

  console.log(`  OK    ${email}`);
}

async function main() {
  console.log(`Membuat ${AKUN.length} akun uji...\n`);
  for (const akun of AKUN) {
    await buatSatuAkun(akun);
  }
  console.log('\nSelesai.');
}

main().catch(console.error);
