export const FORMULA_VERSION = "1.2";
export const BLOC_CBW_CAP = 12; // rule H-13
export const CBW_TOKEN_CAP_PER_COUNTRY = 6;
export const BALLS_CAP = 60;
export const REACH_UNIT_M = 12.5; // rule H-04
export const TREATIES = ["NPT", "CTBT", "BWC", "CWC", "TPNW"];
const RANGE = { NONE: 0, SHORT: 1, MEDIUM: 2, INTERMEDIATE: 3, INTERCONTINENTAL: 4 };
const CAP_CURRENT = {
    NONE_DOCUMENTED: 0, RESEARCH_ABANDONED: 1, FORMER_DISMANTLED: 1, FORMER_TRANSFERRED: 1,
    SUSPECTED: 2, ACTIVE_UNACKNOWLEDGED: 3, ACTIVE_ACKNOWLEDGED: 4,
};
const CAP_PEAK = { ...CAP_CURRENT, FORMER_DISMANTLED: 3, FORMER_TRANSFERRED: 3 };
const TS_POINTS = { PARTY: 2, SIGNATORY_NOT_RATIFIED: 1 };
/** Round half up, as documented in the dossier. */
export const rhu = (x) => Math.floor(x + 0.5);
export function ballsFor(W) {
    return W === 0 ? 0 : Math.min(BALLS_CAP, Math.max(1, rhu(Math.sqrt(W) / 2)));
}
export function derive(c, profile) {
    const st = c.stockpile;
    const W = (profile === "CURRENT" ? st.nuclear_warheads?.value : st.nuclear_warheads_peak?.value) ?? 0;
    const BALLS = ballsFor(W);
    let REACH = RANGE[(c.delivery?.max_range_class ?? "NONE")] ?? 0;
    if (c.sharing?.nuclear_sharing_host)
        REACH = Math.max(REACH, 2);
    const table = profile === "PEAK" ? CAP_PEAK : CAP_CURRENT;
    const cap = (cat) => {
        const p = c.programs[cat];
        const s = profile === "PEAK" ? (p?.peak_status ?? p?.status) : p?.status;
        return s ? table[s] ?? 0 : 0;
    };
    const CAP_N = cap("nuclear"), CAP_B = cap("biological"), CAP_C = cap("chemical"), CAP_R = cap("radiological");
    let pts = 0, appl = 0;
    for (const t of TREATIES) {
        const v = c.treaties?.[t];
        if (v === "NOT_APPLICABLE")
            continue;
        appl += 1;
        pts += TS_POINTS[v ?? ""] ?? 0;
    }
    const RESTRAINT = appl ? rhu((pts * 10) / (2 * appl)) : 0;
    let STAGED = 0;
    const sh = c.sharing;
    if (profile === "CURRENT" && sh?.nuclear_sharing_host && sh.hosted_by?.length) {
        const H = sh.hosted_warheads?.value;
        STAGED = H ? Math.max(1, rhu(Math.sqrt(H) / 2)) : 1;
    }
    return {
        W, BALLS, REACH, CAP_N, CAP_B, CAP_C, CAP_R, RESTRAINT,
        RESTRAINT_points: pts, RESTRAINT_applicable: appl,
        SECOND_STRIKE: Boolean(c.delivery?.sea_ballistic),
        CBW_TOKENS: Math.min(CBW_TOKEN_CAP_PER_COUNTRY, CAP_B + CAP_C),
        STAGED,
    };
}
