/**
 * @file shared/jenjang-ui.js
 *
 * Menyembunyikan bagian antarmuka yang konsepnya tidak ada di jenjang sekolah.
 * Portal dibangun untuk SMK; PKL dan mitra DUDI tidak berlaku di SMP/SMA.
 * Prinsip: TIDAK mengganti nama konsep menjadi istilah karangan — hanya
 * menyembunyikan. SMK tidak diubah sama sekali. Data dan logika tidak disentuh.
 *
 * Dipakai oleh portal guru, siswa, orang tua, dan TU:
 *   import { initJenjangUi } from '../../shared/jenjang-ui.js';
 *   initJenjangUi(supabase);
 */

// Konsep yang tidak ada di jenjang tersebut.
const HIDE = {
    SMP: ['pkl'],
    SMA: ['pkl'],
};

// Pemilih CSS langsung (disembunyikan lewat stylesheet agar tetap tersembunyi
// walau aplikasi mengubah style elemen itu belakangan).
const SELECTORS = {
    pkl: [
        '[data-tab="section-pkl"]',      // orang tua: tab + bottom nav
        '#section-pkl',
        '#tab-pkl',                      // siswa
        '[data-tab="pkl"]',
        '#tab-waka_humas',               // guru: tab Waka Humas (seluruhnya PKL/DUDI)
        '[data-tab="waka_humas"]',
        'option[value="PKL"]',           // filter jalur kasus
    ],
};

// Akordeon guru yang dikenali lewat target isinya.
const ACCORDION_TARGETS = {
    pkl: ['kp-body-dudi', 'kp-body-placement', 'kp-body-students', 'kp-body-pkl'],
};

const STYLE_ID = 'jenjang-ui-style';
const ATTR = 'data-jenjang-hidden';

function applyHide(concepts) {
    const sels = concepts.flatMap((c) => SELECTORS[c] ?? []);
    if (!document.getElementById(STYLE_ID) && sels.length) {
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = sels.join(',\n') + ' { display: none !important; }\n' +
                         `[${ATTR}] { display: none !important; }`;
        document.head.appendChild(st);
    }
    const mark = () => {
        for (const c of concepts) {
            for (const target of ACCORDION_TARGETS[c] ?? []) {
                document.querySelectorAll(`[data-target="${target}"]`).forEach((h) => {
                    const item = h.closest('.kp-acc-item') ?? h.parentElement;
                    if (item) item.setAttribute(ATTR, '');
                });
            }
        }
        document.querySelectorAll('option[value="PKL"]').forEach((o) => { o.hidden = true; });
    };
    mark();
    new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
}

export async function initJenjangUi(supabase) {
    for (let i = 0; i < 8; i++) {
        try {
            const { data: s } = await supabase.auth.getSession();
            if (s.session) {
                const { data: sid } = await supabase.rpc('fn_current_school_id');
                if (sid) {
                    const { data } = await supabase.from('schools')
                        .select('jenjang').eq('school_id', sid).maybeSingle();
                    const concepts = HIDE[data?.jenjang];
                    if (concepts) applyHide(concepts);
                    return;
                }
            }
        } catch (_) { /* coba lagi */ }
        await new Promise((r) => setTimeout(r, 1500));
    }
}
