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
 *   { action: "create_region", name }
 *   { action: "add_staff", region_id, full_name, email }      -> kata sandi sementara, tampil sekali
 *   { action: "remove_staff", auth_user_id }
 *   { action: "assign_school", school_id, region_id|null, jenjang|null }
 *
 * PERSETUJUAN: fungsi ini TIDAK PERNAH mengubah schools.share_with_region menjadi true.
 * Persetujuan berbagi data adalah hak kepala sekolah. Memindahkan atau melepas sekolah
 * dari wilayah otomatis mengembalikan share_with_region ke false (persetujuan lama
 * berlaku untuk wilayah lama).
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { internalError }           from '../_shared/response.ts';
import { getAdminClient }          from '../_shared/db.ts';

const JENJANG = ['SMP', 'SMA', 'SMK'] as const;
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
                admin.from('regions').select('region_id, name').order('name'),
                admin.from('schools')
                     .select('school_id, name, slug, jenjang, region_id, share_with_region, is_active')
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
                regions: ((regions.data ?? []) as { region_id: string; name: string }[]).map((g) => ({
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

        // ── create_region ─────────────────────────────────────
        if (action === 'create_region') {
            const name = String(body?.name ?? '').trim();
            if (name.length < 3 || name.length > 100) {
                return json({ error: 'name wajib 3-100 karakter' }, 400);
            }
            const { data, error } = await admin.from('regions')
                .insert({ name }).select('region_id, name').single();
            if (error) {
                if (error.code === '23505') return json({ error: `Wilayah "${name}" sudah ada` }, 409);
                throw error;
            }
            return json({ success: true, region: data });
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
                .select('school_id, region_id').eq('school_id', schoolId).maybeSingle();
            if (!school) return json({ error: 'sekolah tidak ditemukan' }, 404);
            if (regionId !== null) {
                const { data: reg } = await admin.from('regions')
                    .select('region_id').eq('region_id', regionId).maybeSingle();
                if (!reg) return json({ error: 'wilayah tidak ditemukan' }, 404);
            }

            // Persetujuan lama berlaku untuk wilayah lama: reset bila wilayah berubah.
            const wilayahBerubah = (school.region_id ?? null) !== regionId;
            const patch: Record<string, unknown> = { region_id: regionId, jenjang };
            if (wilayahBerubah) patch.share_with_region = false;

            const { error } = await admin.from('schools').update(patch).eq('school_id', schoolId);
            if (error) throw error;
            return json({ success: true, persetujuan_direset: wilayahBerubah });
        }

        return json({ error: 'action tidak dikenal' }, 400);
    } catch (err) {
        return internalError(err);
    }
});
