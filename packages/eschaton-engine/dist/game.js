// ESCHATON rules engine: builds a match from the ledger and enforces house rules H-01 to H-13.
// State is a plain JSON-serialisable object, so a server can own it and clients can render it.
// Every action returns a NEW state (the input is never mutated) plus an event for the log.
import { REACH_UNIT_M } from "./derive.js";
export class RuleError extends Error {
    rule;
    constructor(rule, message) {
        super(`${rule}: ${message}`);
        this.rule = rule;
    }
}
const clone = (x) => structuredClone(x);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Build a match. The profile cannot change afterwards (H-01). */
export function createGame(L, profile, opts = {}) {
    const combatants = {};
    const combatantOf = {};
    for (const b of L.blocs[profile]) {
        const ids = b.code === "NONALIGN" ? b.members.map((m) => `NONALIGN:${m}`) : [b.code]; // H-10
        for (const id of ids) {
            const members = b.code === "NONALIGN" ? [id.split(":")[1]] : b.members;
            const tokens = members.reduce((s, m) => s + (L.countries.find((c) => c.id === m).eschaton[profile].CBW_TOKENS), 0);
            combatants[id] = {
                id, bloc: b.code, name: b.code === "NONALIGN" ? `${b.name}: ${members[0]}` : b.name, color: b.color_hex,
                members, cbwStock: b.code === "NONALIGN" ? tokens : b.cbw_stock, cbwUsedOnTurn: null, restraintPenalty: 0,
            };
            for (const m of members)
                combatantOf[m] = id;
        }
    }
    const countries = {};
    for (const c of L.countries) {
        const e = c.eschaton[profile], z = c.eschaton.zone;
        countries[c.id] = {
            id: c.id, name: c.name, combatant: combatantOf[c.id], x: z.x_m, y: z.y_m, r: z.radius_m,
            reach: e.REACH, secondStrike: e.SECOND_STRIKE, restraint: e.RESTRAINT,
            homeBalls: e.BALLS, struck: false, hitsTaken: 0,
        };
    }
    // H-11: under CURRENT each host holds STAGED of its provider's balls; they are drawn from the provider's BALLS.
    const staged = [];
    for (const c of L.countries) {
        const n = c.eschaton[profile].STAGED;
        if (!n)
            continue;
        const provider = c.sharing.hosted_by[0];
        const p = countries[provider];
        const take = Math.min(n, p.homeBalls);
        p.homeBalls -= take;
        staged.push({ host: c.id, provider, combatant: p.combatant, reach: p.reach, count: take });
    }
    let ids = Object.keys(combatants);
    if (opts.include)
        ids = ids.filter((id) => opts.include.includes(id));
    const order = opts.order ? opts.order.filter((id) => ids.includes(id)) : ids;
    for (const id of Object.keys(combatants))
        if (!ids.includes(id))
            delete combatants[id];
    let s = {
        profile, formulaVersion: L.meta.formula_version, turn: 1, order, active: 0,
        combatants, countries, staged, shots: [], cbw: [],
    };
    if (opts.skipIdle !== false && !canAct(s, order[0]))
        s = advance(s, true);
    return s;
}
export const activeCombatant = (s) => s.order[s.active];
/** Total balls a combatant still holds: home balls of members plus its staged balls (H-02, H-11). */
export function ballsRemaining(s, combatant) {
    const c = s.combatants[combatant];
    return c.members.reduce((n, m) => n + s.countries[m].homeBalls, 0)
        + s.staged.filter((st) => st.combatant === combatant).reduce((n, st) => n + st.count, 0);
}
/** True if the combatant has anything it could still do: launch a ball or spend a CBW token (H-12). */
export function canAct(s, combatant) {
    const c = s.combatants[combatant];
    if (!c)
        return false;
    const launchable = c.members.some((m) => s.countries[m].homeBalls > 0 && (!s.countries[m].struck || s.countries[m].secondStrike))
        || s.staged.some((st) => st.combatant === combatant && st.count > 0);
    return launchable || c.cbwStock > 0;
}
function inReach(from, to, reach) {
    if (reach >= 4)
        return true; // H-04: REACH 4 is unlimited
    return dist(from, to) <= reach * REACH_UNIT_M;
}
/** Countries the given launch point may target (H-04 reach, H-10 no allied targets). */
export function legalTargets(s, combatant, origin, fromStaged = false) {
    const o = s.countries[origin];
    const reach = fromStaged ? s.staged.find((st) => st.host === origin && st.combatant === combatant)?.reach ?? 0 : o.reach;
    return Object.values(s.countries)
        .filter((t) => t.combatant !== combatant && s.combatants[t.combatant] && inReach(o, t, reach)) // excluded blocs are neutral
        .map((t) => t.id);
}
/** The zone a landing point strikes (H-03): first bounce inside a zone circle; nearest centre wins on overlap. */
export function zoneAt(s, p) {
    let best = null, bestD = Infinity;
    for (const c of Object.values(s.countries)) {
        const d = dist(c, p);
        if (d <= c.r && d < bestD) {
            best = c.id;
            bestD = d;
        }
    }
    return best;
}
/** Launch one ball. `target` is what the player aimed at (checked against H-04/H-10); `landing` is where the
 *  ball's first bounce actually landed, measured by the client or the court-side game master (H-03). */
export function launch(state, a) {
    const s = clone(state);
    if (activeCombatant(s) !== a.combatant)
        throw new RuleError("TURN", `${a.combatant} is not the active combatant`);
    const o = s.countries[a.origin], t = s.countries[a.target];
    if (!o || !t)
        throw new RuleError("INPUT", "unknown origin or target");
    if (a.fromStaged) {
        const st = s.staged.find((x) => x.host === a.origin && x.combatant === a.combatant);
        if (!st || st.count < 1)
            throw new RuleError("H-11", `no staged balls for ${a.combatant} at ${a.origin}`);
        st.count -= 1;
    }
    else {
        if (o.combatant !== a.combatant)
            throw new RuleError("H-02", `${a.origin} is not a member of ${a.combatant}`);
        if (o.homeBalls < 1)
            throw new RuleError("H-02", `${a.origin} has no balls left`);
        if (o.struck && !o.secondStrike)
            throw new RuleError("H-05", `${a.origin} has been struck and has no second strike`);
        o.homeBalls -= 1;
    }
    if (t.combatant === a.combatant)
        throw new RuleError("H-10", "bloc members do not fight each other");
    if (!legalTargets(state, a.combatant, a.origin, !!a.fromStaged).includes(a.target))
        throw new RuleError("H-04", `${a.target} is out of reach from ${a.origin}`);
    const hit = zoneAt(s, a.landing);
    let stagedDestroyed = 0;
    if (hit) {
        const h = s.countries[hit];
        h.struck = true;
        h.hitsTaken += 1;
        for (const st of s.staged)
            if (st.host === hit && st.count > 0) {
                stagedDestroyed += st.count;
                st.count = 0;
            } // H-11
    }
    const shot = {
        turn: s.turn, combatant: a.combatant, origin: a.origin, fromStaged: !!a.fromStaged, target: a.target,
        landing: a.landing, hit, friendly: hit != null && s.countries[hit].combatant === a.combatant, stagedDestroyed,
    };
    s.shots.push(shot);
    return { state: s, shot };
}
/** Spend one CBW token to cancel one unlaunched ball of a targeted combatant, once per turn (H-06, H-12).
 *  If `fromCountry` is omitted the ball comes from the target member holding the most home balls,
 *  then from its largest staged stock. The spender loses 1 RESTRAINT. */
export function playCbw(state, a) {
    const s = clone(state);
    if (activeCombatant(s) !== a.combatant)
        throw new RuleError("TURN", `${a.combatant} is not the active combatant`);
    const me = s.combatants[a.combatant], them = s.combatants[a.targetCombatant];
    if (!them || them.id === me.id)
        throw new RuleError("H-10", "CBW must target another combatant");
    if (me.cbwStock < 1)
        throw new RuleError("H-13", `${a.combatant} has no CBW tokens`);
    if (me.cbwUsedOnTurn === s.turn)
        throw new RuleError("H-06", "one CBW token per turn");
    let from = null, fromStaged = false;
    const home = them.members.filter((m) => s.countries[m].homeBalls > 0 && (!a.fromCountry || m === a.fromCountry))
        .sort((x, y) => s.countries[y].homeBalls - s.countries[x].homeBalls || x.localeCompare(y));
    if (home.length) {
        from = home[0];
        s.countries[from].homeBalls -= 1;
    }
    else {
        const st = s.staged.filter((x) => x.combatant === them.id && x.count > 0 && (!a.fromCountry || x.host === a.fromCountry))
            .sort((x, y) => y.count - x.count || x.host.localeCompare(y.host))[0];
        if (!st)
            throw new RuleError("H-06", `${them.id} has no ball to cancel`);
        st.count -= 1;
        from = st.host;
        fromStaged = true;
    }
    me.cbwStock -= 1;
    me.cbwUsedOnTurn = s.turn;
    me.restraintPenalty += 1;
    const record = { turn: s.turn, combatant: me.id, target: them.id, cancelledFrom: from, fromStaged };
    s.cbw.push(record);
    return { state: s, record };
}
function advance(state, skipIdle) {
    const s = state;
    for (let i = 0; i < s.order.length; i++) {
        s.active = (s.active + 1) % s.order.length;
        if (s.active === 0)
            s.turn += 1;
        if (!skipIdle || canAct(s, s.order[s.active]))
            return s;
    }
    return s; // nobody can act: the match is over
}
/** Hand the turn to the next combatant that can still act. */
export function endTurn(state, skipIdle = true) {
    return advance(clone(state), skipIdle);
}
/** True when no included combatant can launch or spend CBW. */
export const isOver = (s) => s.order.every((id) => !canAct(s, id));
/** Mean member RESTRAINT minus CBW penalties: the H-07 tie-break value. */
export function meanRestraint(s, combatant) {
    const c = s.combatants[combatant];
    return c.members.reduce((n, m) => n + s.countries[m].restraint, 0) / c.members.length - c.restraintPenalty;
}
/** PLACEHOLDER tally. The canon (C-05) says a game master tallies results through statistical indices but
 *  does not define them. This default scores enemy hits delivered minus hits taken, with ties broken by
 *  mean RESTRAINT (H-07). Replace `score` with the game's own indices. */
export function tally(s) {
    const rows = s.order.map((id) => {
        const mine = new Set(s.combatants[id].members);
        const shots = s.shots.filter((x) => x.combatant === id && x.hit);
        const hitsDelivered = shots.filter((x) => !x.friendly).length;
        const friendlyHits = shots.filter((x) => x.friendly).length;
        const hitsTaken = [...mine].reduce((n, m) => n + s.countries[m].hitsTaken, 0);
        const zonesStruck = [...mine].filter((m) => s.countries[m].struck).length;
        return {
            combatant: id, hitsDelivered, hitsTaken, friendlyHits, zonesStruck,
            ballsRemaining: ballsRemaining(s, id), meanRestraint: meanRestraint(s, id), score: hitsDelivered - hitsTaken,
        };
    });
    return rows.sort((a, b) => b.score - a.score || b.meanRestraint - a.meanRestraint || a.combatant.localeCompare(b.combatant));
}
