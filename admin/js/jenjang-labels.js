/**
 * @file admin/js/jenjang-labels.js
 *
 * Menyesuaikan istilah yang tampil di portal admin dengan jenjang sekolah.
 * Antarmuka dibangun untuk SMK; untuk SMP/SMA beberapa istilah tidak berlaku.
 * Hanya mengganti TEKS yang terlihat (bukan nilai kolom isian, bukan atribut),
 * sehingga tidak memengaruhi data maupun logika. SMK tidak diubah sama sekali.
 *
 * Dimuat sebagai modul terpisah di halaman admin; gagal diam-diam bila belum
 * login atau jenjang belum diisi.
 */
import { supabase, getSchoolConfig } from './api.js';

const RULES = {
    SMP: [
        [/\bProgram Keahlian\b/g,  'Program'],
        [/\bKaprodi\b/g,           'Koordinator Program'],
        [/\bDUDI\b/g,              'Mitra Sekolah'],
        [/\b([Kk])elas XII\b/g,    '$1elas IX'],
        [/\bSIP SMK\b/g,           'SIP'],
    ],
    SMA: [
        [/\bProgram Keahlian\b/g,  'Peminatan'],
        [/\bKaprodi\b/g,           'Koordinator Peminatan'],
        [/\bDUDI\b/g,              'Mitra Sekolah'],
        [/\bSIP SMK\b/g,           'SIP'],
    ],
};

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

function rewriteNode(node, rules) {
    const before = node.nodeValue;
    if (!before || before.length < 3) return;
    let after = before;
    for (const [re, to] of rules) after = after.replace(re, to);
    if (after !== before) node.nodeValue = after;
}

function walk(root, rules) {
    if (root.nodeType === Node.TEXT_NODE) {
        const p = root.parentElement;
        if (p && !SKIP_TAGS.has(p.tagName) && !p.closest('[data-no-relabel]')) rewriteNode(root, rules);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName)) return;
    if (root.closest('[data-no-relabel]')) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            const p = n.parentElement;
            return p && !SKIP_TAGS.has(p.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
    });
    let n;
    while ((n = tw.nextNode())) rewriteNode(n, rules);
}

function apply(rules) {
    walk(document.body, rules);
    let queued = false;
    const pending = new Set();
    new MutationObserver((muts) => {
        for (const m of muts) {
            m.addedNodes.forEach((n) => pending.add(n));
            if (m.type === 'characterData') pending.add(m.target);
        }
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            const batch = [...pending]; pending.clear();
            batch.forEach((n) => walk(n, rules));
        });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function init() {
    for (let i = 0; i < 4; i++) {
        try {
            const { data: s } = await supabase.auth.getSession();
            if (s.session) {
                const cfg = await getSchoolConfig();
                if (cfg?.school_id) {
                    const { data } = await supabase.from('schools')
                        .select('jenjang').eq('school_id', cfg.school_id).maybeSingle();
                    const rules = RULES[data?.jenjang];
                    if (rules) apply(rules);
                    return;
                }
            }
        } catch (_) { /* coba lagi */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
