/**
 * @file manage-region/index.ts
 *
 * Pengelolaan wilayah (kecamatan) oleh SUPERADMIN platform:
 *   - daftar wilayah, sekolah, dan pegawai
 *   - buat wilayah
 *   - daftarkan / hapus pegawai wilayah (akun Supabase Auth, TANPA baris public.users)
 *   - tempatkan sekolah ke wilayah + tetapkan jenjang
 *
 * Auth: Header  X-Superadmin-Key: <SUPERADMIN_KEY>
 * Deploy: supabase functions deploy manage-region --no-verify-jwt --project-ref <ref>
 *
 * Request body (JSON), field "action":
 *   { action: "list" }
 *   { action: "ensure_region", kode, name, level }   -> buat dari daftar resmi bila belum ada (idempoten)
 *   { action: "delete_region", region_id }   -> selalu boleh: sekolah dilepas (persetujuan tingkat itu direset), pegawai + akun loginnya dihapus
 *   { action: "add_staff", region_id, full_name, email }      -> kata sandi sementara, tampil sekali
 *   { action: "remove_staff", auth_user_id }
 *   { action: "reset_staff_password", auth_user_id }   -> kata sandi sementara baru, tampil sekali
 *   { action: "assign_school", school_id, region_id|null, jenjang|null, kabupaten_id?, provinsi_id? }
 *     region_id = kecamatan sekolah; kabupaten_id/provinsi_id opsional (wilayah berjenis sesuai)
 *
 * PERSETUJUAN: fungsi ini TIDAK PERNAH mengubah schools.share_with_region menjadi true.
 * Persetujuan berbagi data adalah hak kepala sekolah. Memindahkan atau melepas sekolah
 * dari wilayah otomatis mengembalikan persetujuan tingkat yang berubah ke false
 * (share_with_region = kecamatan, share_kabupaten, share_provinsi); persetujuan lama
 * berlaku untuk wilayah lama.
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { internalError }           from '../_shared/response.ts';
import { getAdminClient }          from '../_shared/db.ts';

const JENJANG = ['SMP', 'SMA', 'SMK'] as const;
const LEVEL   = ['KECAMATAN', 'KABUPATEN', 'PROVINSI'] as const;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function randomPassword(len = 14): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map((b) => chars[b % chars.length]).join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        const body   = await req.json().catch(() => ({}));
        const action = String(body?.action ?? '');
        const admin  = getAdminClient();

        // ── list ──────────────────────────────────────────────
        if (action === 'list') {
            const [regions, schools, staff] = await Promise.all([
                admin.from('regions').select('region_id, name, level, kode').order('name'),
                admin.from('schools')
                     .select('school_id, name, slug, jenjang, region_id, kabupaten_id, provinsi_id, share_with_region, share_kabupaten, share_provinsi, is_active')
                     .order('name'),
                admin.from('region_staff').select('auth_user_id, region_id, full_name'),
            ]);
            for (const r of [regions, schools, staff]) if (r.error) throw r.error;

            // Email pegawai: dibaca dari Auth (hanya untuk tampilan operator)
            const emailById: Record<string, string> = {};
            for (const s of (staff.data ?? []) as { auth_user_id: string }[]) {
                const { data } = await admin.auth.admin.getUserById(s.auth_user_id);
                emailById[s.auth_user_id] = data?.user?.email ?? '—';
            }

            return json({
                regions: ((regions.data ?? []) as { region_id: string; name: string; level: string | null; kode: string | null }[]).map((g) => ({
                    ...g,
                    schools: ((schools.data ?? []) as { region_id: string | null }[])
                        .filter((s) => s.region_id === g.region_id),
                    staff: ((staff.data ?? []) as { auth_user_id: string; region_id: string; full_name: string }[])
                        .filter((s) => s.region_id === g.region_id)
                        .map((s) => ({ ...s, email: emailById[s.auth_user_id] })),
                })),
                schools_tanpa_wilayah: ((schools.data ?? []) as { region_id: string | null }[])
                    .filter((s) => s.region_id === null),
            });
        }

        // ── ensure_region ─────────────────────────────────────
        // Membuat wilayah dari daftar resmi bila belum ada (kunci: kode). Idempoten.
        // Panjang kode: provinsi 2, kabupaten/kota 4, kecamatan 7 digit.
        if (action === 'ensure_region') {
            const kode  = String(body?.kode ?? '').trim();
            const name  = String(body?.name ?? '').trim();
            const level = String(body?.level ?? '');
            if (!(LEVEL as readonly string[]).includes(level)) {
                return json({ error: 'level harus KECAMATAN, KABUPATEN, atau PROVINSI' }, 400);
            }
            const panjang = level === 'PROVINSI' ? 2 : level === 'KABUPATEN' ? 4 : 7;
            if (!/^[0-9]+$/.test(kode) || kode.length !== panjang) {
                return json({ error: `kode ${level} harus ${panjang} digit` }, 400);
            }
            if (name.length < 3 || name.length > 100) {
                return json({ error: 'name wajib 3-100 karakter' }, 400);
            }
            const { data: ada } = await admin.from('regions')
                .select('region_id, name, level, kode').eq('kode', kode).maybeSingle();
            if (ada) return json({ success: true, dibuat: false, region: ada });

            const { data, error } = await admin.from('regions')
                .insert({ name, level, kode }).select('region_id, name, level, kode').single();
            if (error) {
                if (error.code === '23505') return json({ error: `Wilayah "${name}" sudah ada dengan kode lain` }, 409);
                throw error;
            }
            return json({ success: true, dibuat: true, region: data });
        }

        // ── delete_region ─────────────────────────────────────
        // Wilayah adalah penanda cakupan, bukan komando: menghapusnya tidak pernah ditolak.
        //  * Sekolah yang bertanda wilayah ini (kecamatan, kabupaten, atau provinsi)
        //    dilepas dari penanda itu dan persetujuan berbagi tingkat itu direset ke false.
        //  * Pegawai wilayah ini dihapus beserta akun loginnya (sama dengan remove_staff).
        // Konfirmasi jumlah sekolah dan pegawai adalah tugas tampilan.
        if (action === 'delete_region') {
            const regionId = String(body?.region_id ?? '');
            if (!UUID_RE.test(regionId)) return json({ error: 'region_id tidak valid' }, 400);

            const { data: reg } = await admin.from('regions')
                .select('region_id, name, kode').eq('region_id', regionId).maybeSingle();
            if (!reg) return json({ error: 'wilayah tidak ditemukan' }, 404);

            const lepas = [
                ['region_id',    { region_id: null,    share_with_region: false }],
                ['kabupaten_id', { kabupaten_id: null, share_kabupaten: false }],
                ['provinsi_id',  { provinsi_id: null,  share_provinsi: false }],
            ] as const;
            const sekolahLepas = new Set<string>();
            for (const [kolom, patch] of lepas) {
                const { data, error } = await admin.from('schools').update(patch).eq(kolom, regionId).select('school_id');
                if (error) throw error;
                for (const s of data ?? []) sekolahLepas.add(s.school_id as string);
            }

            const { data: pegawai, error: pegErr } = await admin.from('region_staff')
                .select('auth_user_id').eq('region_id', regionId);
            if (pegErr) throw pegErr;
            for (const p of pegawai ?? []) {
                const { error: delStaffErr } = await admin.from('region_staff').delete().eq('auth_user_id', p.auth_user_id);
                if (delStaffErr) throw delStaffErr;
                await admin.auth.admin.deleteUser(p.auth_user_id as string);
            }

            const { error } = await admin.from('regions').delete().eq('region_id', regionId);
            if (error) throw error;
            return json({
                success: true, dihapus: reg.name,
                sekolah_dilepas: sekolahLepas.size, pegawai_dihapus: (pegawai ?? []).length,
            });
        }

        // ── add_staff ─────────────────────────────────────────
        if (action === 'add_staff') {
            const regionId = String(body?.region_id ?? '');
            const fullName = String(body?.full_name ?? '').trim();
            const email    = String(body?.email ?? '').trim().toLowerCase();
            if (!UUID_RE.test(regionId))           return json({ error: 'region_id tidak valid' }, 400);
            if (fullName.length < 3 || fullName.length > 150) return json({ error: 'full_name wajib 3-150 karakter' }, 400);
            if (!EMAIL_RE.test(email) || email.length > 254)  return json({ error: 'email tidak valid' }, 400);

            const { data: reg } = await admin.from('regions')
                .select('region_id').eq('region_id', regionId).maybeSingle();
            if (!reg) return json({ error: 'wilayah tidak ditemukan' }, 404);

            const password = randomPassword();
            const { data: created, error: authErr } = await admin.auth.admin.createUser({
                email, password, email_confirm: true,
                user_metadata: { must_change_password: true },   // wajib ganti saat masuk pertama
            });
            if (authErr || !created?.user) {
                const msg = String(authErr?.message ?? 'gagal membuat akun');
                const exists = /already|registered|exists/i.test(msg);
                return json({ error: exists ? `Email ${email} sudah terdaftar` : msg }, exists ? 409 : 400);
            }

            const { error: insErr } = await admin.from('region_staff').insert({
                auth_user_id: created.user.id, region_id: regionId, full_name: fullName,
            });
            if (insErr) {
                await admin.auth.admin.deleteUser(created.user.id); // rollback akun Auth
                throw insErr;
            }
            return json({
                success: true,
                email,
                full_name: fullName,
                password,
                note: 'Simpan kata sandi ini; tidak dapat dilihat lagi.',
            });
        }

        // ── remove_staff ──────────────────────────────────────
        if (action === 'remove_staff') {
            const authId = String(body?.auth_user_id ?? '');
            if (!UUID_RE.test(authId)) return json({ error: 'auth_user_id tidak valid' }, 400);
            const { data: row } = await admin.from('region_staff')
                .select('auth_user_id').eq('auth_user_id', authId).maybeSingle();
            if (!row) return json({ error: 'pegawai wilayah tidak ditemukan' }, 404);

            const { error: delErr } = await admin.from('region_staff').delete().eq('auth_user_id', authId);
            if (delErr) throw delErr;
            await admin.auth.admin.deleteUser(authId);
            return json({ success: true });
        }

        // ── reset_staff_password ──────────────────────────────
        // Kata sandi sementara baru, tampil sekali. Hanya akun yang terdaftar di region_staff.
        if (action === 'reset_staff_password') {
            const authId = String(body?.auth_user_id ?? '');
            if (!UUID_RE.test(authId)) return json({ error: 'auth_user_id tidak valid' }, 400);
            const { data: row } = await admin.from('region_staff')
                .select('auth_user_id, full_name').eq('auth_user_id', authId).maybeSingle();
            if (!row) return json({ error: 'pegawai wilayah tidak ditemukan' }, 404);

            const password = randomPassword();
            const { data: lama } = await admin.auth.admin.getUserById(authId);
            const { data: upd, error: updErr } = await admin.auth.admin.updateUserById(authId, {
                password,
                user_metadata: { ...(lama?.user?.user_metadata ?? {}), must_change_password: true },
            });
            if (updErr || !upd?.user) throw updErr ?? new Error('gagal mengubah kata sandi');
            return json({
                success: true,
                email: upd.user.email ?? '—',
                full_name: row.full_name,
                password,
                note: 'Simpan kata sandi ini; tidak dapat dilihat lagi.',
            });
        }

        // ── assign_school ─────────────────────────────────────
        if (action === 'assign_school') {
            const schoolId = String(body?.school_id ?? '');
            const regionId = body?.region_id == null || body.region_id === '' ? null : String(body.region_id);
            const jenjang  = body?.jenjang   == null || body.jenjang   === '' ? null : String(body.jenjang);
            if (!UUID_RE.test(schoolId)) return json({ error: 'school_id tidak valid' }, 400);
            if (regionId !== null && !UUID_RE.test(regionId)) return json({ error: 'region_id tidak valid' }, 400);
            if (jenjang !== null && !(JENJANG as readonly string[]).includes(jenjang)) {
                return json({ error: 'jenjang harus SMP, SMA, atau SMK' }, 400);
            }

            const { data: school } = await admin.from('schools')
                .select('school_id, jenjang, region_id, kabupaten_id, provinsi_id').eq('school_id', schoolId).maybeSingle();
            if (!school) return json({ error: 'sekolah tidak ditemukan' }, 404);
            if (regionId !== null) {
                const { data: reg } = await admin.from('regions')
                    .select('region_id').eq('region_id', regionId).maybeSingle();
                if (!reg) return json({ error: 'wilayah tidak ditemukan' }, 404);
            }

            // Tiga penanda (kecamatan, kabupaten, provinsi) berdiri sendiri: kunci tidak dikirim =
            // tidak diubah; dikirim kosong/null = dikosongkan. Memutus satu tingkat tidak menyentuh yang lain.
            const regionTarget  = 'region_id' in (body ?? {}) ? regionId : ((school.region_id ?? null) as string | null);
            const jenjangTarget = 'jenjang'   in (body ?? {}) ? jenjang  : ((school.jenjang ?? null) as string | null);
            const pilihTingkat = async (key: 'kabupaten_id' | 'provinsi_id', level: string) => {
                if (!(key in (body ?? {}))) return { value: (school[key] ?? null) as string | null };
                const raw = body[key] == null || body[key] === '' ? null : String(body[key]);
                if (raw === null) return { value: null as string | null };
                if (!UUID_RE.test(raw)) return { error: `${key} tidak valid` };
                const { data: reg } = await admin.from('regions')
                    .select('region_id, level').eq('region_id', raw).maybeSingle();
                if (!reg) return { error: `${key}: wilayah tidak ditemukan` };
                if (reg.level !== level) return { error: `${key} harus wilayah berjenis ${level}` };
                return { value: raw as string | null };
            };
            const kab  = await pilihTingkat('kabupaten_id', 'KABUPATEN');
            if ('error' in kab && kab.error) return json({ error: kab.error }, 400);
            const prov = await pilihTingkat('provinsi_id', 'PROVINSI');
            if ('error' in prov && prov.error) return json({ error: prov.error }, 400);
            const kabupatenId = (kab as { value: string | null }).value;
            const provinsiId  = (prov as { value: string | null }).value;

            // Persetujuan tiap tingkat berlaku untuk wilayah yang disetujui: reset hanya pada
            // tingkat yang wilayahnya berubah.
            const kecBerubah  = (school.region_id ?? null)    !== regionTarget;
            const kabBerubah  = (school.kabupaten_id ?? null) !== kabupatenId;
            const provBerubah = (school.provinsi_id ?? null)  !== provinsiId;
            const wilayahBerubah = kecBerubah || kabBerubah || provBerubah;
            const patch: Record<string, unknown> = {
                region_id: regionTarget, kabupaten_id: kabupatenId, provinsi_id: provinsiId, jenjang: jenjangTarget,
            };
            if (kecBerubah)  patch.share_with_region = false;
            if (kabBerubah)  patch.share_kabupaten   = false;
            if (provBerubah) patch.share_provinsi    = false;

            const { error } = await admin.from('schools').update(patch).eq('school_id', schoolId);
            if (error) throw error;
            return json({ success: true, persetujuan_direset: wilayahBerubah });
        }

        return json({ error: 'action tidak dikenal' }, 400);
    } catch (err) {
        return internalError(err);
    }
});
