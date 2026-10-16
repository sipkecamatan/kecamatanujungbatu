// Rekonsiliasi dasbor wilayah terhadap produksi (HANYA BACA; semua dalam transaksi yang dibatalkan).
//
// Untuk setiap wilayah yang punya pegawai: panggil fn_region_overview_range sebagai pegawai itu (klaim JWT sintetis), lalu
// bandingkan setiap angka dengan hitungan INDEPENDEN dari tabel dasar (subquery skalar per sekolah + aturan privasi di JS,
// sengaja berbeda bentuk dari CTE di fungsi). Juga memeriksa himpunan sekolah yang terlihat terhadap tanda bagi sekolah,
// dan kualitas data yang dapat merusak kepercayaan angka.
//
//   SIP_MGMT_MODE=cli node tests/rekonsiliasi-dasbor-wilayah.mjs [dari=YYYY-MM-DD] [sampai=YYYY-MM-DD]
//
// Butuh login CLI Supabase tertaut (supabase db query --linked). Tidak menulis apa pun.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
function jalan(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sip-rek-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, sql);
  try {
    const r = spawnSync('supabase db query --linked -o json -f "' + f + '"', { shell: true, encoding: 'utf8', maxBuffer: 256e6, cwd: ROOT });
    const out = String(r.stdout || '');
    if (r.status !== 0) throw new Error('cli ' + r.status + ': ' + String(r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|unexpected/.test(l)).join(' ').slice(0, 500));
    // objek {rows} (mode agen) atau larik (terminal manusia, -o json)
    const awal = out.search(/[\[{]/);
    if (awal < 0) throw new Error('keluaran CLI bukan JSON (' + out.length + ' byte)');
    const j = JSON.parse(out.slice(awal));
    return Array.isArray(j) ? j : (j.rows ?? []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const arg = (k) => (process.argv.find((a) => a.startsWith(k + '=')) || '').split('=')[1];
let lulus = 0, gagal = 0;
const ok = (m) => { lulus++; console.log('  LULUS  ' + m); };
const salah = (m) => { gagal++; console.log('  GAGAL  ' + m); };
// jsonb PostgreSQL mengurutkan kunci objek berdasarkan panjang lalu abjad; bandingkan tanpa peduli urutan kunci.
const kanon = (v) => (Array.isArray(v) ? v.map(kanon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, kanon(v[k])])) : v);
const sama = (nama, a, b) => (JSON.stringify(kanon(a)) === JSON.stringify(kanon(b)) ? ok(nama) : salah(`${nama}: fungsi=${JSON.stringify(a)} independen=${JSON.stringify(b)}`));

const hariIni = jalan('select fn_hari_ini()::text d')[0].d;
const geser = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const SAMPAI = arg('sampai') || hariIni;
const DARI = arg('dari') || geser(SAMPAI, -29);
console.log(`Rentang: ${DARI} s.d. ${SAMPAI} (hari ini menurut basis data: ${hariIni})`);

// ── Wilayah dan pegawai ──
const wilayah = jalan(`select r.region_id, r.name, r.level, (select s.auth_user_id::text from region_staff s where s.region_id = r.region_id order by s.auth_user_id limit 1) staf
                       from regions r order by r.level, r.name`).filter((r) => r.staf);

// ── Himpunan sekolah terlihat yang diharapkan (aturan ditulis ulang di sini dari tanda bagi) ──
const sekolahSemua = jalan(`select school_id::text, name, jenjang, is_active, region_id::text, kabupaten_id::text, provinsi_id::text,
                             share_with_region, share_kabupaten, share_provinsi from schools`);
const harapanTerlihat = (w) => sekolahSemua.filter((s) => s.is_active && (
  (w.level === 'KECAMATAN' && s.region_id === w.region_id && s.share_with_region) ||
  (w.level === 'KABUPATEN' && s.kabupaten_id === w.region_id && s.share_kabupaten) ||
  (w.level === 'PROVINSI' && s.provinsi_id === w.region_id && s.share_provinsi))).map((s) => s.school_id);

// ── Metrik mentah per sekolah (subquery skalar; BUKAN CTE seperti di fungsi) ──
function mentah(ids) {
  if (!ids.length) return {};
  const baris = jalan(ids.map((id) => `select '${id}' sid,
    (select count(*) from students x where x.school_id='${id}' and x.student_status in ('AKTIF','PKL'))::int siswa,
    (select count(*) from users x where x.school_id='${id}' and x.role_type='ORTU' and x.is_active and x.deleted_at is null)::int ortu,
    (select count(*) from teaching_schedules x where x.school_id='${id}' and x.meeting_status='NORMAL' and x.session_date between '${DARI}' and '${SAMPAI}')::int terjadwal,
    (select count(*) from teaching_schedules x where x.school_id='${id}' and x.meeting_status='NORMAL' and x.session_date between '${DARI}' and '${SAMPAI}'
        and exists (select 1 from attendance a where a.schedule_id=x.schedule_id and a.is_void=false))::int tercatat,
    (select count(*) from attendance a where a.school_id='${id}' and a.is_void=false and a.schedule_id in (select schedule_id from teaching_schedules t where t.session_date between '${DARI}' and '${SAMPAI}'))::int baris,
    (select count(*) from attendance a where a.school_id='${id}' and a.is_void=false and a.status='HADIR' and a.schedule_id in (select schedule_id from teaching_schedules t where t.session_date between '${DARI}' and '${SAMPAI}'))::int hadir,
    (select count(*) from attendance a where a.school_id='${id}' and a.is_void=false and a.status='SAKIT' and a.schedule_id in (select schedule_id from teaching_schedules t where t.session_date between '${DARI}' and '${SAMPAI}'))::int sakit,
    (select count(*) from attendance a where a.school_id='${id}' and a.is_void=false and a.status='IZIN' and a.schedule_id in (select schedule_id from teaching_schedules t where t.session_date between '${DARI}' and '${SAMPAI}'))::int izin,
    (select count(*) from attendance a where a.school_id='${id}' and a.is_void=false and a.status='ALPA' and a.schedule_id in (select schedule_id from teaching_schedules t where t.session_date between '${DARI}' and '${SAMPAI}'))::int alpa,
    (select count(*) from late_arrivals x where x.school_id='${id}' and x.late_date between '${DARI}' and '${SAMPAI}')::int terlambat,
    (select count(*) from student_exits x where x.school_id='${id}' and x.exit_date between '${DARI}' and '${SAMPAI}')::int keluar`).join(' union all '));
  return Object.fromEntries(baris.map((b) => [b.sid, b]));
}
const bulat = (x) => Math.floor(x + 0.5);                       // round() PostgreSQL pada nilai positif
const kecil = (n) => n >= 1 && n <= 4;                          // ambang piket 5
const pctK = (n, d) => (d > 0 ? bulat((100 * n) / d) : null);

function harapSekolah(m) {
  const cakupan = m.terjadwal === 0 ? null : bulat((100 * m.tercatat) / m.terjadwal);
  const status = cakupan === null || m.terjadwal === 0 ? 'TIDAK_ADA_JADWAL' : m.tercatat === 0 ? 'BELUM_ADA_DATA' : cakupan >= 80 ? 'MEMADAI' : 'DATA_BELUM_MEMADAI';
  const bisa = cakupan !== null && cakupan >= 80 && m.baris > 0;
  return {
    cakupan_pct: cakupan, status,
    kehadiran_pct: bisa ? pctK(m.hadir, m.baris) : null,
    sakit_pct: bisa && !kecil(m.sakit) ? pctK(m.sakit, m.baris) : null,
    izin_pct: bisa && !kecil(m.izin) ? pctK(m.izin, m.baris) : null,
    alpa_pct: bisa && !kecil(m.alpa) ? pctK(m.alpa, m.baris) : null,
    absen_kecil: bisa ? ['sakit', 'izin', 'alpa'].filter((k) => kecil(m[k])) : [],
    terlambat: kecil(m.terlambat) ? null : m.terlambat,
    izin_keluar: kecil(m.keluar) ? null : m.keluar,
  };
}

// ── Pemeriksaan per wilayah ──
for (const w of wilayah) {
  console.log(`\n== ${w.name} (${w.level})`);
  let hasil;
  try {
    const rows = jalan(`begin; select set_config('request.jwt.claims', '{"sub":"${w.staf}","role":"authenticated"}', true);
      select public.fn_region_overview_range('${DARI}'::date, '${SAMPAI}'::date)::text j; rollback;`);
    hasil = JSON.parse(rows[rows.length - 1].j);
  } catch (e) { salah('panggilan fungsi: ' + e.message); continue; }

  // 1. himpunan sekolah
  const harap = harapanTerlihat(w).sort();
  const dapat = hasil.sekolah.map((s) => s.school_id).sort();
  sama('himpunan sekolah terlihat = sekolah yang berbagi ke tingkat ini (' + harap.length + ' sekolah)', dapat, harap);
  sama('jumlah_sekolah_terdaftar = jumlah sekolah terlihat', hasil.jumlah_sekolah_terdaftar, harap.length);
  sama('nama wilayah pada tajuk', hasil.wilayah, w.name);
  sama('tingkat wilayah', hasil.tingkat, w.level);
  sama('rentang tanggal dipakai apa adanya', [hasil.dari, hasil.sampai], [DARI, SAMPAI]);

  // 2. per sekolah
  const m = mentah(harap);
  // kontrol negatif: alat HARUS melaporkan gagal. +1 pada hadir saja tidak cukup (tidak mengubah persen yang dibulatkan).
  if (process.env.UJI_SABOTASE && harap.length) { m[harap[0]].siswa += 1; m[harap[0]].hadir = Math.floor(m[harap[0]].hadir * 0.9); }
  for (const s of hasil.sekolah) {
    const g = m[s.school_id];
    if (!g) { salah(`sekolah ${s.nama} tidak punya metrik mentah`); continue; }
    const h = harapSekolah(g);
    const dasar = { siswa_aktif: g.siswa, orang_tua_aktif: g.ortu, sesi_terjadwal: g.terjadwal, sesi_tercatat: g.tercatat, ...h };
    const ambil = {}; for (const k of Object.keys(dasar)) ambil[k] = s[k];
    sama(`${s.nama}: seluruh angka`, ambil, dasar);
  }

  // 3. total dan per jenjang (aturan: total hanya bila >= 3 sekolah; per jenjang hanya bila >= 2)
  const ids = harap, hs = ids.map((id) => ({ id, g: m[id], h: harapSekolah(m[id]), j: sekolahSemua.find((s) => s.school_id === id).jenjang }));
  const agg = (arr) => {
    const ok_ = arr.filter((x) => x.h.status === 'MEMADAI');
    const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
    const terj = sum(arr, (x) => x.g.terjadwal), terc = sum(arr, (x) => x.g.tercatat);
    const bk = sum(ok_, (x) => x.g.baris), hd = sum(ok_, (x) => x.g.hadir);
    const sk = sum(ok_, (x) => x.g.sakit), iz = sum(ok_, (x) => x.g.izin), al = sum(ok_, (x) => x.g.alpa);
    const tl = sum(arr, (x) => x.g.terlambat), kl = sum(arr, (x) => x.g.keluar);
    return {
      siswa_aktif: sum(arr, (x) => x.g.siswa), orang_tua_aktif: sum(arr, (x) => x.g.ortu),
      cakupan_pct: terj > 0 ? bulat((100 * terc) / terj) : null,
      kehadiran_pct: bk > 0 ? bulat((100 * hd) / bk) : null,
      sakit_pct: bk > 0 && !kecil(sk) ? bulat((100 * sk) / bk) : null,
      izin_pct: bk > 0 && !kecil(iz) ? bulat((100 * iz) / bk) : null,
      alpa_pct: bk > 0 && !kecil(al) ? bulat((100 * al) / bk) : null,
      absen_kecil: bk > 0 ? [['sakit', sk], ['izin', iz], ['alpa', al]].filter(([, n]) => kecil(n)).map(([k]) => k) : [],
      terlambat: kecil(tl) ? null : tl, izin_keluar: kecil(kl) ? null : kl,
    };
  };
  if (hs.length >= 3) sama('total wilayah (angka agregat)', hasil.total, agg(hs));
  else sama('total wilayah disembunyikan bila sekolah < 3', hasil.total, null);
  const jenjangSet = [...new Set(hs.map((x) => x.j))].sort();
  const harapJen = jenjangSet.map((j) => ({ jenjang: j ?? 'TIDAK_DIKETAHUI', arr: hs.filter((x) => x.j === j) })).filter((x) => x.arr.length >= 2)
    .map((x) => ({ jenjang: x.jenjang, jumlah_sekolah: x.arr.length, ...agg(x.arr) }));
  sama('rincian per jenjang (hanya jenjang dengan >= 2 sekolah)', hasil.per_jenjang, harapJen);

  // 3b. tren per sekolah (fn_region_school_trend_range) terhadap agregasi independen di JS
  for (const id of harap.slice(0, 2)) {
    for (const gran of ['MINGGU', 'BULAN']) {
      let tren;
      try {
        const rows = jalan(`begin; select set_config('request.jwt.claims', '{"sub":"${w.staf}","role":"authenticated"}', true);
          select coalesce(jsonb_agg(to_jsonb(t) order by t.periode_mulai), '[]'::jsonb)::text j from public.fn_region_school_trend_range('${id}'::uuid, '${DARI}'::date, '${SAMPAI}'::date, '${gran}') t; rollback;`);
        tren = JSON.parse(rows[rows.length - 1].j);
      } catch (e) { salah('tren ' + gran + ': ' + e.message); continue; }
      const sesi = jalan(`select s.session_date::text d, s.schedule_id::text sid,
          (select count(*) from attendance a where a.schedule_id=s.schedule_id and not a.is_void)::int baris,
          (select count(*) from attendance a where a.schedule_id=s.schedule_id and not a.is_void and a.status='HADIR')::int hadir
        from teaching_schedules s where s.school_id='${id}' and s.meeting_status='NORMAL' and s.session_date between '${DARI}' and '${SAMPAI}'`);
      const kunci = (d) => { const t0 = new Date(d + 'T00:00:00Z'); if (gran === 'BULAN') { t0.setUTCDate(1); } else { const hr = (t0.getUTCDay() + 6) % 7; t0.setUTCDate(t0.getUTCDate() - hr); } return t0.toISOString().slice(0, 10); };
      const grup = {};
      for (const s of sesi) { const k = kunci(s.d); (grup[k] ??= { terj: 0, terc: 0, baris: 0, hadir: 0 }); const g = grup[k]; g.terj++; if (s.baris > 0) g.terc++; g.baris += s.baris; g.hadir += s.hadir; }
      const harapTren = Object.keys(grup).sort().map((k) => { const g = grup[k]; const cak = bulat((100 * g.terc) / g.terj);
        return { periode_mulai: k, sesi_terjadwal: g.terj, sesi_tercatat: g.terc, cakupan_pct: cak, kehadiran_pct: cak >= 80 && g.baris > 0 ? bulat((100 * g.hadir) / g.baris) : null }; });
      sama(`tren ${gran} ${sekolahSemua.find((s) => s.school_id === id).name}`, tren, harapTren);
    }
  }

  // 4. kebocoran bidang: tidak ada nama wilayah lain / kecamatan di keluaran sekolah
  const teks = JSON.stringify(hasil.sekolah);
  const bocor = /kecamatan|kabupaten|provinsi/i.test(teks);
  bocor ? salah('keluaran per sekolah memuat kata kecamatan/kabupaten/provinsi') : ok('keluaran per sekolah hanya memuat nama sekolah (tanpa label wilayah)');
}

// ── Kualitas data yang mempengaruhi kepercayaan ──
console.log('\n== Kualitas data (seluruh basis data)');
const kq = jalan(`
 select 'absensi pada sesi yang bukan NORMAL (dihitung di hadir/baris, tidak di cakupan)' k, count(*)::text v from attendance a join teaching_schedules t on t.schedule_id=a.schedule_id where not a.is_void and t.meeting_status<>'NORMAL'
 union all select 'absensi dengan school_id berbeda dari sekolah jadwalnya', count(*)::text from attendance a join teaching_schedules t on t.schedule_id=a.schedule_id where a.school_id<>t.school_id
 union all select 'absensi pada sesi bertanggal masa depan', count(*)::text from attendance a join teaching_schedules t on t.schedule_id=a.schedule_id where t.session_date > fn_hari_ini()
 union all select 'sekolah berbagi ke kabupaten tanpa kabupaten_id', count(*)::text from schools where share_kabupaten and kabupaten_id is null
 union all select 'sekolah berbagi ke provinsi tanpa provinsi_id', count(*)::text from schools where share_provinsi and provinsi_id is null
 union all select 'sekolah berbagi ke kecamatan tanpa region_id', count(*)::text from schools where share_with_region and region_id is null
 union all select 'kabupaten_id menunjuk wilayah yang bukan KABUPATEN', count(*)::text from schools s join regions r on r.region_id=s.kabupaten_id where r.level<>'KABUPATEN'
 union all select 'provinsi_id menunjuk wilayah yang bukan PROVINSI', count(*)::text from schools s join regions r on r.region_id=s.provinsi_id where r.level<>'PROVINSI'
 union all select 'region_id menunjuk wilayah yang bukan KECAMATAN', count(*)::text from schools s join regions r on r.region_id=s.region_id where r.level<>'KECAMATAN'
 union all select 'siswa berstatus selain AKTIF/PKL (tidak dihitung)', count(*)::text from students where student_status not in ('AKTIF','PKL')
 union all select 'sesi berabsensi (jumlah)', count(distinct a.schedule_id)::text from attendance a where not a.is_void
 union all select 'baris absensi tidak batal (jumlah)', count(*)::text from attendance a where not a.is_void
 union all select 'baris absensi batal (is_void) yang tidak dihitung', count(*)::text from attendance a where a.is_void`);
for (const r of kq) console.log('  ' + String(r.v).padStart(8) + '  ' + r.k);
const buruk = kq.filter((r) => /tanpa|berbeda|bukan KECAMATAN|bukan KABUPATEN|bukan PROVINSI|masa depan/.test(r.k) && Number(r.v) > 0);
buruk.length ? salah('ada ketidakkonsistenan data: ' + buruk.map((r) => r.k).join('; ')) : ok('tidak ada ketidakkonsistenan hierarki/kepemilikan/tanggal pada data');

console.log(`\nREKONSILIASI: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
