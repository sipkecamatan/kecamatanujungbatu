/**
 * Buat akun yang kurang di SMK Uji 1 (WAKA, TU, ORTU, STAKEHOLDER).
 * Jalankan: node scripts/buat-akun-smk-kurang.mjs
 */

import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const get = k => (env.match(new RegExp(k + '=(.+)')) || [])[1]?.trim();

const SUPABASE_URL = get('SUPABASE_URL');
const SERVICE_KEY = get('SUPABASE_SERVICE_KEY');
const PASSWORD = get('UJI_PASSWORD').replace(/^<|>$/g, '');
const SCHOOL_ID_SMK = '5d67c321-ec65-4ecb-b1d3-672ce7628a17';

const AKUN = [
  { email: 'waka-kesiswaan.smk@uji.test', nama: 'Waka Kesiswaan SMK Uji', role_type: 'WAKA_KESISWAAN' },
  { email: 'waka-kurikulum.smk@uji.test', nama: 'Waka Kurikulum SMK Uji', role_type: 'WAKA_KURIKULUM' },
  { email: 'waka-humas.smk@uji.test',     nama: 'Waka Humas SMK Uji',     role_type: 'WAKA_HUMAS' },
  { email: 'tu.smk@uji.test',             nama: 'TU SMK Uji',             role_type: 'TU' },
  { email: 'ortu.smk@uji.test',           nama: 'Ortu SMK Uji',           role_type: 'ORTU' },
  { email: 'stakeholder.smk@uji.test',    nama: 'Stakeholder SMK Uji',    role_type: 'STAKEHOLDER' },
];

async function post(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function buat(akun) {
  const authRes = await post('/auth/v1/admin/users', {
    email: akun.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: akun.nama },
  });

  if (!authRes.id) {
    const msg = authRes.message || JSON.stringify(authRes);
    if (msg.includes('already') || msg.includes('duplicate')) {
      console.log(`  SKIP  ${akun.email} (sudah ada)`);
      return akun.email;
    }
    console.log(`  GAGAL ${akun.email}: ${msg}`);
    return null;
  }

  await new Promise(r => setTimeout(r, 800));

  await post('/rest/v1/users', {
    auth_user_id: authRes.id,
    full_name: akun.nama,
    email: akun.email,
    school_id: SCHOOL_ID_SMK,
    role_type: akun.role_type,
    is_kepsek: false,
    is_active: true,
    must_change_password: false,
    login_identifier: akun.email.split('@')[0].toUpperCase(),
    identifier_type: 'EMAIL',
  });

  console.log(`  OK    ${akun.email}`);
  return akun.email;
}

console.log('Membuat akun yang kurang di SMK Uji 1...\n');
const hasil = [];
for (const akun of AKUN) {
  const email = await buat(akun);
  if (email) hasil.push({ role: akun.role_type, email });
}

console.log('\n=== Tambahkan ke .env ===');
for (const h of hasil) {
  console.log(`UJI_SMK_${h.role}=${h.email}`);
}
console.log('\nSelesai.');
