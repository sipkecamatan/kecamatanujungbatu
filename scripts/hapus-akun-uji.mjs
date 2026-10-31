/**
 * Hapus 38 akun uji baru (email @uji.test) dari auth.users.
 * Jalankan: node scripts/hapus-akun-uji.mjs
 */

import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const get = k => (env.match(new RegExp(k + '=(.+)')) || [])[1]?.trim();
const url = get('SUPABASE_URL');
const key = get('SUPABASE_SERVICE_KEY');

const EMAILS = [
  'guru.smk@uji.test','wali.smk@uji.test','piket.smk@uji.test','kaprodi.smk@uji.test',
  'waka-kesiswaan.smk@uji.test','waka-kurikulum.smk@uji.test','waka-humas.smk@uji.test',
  'bk.smk@uji.test','kepsek.smk@uji.test','tu.smk@uji.test','siswa.smk@uji.test',
  'ortu.smk@uji.test','dudi.smk@uji.test','stakeholder.smk@uji.test',
  'guru.sma@uji.test','wali.sma@uji.test','piket.sma@uji.test',
  'waka-kesiswaan.sma@uji.test','waka-kurikulum.sma@uji.test','bk.sma@uji.test',
  'kepsek.sma@uji.test','tu.sma@uji.test','siswa.sma@uji.test','ortu.sma@uji.test',
  'stakeholder.sma@uji.test',
  'guru.smp@uji.test','wali.smp@uji.test','piket.smp@uji.test','wakasek.smp@uji.test',
  'bk.smp@uji.test','kepsek.smp@uji.test','tu.smp@uji.test','siswa.smp@uji.test',
  'ortu.smp@uji.test','stakeholder.smp@uji.test',
  'kecamatan@uji.test','kabupaten@uji.test','provinsi@uji.test',
];

async function hapus(email) {
  const r = await fetch(
    `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const d = await r.json();
  const uid = d.users?.[0]?.id;
  if (!uid) { console.log(`  SKIP  ${email} (tidak ditemukan)`); return; }

  const r2 = await fetch(`${url}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  console.log(`  ${r2.ok ? 'HAPUS' : 'GAGAL'} ${email}`);
}

console.log(`Menghapus ${EMAILS.length} akun @uji.test...\n`);
for (const email of EMAILS) await hapus(email);
console.log('\nSelesai.');
