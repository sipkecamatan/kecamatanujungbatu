/**
 * @file _shared/forum-cleanup.ts
 *
 * Pembersihan konten Forum milik satu pengguna SEBELUM baris users dihapus (audit Forum A-06).
 *
 * Latar belakang: forum_posts.author_user_id dan forum_post_comments.author_user_id berkunci asing ON DELETE RESTRICT, sehingga
 * `DELETE FROM users` ditolak database bila pengguna pernah menulis komentar atau posting. delete-user hanya memeriksa posting aktif dan
 * purge-user tidak memeriksa apa pun, jadi penghapusan berakhir dengan galat 500 dan akun tertinggal setengah dibersihkan.
 *
 * Yang dilakukan (urutan penting, meniru fn_delete_forum_post):
 *   1. Posting milik pengguna (hanya yang ditarik bila onlyWithdrawn): hapus notifikasinya lebih dulu (FK notifications.forum_post_id SET NULL
 *      meninggalkan rujukan kosong), lalu hapus posting (audiens, komentar, konfirmasi baca ikut terhapus lewat CASCADE).
 *   2. Komentar milik pengguna di posting orang lain.
 *   3. Berkas lampiran posting yang dihapus dibuang dari bucket forum-attachments (galat dilaporkan, tidak menggagalkan penghapusan akun).
 * Konfirmasi baca dan penerima milik pengguna sudah ON DELETE CASCADE.
 *
 * onlyWithdrawn = true  : dipakai delete-user (posting aktif sudah ditolak lebih awal; sisanya hanya posting yang ditarik).
 * onlyWithdrawn = false : dipakai purge-user (akun sudah di-soft-delete; seluruh posting ikut dihapus).
 */

const BATCH_SIZE = 200;
const STORAGE_BATCH = 100;

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type ForumCleanupResult = {
    deletedPosts: number;
    storageRemoved: number;
    storageError: string | null;
};

/**
 * Audit Forum A-07: satu putaran penghapusan berkas lampiran SATU SEKOLAH (folder = school_id di bucket forum-attachments), dipakai delete-school.
 * Mengembalikan jumlah berkas yang dihapus (0 = folder sudah kosong). Galat daftar/hapus, atau berkas yang terhapus kurang dari yang diminta,
 * dilempar sebagai Error agar pemanggil berhenti (tidak berputar tanpa akhir) dan dapat melanjutkan lewat resume.
 */
export async function removeForumAttachmentBatch(admin: AdminClient, schoolId: string, batchSize = STORAGE_BATCH): Promise<number> {
    const { data: files, error: listError } = await admin.storage.from('forum-attachments').list(schoolId, { limit: batchSize, offset: 0 });
    if (listError) throw new Error(`Gagal membaca lampiran forum: ${listError.message}`);
    // Entri sub-folder tidak punya id; berkas lampiran selalu langsung di bawah folder sekolah.
    const names = ((files ?? []) as { name?: string; id?: string | null }[]).filter(f => f.name && f.id).map(f => `${schoolId}/${f.name}`);
    if (!names.length) return 0;
    const { data: removed, error: removeError } = await admin.storage.from('forum-attachments').remove(names);
    if (removeError) throw new Error(`Gagal menghapus lampiran forum: ${removeError.message}`);
    if ((removed?.length ?? 0) < names.length) {
        throw new Error(`Lampiran forum tidak seluruhnya terhapus (${removed?.length ?? 0} dari ${names.length}).`);
    }
    return names.length;
}

export async function cleanupUserForumContent(
    admin: AdminClient,
    userId: string,
    schoolId: string,
    opts: { onlyWithdrawn: boolean },
): Promise<ForumCleanupResult> {
    const paths: string[] = [];
    let deletedPosts = 0;

    while (true) {
        let q = admin.from('forum_posts')
            .select('post_id, attachment_path')
            .eq('author_user_id', userId)
            .eq('school_id', schoolId)
            .limit(BATCH_SIZE);
        if (opts.onlyWithdrawn) q = q.eq('is_withdrawn', true);
        const { data: posts, error: selErr } = await q;
        if (selErr) throw new Error(`Gagal membaca posting forum: ${selErr.message}`);
        if (!posts?.length) break;

        const ids = posts.map((p: { post_id: string }) => p.post_id);
        for (const p of posts as { attachment_path: string | null }[]) {
            if (p.attachment_path) paths.push(p.attachment_path);
        }

        const { error: notifErr } = await admin.from('notifications').delete()
            .in('forum_post_id', ids).eq('school_id', schoolId);
        if (notifErr) throw new Error(`Gagal menghapus notifikasi forum: ${notifErr.message}`);

        const { error: delErr } = await admin.from('forum_posts').delete()
            .in('post_id', ids).eq('school_id', schoolId);
        if (delErr) throw new Error(`Gagal menghapus posting forum: ${delErr.message}`);
        deletedPosts += ids.length;
        if (ids.length < BATCH_SIZE) break;
    }

    const { error: cmtErr } = await admin.from('forum_post_comments').delete()
        .eq('author_user_id', userId).eq('school_id', schoolId);
    if (cmtErr) throw new Error(`Gagal menghapus komentar forum: ${cmtErr.message}`);

    let storageRemoved = 0;
    let storageError: string | null = null;
    for (let i = 0; i < paths.length; i += STORAGE_BATCH) {
        const chunk = paths.slice(i, i + STORAGE_BATCH);
        const { data, error } = await admin.storage.from('forum-attachments').remove(chunk);
        if (error) { storageError = error.message; break; }
        storageRemoved += data?.length ?? 0;
        if ((data?.length ?? 0) < chunk.length) {
            storageError = `Hanya ${data?.length ?? 0} dari ${chunk.length} lampiran yang terhapus.`;
        }
    }

    return { deletedPosts, storageRemoved, storageError };
}
