// Uji fungsi pembersihan forum (supabase/functions/_shared/forum-cleanup.ts; audit Forum A-06 dan A-07) dengan klien admin TIRUAN di memori: urutan operasi,
// filter sekolah/pengguna, mode onlyWithdrawn, paginasi, pelaporan galat Storage, dan putaran penghapusan berkas sekolah.
// Pakai: deno test --no-lock tests/forum-cleanup.test.ts
import { cleanupUserForumContent, removeForumAttachmentBatch } from '../supabase/functions/_shared/forum-cleanup.ts';

function eq(a: unknown, b: unknown, msg: string) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  didapat: ${JSON.stringify(a)}\n  harap:   ${JSON.stringify(b)}`);
}

type Op = { op: string; table?: string; filters: Record<string, unknown> };

/** Klien tiruan: tabel berisi baris; select/delete menerapkan filter eq/in; storage menyimpan daftar nama. */
function tiruan(init: { posts?: Record<string, unknown>[]; comments?: Record<string, unknown>[]; files?: Record<string, string[]>; storageGagal?: 'hapus-sebagian' | 'galat' | null }) {
    const tabel: Record<string, Record<string, unknown>[]> = {
        forum_posts: init.posts ?? [], forum_post_comments: init.comments ?? [], notifications: [
            ...(init.posts ?? []).map((p) => ({ notification_id: 'n-' + p.post_id, forum_post_id: p.post_id, school_id: p.school_id })),
        ],
    };
    const files = init.files ?? {};
    const log: Op[] = [];
    const builder = (name: string) => {
        const filters: Record<string, unknown> = {};
        const ins: Record<string, unknown[]> = {};
        let mode: 'select' | 'delete' = 'select'; let lim = Infinity;
        const cocok = (r: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => r[k] === v) && Object.entries(ins).every(([k, vs]) => vs.includes(r[k]));
        const jalan = () => {
            const baris = tabel[name].filter(cocok);
            if (mode === 'select') { return { data: baris.slice(0, lim).map((r) => ({ ...r })), error: null }; }
            log.push({ op: 'delete', table: name, filters: { ...filters, ...Object.fromEntries(Object.entries(ins).map(([k, v]) => [k + ' in', v])) } });
            tabel[name] = tabel[name].filter((r) => !cocok(r));
            return { data: null, error: null };
        };
        // deno-lint-ignore no-explicit-any
        const q: any = {
            select() { mode = 'select'; return q; }, delete() { mode = 'delete'; return q; },
            eq(k: string, v: unknown) { filters[k] = v; return q; }, in(k: string, v: unknown[]) { ins[k] = v; return q; },
            limit(n: number) { lim = n; return q; },
            then(res: (v: unknown) => unknown) { return Promise.resolve(jalan()).then(res); },
        };
        return q;
    };
    const admin = {
        from: builder,
        storage: {
            from: (_bucket: string) => ({
                list: (folder: string, o: { limit: number }) => Promise.resolve({ data: (files[folder] ?? []).slice(0, o.limit).map((n) => ({ name: n, id: n === 'subfolder' ? null : 'id-' + n })), error: null }),
                remove: (names: string[]) => {
                    log.push({ op: 'storage.remove', filters: { names } });
                    if (init.storageGagal === 'galat') return Promise.resolve({ data: null, error: { message: 'storage mati' } });
                    const hapus = init.storageGagal === 'hapus-sebagian' ? names.slice(0, Math.max(0, names.length - 1)) : names;
                    for (const k of Object.keys(files)) files[k] = files[k].filter((n) => !hapus.includes(`${k}/${n}`));
                    return Promise.resolve({ data: hapus.map((n) => ({ name: n })), error: null });
                },
            }),
        },
    };
    return { admin, log, tabel, files };
}

Deno.test('hapus pengguna: notifikasi dihapus sebelum posting, lalu komentar; filter sekolah dan penulis; hanya posting ditarik bila onlyWithdrawn', async () => {
    const t = tiruan({
        posts: [
            { post_id: 'p1', author_user_id: 'X', school_id: 'S', is_withdrawn: true, attachment_path: 'S/a.pdf' },
            { post_id: 'p2', author_user_id: 'X', school_id: 'S', is_withdrawn: false, attachment_path: 'S/b.pdf' },   // aktif: TIDAK boleh dihapus pada onlyWithdrawn
            { post_id: 'p3', author_user_id: 'Y', school_id: 'S', is_withdrawn: true, attachment_path: null },       // penulis lain
            { post_id: 'p4', author_user_id: 'X', school_id: 'LAIN', is_withdrawn: true, attachment_path: 'LAIN/c.pdf' }, // sekolah lain
        ],
        comments: [
            { comment_id: 'c1', author_user_id: 'X', school_id: 'S' }, { comment_id: 'c2', author_user_id: 'Y', school_id: 'S' }, { comment_id: 'c3', author_user_id: 'X', school_id: 'LAIN' },
        ],
        files: { S: ['a.pdf', 'b.pdf'] },
    });
    const r = await cleanupUserForumContent(t.admin, 'X', 'S', { onlyWithdrawn: true });
    eq(t.tabel.forum_posts.map((p) => p.post_id).sort(), ['p2', 'p3', 'p4'], 'hanya p1 yang seharusnya terhapus');
    eq(t.tabel.forum_post_comments.map((c) => c.comment_id).sort(), ['c2', 'c3'], 'hanya komentar X di sekolah S yang terhapus');
    eq(t.tabel.notifications.map((n) => n.forum_post_id).sort(), ['p2', 'p3', 'p4'], 'notifikasi p1 harus terhapus');
    const urutan = t.log.map((o) => o.op === 'delete' ? o.table : o.op);
    eq(urutan, ['notifications', 'forum_posts', 'forum_post_comments', 'storage.remove'], 'urutan operasi');
    eq(t.log.find((o) => o.op === 'storage.remove')!.filters, { names: ['S/a.pdf'] }, 'hanya lampiran p1 yang dibuang');
    eq(r, { deletedPosts: 1, storageRemoved: 1, storageError: null }, 'hasil');
});

Deno.test('purge: seluruh posting pengguna ikut dihapus (onlyWithdrawn=false)', async () => {
    const t = tiruan({ posts: [
        { post_id: 'p1', author_user_id: 'X', school_id: 'S', is_withdrawn: true, attachment_path: 'S/a.pdf' },
        { post_id: 'p2', author_user_id: 'X', school_id: 'S', is_withdrawn: false, attachment_path: null },
    ], files: { S: ['a.pdf'] } });
    const r = await cleanupUserForumContent(t.admin, 'X', 'S', { onlyWithdrawn: false });
    eq(t.tabel.forum_posts, [], 'semua posting X seharusnya terhapus');
    eq(r.deletedPosts, 2, 'jumlah posting');
});

Deno.test('lebih dari satu halaman posting: semua terhapus (200 per putaran)', async () => {
    const posts = Array.from({ length: 450 }, (_, i) => ({ post_id: 'p' + i, author_user_id: 'X', school_id: 'S', is_withdrawn: true, attachment_path: null }));
    const t = tiruan({ posts });
    const r = await cleanupUserForumContent(t.admin, 'X', 'S', { onlyWithdrawn: true });
    eq(t.tabel.forum_posts.length, 0, 'sisa posting'); eq(r.deletedPosts, 450, 'jumlah');
});

Deno.test('galat Storage dilaporkan tetapi tidak menggagalkan pembersihan database; penghapusan sebagian ditandai', async () => {
    const a = tiruan({ posts: [{ post_id: 'p1', author_user_id: 'X', school_id: 'S', is_withdrawn: true, attachment_path: 'S/a.pdf' }], files: { S: ['a.pdf'] }, storageGagal: 'galat' });
    const ra = await cleanupUserForumContent(a.admin, 'X', 'S', { onlyWithdrawn: true });
    eq(a.tabel.forum_posts.length, 0, 'posting tetap terhapus'); eq(ra.storageError, 'storage mati', 'galat tercatat');
    const b = tiruan({ posts: [
        { post_id: 'p1', author_user_id: 'X', school_id: 'S', is_withdrawn: true, attachment_path: 'S/a.pdf' },
        { post_id: 'p2', author_user_id: 'X', school_id: 'S', is_withdrawn: true, attachment_path: 'S/b.pdf' },
    ], files: { S: ['a.pdf', 'b.pdf'] }, storageGagal: 'hapus-sebagian' });
    const rb = await cleanupUserForumContent(b.admin, 'X', 'S', { onlyWithdrawn: true });
    if (!rb.storageError || !rb.storageError.includes('1 dari 2')) throw new Error('penghapusan sebagian tidak ditandai: ' + rb.storageError);
});

Deno.test('delete-school: berkas folder sekolah dihapus per putaran sampai kosong; sub-folder dilewati; folder sekolah lain utuh', async () => {
    const isi = Array.from({ length: 250 }, (_, i) => `f${i}.pdf`);
    const t = tiruan({ files: { S: [...isi, 'subfolder'], LAIN: ['x.pdf'] } });
    let total = 0, putaran = 0;
    while (true) { const n = await removeForumAttachmentBatch(t.admin, 'S', 100); if (n === 0) break; total += n; putaran++; if (putaran > 10) throw new Error('berputar tanpa akhir'); }
    eq(total, 250, 'jumlah berkas terhapus'); eq(putaran, 3, 'putaran (100+100+50)');
    eq(t.files.S, ['subfolder'], 'hanya sub-folder yang tersisa'); eq(t.files.LAIN, ['x.pdf'], 'sekolah lain utuh');
    eq(await removeForumAttachmentBatch(t.admin, 'S', 100), 0, 'idempoten: putaran berikutnya 0');
});

Deno.test('delete-school: galat Storage atau penghapusan tidak lengkap dilempar (bukan berputar selamanya)', async () => {
    for (const mode of ['galat', 'hapus-sebagian'] as const) {
        const t = tiruan({ files: { S: ['a.pdf', 'b.pdf'] }, storageGagal: mode });
        let lempar = false;
        try { await removeForumAttachmentBatch(t.admin, 'S', 100); } catch { lempar = true; }
        if (!lempar) throw new Error(`mode ${mode}: seharusnya melempar galat`);
    }
});
