/**
 * Pivot baris fn_portal_attendance ke blok pertemuan.
 * Satu block_group_id = satu pertemuan; slot = sesi individual di dalamnya.
 * EKSKUL dipetakan ke HADIR (kompat data lama).
 *
 * @param {Array} rows — hasil dari fn_portal_attendance RPC
 * @returns {Array} blok pertemuan dengan summary_status dan time_range
 */
export function pivotAttendanceBlocks(rows) {
    const blockMap = new Map();
    for (const sched of (rows ?? [])) {
        const att = (sched.attendance ?? [])[0];
        if (!att) continue;
        const key = sched.block_group_id ?? `${sched.session_date}_${sched.session_start}`;
        if (!blockMap.has(key)) {
            blockMap.set(key, {
                block_group_id: key,
                date:           sched.session_date,
                subject:        sched.subject?.name ?? 'KBM',
                teacher:        sched.teacher?.full_name ?? '—',
                slots:          [],
            });
        }
        blockMap.get(key).slots.push({
            start:  sched.session_start?.slice(0, 5),
            end:    sched.session_end?.slice(0, 5),
            status: att.status === 'EKSKUL' ? 'HADIR' : att.status,
            notes:  att.notes ?? '',
        });
    }

    return Array.from(blockMap.values()).map(block => {
        const statuses = block.slots.map(s => s.status);
        const unique   = [...new Set(statuses)];
        const summary  = unique.length === 1 ? unique[0] : 'CAMPURAN';
        const first    = block.slots[0];
        const last     = block.slots[block.slots.length - 1];
        return {
            ...block,
            time_range:     `${first.start} – ${last.end}`,
            summary_status: summary,
        };
    });
}
