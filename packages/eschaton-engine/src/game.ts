// ESCHATON rules engine: builds a match from the ledger and enforces house rules H-01 to H-13.
// State is a plain JSON-serialisable object, so a server can own it and clients can render it.
// Every action returns a NEW state (the input is never mutated) plus an event for the log.
import { REACH_UNIT_M } from "./derive.js";
import type { Ledger, Profile } from "./types.js";

export interface Point { x: number; y: number }

export interface CountryState {
  id: string;
  name: string;
  combatant: string;          // combatant id this country plays for
  x: number; y: number; r: number;
  reach: number;              // 0-4; 4 = unlimited (H-04)
  secondStrike: boolean;      // H-05
  restraint: number;
  homeBalls: number;          // own balls not yet launched (BALLS minus balls staged abroad)
  struck: boolean;
  hitsTaken: number;
}

export interface StagedStock {
  host: string;               // country whose zone holds the balls (H-11)
  provider: string;           // country whose balls they are
  combatant: string;          // the provider's combatant
  reach: number;              // the provider's REACH
  count: number;              // unlaunched staged balls
}

export interface Combatant {
  id: string;                 // bloc code, or "NONALIGN:<ID>" for a one-country NONALIGN combatant (H-10)
  bloc: string;
  name: string;
  color: string;
  members: string[];
  cbwStock: number;           // H-13 cap already applied in the ledger
  cbwUsedOnTurn: number | null;
  restraintPenalty: number;   // H-06: +1 each time it spends a CBW token
}

export interface ShotRecord {
  turn: number; combatant: string; origin: string; fromStaged: boolean;
  target: string; landing: Point; hit: string | null; friendly: boolean; stagedDestroyed: number;
}
export interface CbwRecord { turn: number; combatant: string; target: string; cancelledFrom: string; fromStaged: boolean }

export interface GameState {
  profile: Profile;           // fixed for the match (H-01)
  formulaVersion: string;
  turn: number;
  order: string[];            // combatant ids in turn order
  active: number;             // index into order
  combatants: Record<string, Combatant>;
  countries: Record<string, CountryState>;
  staged: StagedStock[];
  shots: ShotRecord[];
  cbw: CbwRecord[];
}

export interface GameOptions {
  /** Combatant ids to include; default all. Non-listed countries stay on the map as neutral zones. */
  include?: string[];
  /** Turn order; default ledger bloc order, then NONALIGN members alphabetically. */
  order?: string[];
  /** Skip combatants with no balls, no staged balls and no CBW stock when advancing turns. Default true. */
  skipIdle?: boolean;
}

export class RuleError extends Error {
  constructor(public rule: string, message: string) { super(`${rule}: ${message}`); }
}

const clone = <T>(x: T): T => structuredClone(x);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Build a match. The profile cannot change afterwards (H-01). */
export function createGame(L: Ledger, profile: Profile, opts: GameOptions = {}): GameState {
  const combatants: Record<string, Combatant> = {};
  const combatantOf: Record<string, string> = {};
  for (const b of L.blocs[profile]) {
    const ids = b.code === "NONALIGN" ? b.members.map((m) => `NONALIGN:${m}`) : [b.code]; // H-10
    for (const id of ids) {
      const members = b.code === "NONALIGN" ? [id.split(":")[1]] : b.members;
      const tokens = members.reduce((s, m) => s + (L.countries.find((c) => c.id === m)!.eschaton[profile].CBW_TOKENS), 0);
      combatants[id] = {
        id, bloc: b.code, name: b.code === "NONALIGN" ? `${b.name}: ${members[0]}` : b.name, color: b.color_hex,
        members, cbwStock: b.code === "NONALIGN" ? tokens : b.cbw_stock, cbwUsedOnTurn: null, restraintPenalty: 0,
      };
      for (const m of members) combatantOf[m] = id;
    }
  }

  const countries: Record<string, CountryState> = {};
  for (const c of L.countries) {
    const e = c.eschaton[profile], z = c.eschaton.zone;
    countries[c.id] = {
      id: c.id, name: c.name, combatant: combatantOf[c.id], x: z.x_m, y: z.y_m, r: z.radius_m,
      reach: e.REACH, secondStrike: e.SECOND_STRIKE, restraint: e.RESTRAINT,
      homeBalls: e.BALLS, struck: false, hitsTaken: 0,
    };
  }

  // H-11: under CURRENT each host holds STAGED of its provider's balls; they are drawn from the provider's BALLS.
  const staged: StagedStock[] = [];
  for (const c of L.countries) {
    const n = c.eschaton[profile].STAGED;
    if (!n) continue;
    const provider = c.sharing.hosted_by[0];
    const p = countries[provider];
    const take = Math.min(n, p.homeBalls);
    p.homeBalls -= take;
    staged.push({ host: c.id, provider, combatant: p.combatant, reach: p.reach, count: take });
  }

  let ids = Object.keys(combatants);
  if (opts.include) ids = ids.filter((id) => opts.include!.includes(id));
  const order = opts.order ? opts.order.filter((id) => ids.includes(id)) : ids;
  for (const id of Object.keys(combatants)) if (!ids.includes(id)) delete combatants[id];

  let s: GameState = {
    profile, formulaVersion: L.meta.formula_version, turn: 1, order, active: 0,
    combatants, countries, staged, shots: [], cbw: [],
  };
  if (opts.skipIdle !== false && !canAct(s, order[0])) s = advance(s, true);
  return s;
}

export const activeCombatant = (s: GameState): string => s.order[s.active];

/** Total balls a combatant still holds: home balls of members plus its staged balls (H-02, H-11). */
export function ballsRemaining(s: GameState, combatant: string): number {
  const c = s.combatants[combatant];
  return c.members.reduce((n, m) => n + s.countries[m].homeBalls, 0)
    + s.staged.filter((st) => st.combatant === combatant).reduce((n, st) => n + st.count, 0);
}

/** True if the combatant has anything it could still do: launch a ball or spend a CBW token (H-12). */
export function canAct(s: GameState, combatant: string): boolean {
  const c = s.combatants[combatant];
  if (!c) return false;
  const launchable = c.members.some((m) => s.countries[m].homeBalls > 0 && (!s.countries[m].struck || s.countries[m].secondStrike))
    || s.staged.some((st) => st.combatant === combatant && st.count > 0);
  return launchable || c.cbwStock > 0;
}

function inReach(from: CountryState, to: CountryState, reach: number): boolean {
  if (reach >= 4) return true; // H-04: REACH 4 is unlimited
  return dist(from, to) <= reach * REACH_UNIT_M;
}

/** Countries the given launch point may target (H-04 reach, H-10 no allied targets). */
export function legalTargets(s: GameState, combatant: string, origin: string, fromStaged = false): string[] {
  const o = s.countries[origin];
  const reach = fromStaged ? s.staged.find((st) => st.host === origin && st.combatant === combatant)?.reach ?? 0 : o.reach;
  return Object.values(s.countries)
    .filter((t) => t.combatant !== combatant && s.combatants[t.combatant] && inReach(o, t, reach)) // excluded blocs are neutral
    .map((t) => t.id);
}

/** The zone a landing point strikes (H-03): first bounce inside a zone circle; nearest centre wins on overlap. */
export function zoneAt(s: GameState, p: Point): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const c of Object.values(s.countries)) {
    const d = dist(c, p);
    if (d <= c.r && d < bestD) { best = c.id; bestD = d; }
  }
  return best;
}

export interface LaunchInput { combatant: string; origin: string; fromStaged?: boolean; target: string; landing: Point }

/** Launch one ball. `target` is what the player aimed at (checked against H-04/H-10); `landing` is where the
 *  ball's first bounce actually landed, measured by the client or the court-side game master (H-03). */
export function launch(state: GameState, a: LaunchInput): { state: GameState; shot: ShotRecord } {
  const s = clone(state);
  if (activeCombatant(s) !== a.combatant) throw new RuleError("TURN", `${a.combatant} is not the active combatant`);
  const o = s.countries[a.origin], t = s.countries[a.target];
  if (!o || !t) throw new RuleError("INPUT", "unknown origin or target");

  if (a.fromStaged) {
    const st = s.staged.find((x) => x.host === a.origin && x.combatant === a.combatant);
    if (!st || st.count < 1) throw new RuleError("H-11", `no staged balls for ${a.combatant} at ${a.origin}`);
    st.count -= 1;
  } else {
    if (o.combatant !== a.combatant) throw new RuleError("H-02", `${a.origin} is not a member of ${a.combatant}`);
    if (o.homeBalls < 1) throw new RuleError("H-02", `${a.origin} has no balls left`);
    if (o.struck && !o.secondStrike) throw new RuleError("H-05", `${a.origin} has been struck and has no second strike`);
    o.homeBalls -= 1;
  }
  if (t.combatant === a.combatant) throw new RuleError("H-10", "bloc members do not fight each other");
  if (!legalTargets(state, a.combatant, a.origin, !!a.fromStaged).includes(a.target))
    throw new RuleError("H-04", `${a.target} is out of reach from ${a.origin}`);

  const hit = zoneAt(s, a.landing);
  let stagedDestroyed = 0;
  if (hit) {
    const h = s.countries[hit];
    h.struck = true;
    h.hitsTaken += 1;
    for (const st of s.staged) if (st.host === hit && st.count > 0) { stagedDestroyed += st.count; st.count = 0; } // H-11
  }
  const shot: ShotRecord = {
    turn: s.turn, combatant: a.combatant, origin: a.origin, fromStaged: !!a.fromStaged, target: a.target,
    landing: a.landing, hit, friendly: hit != null && s.countries[hit].combatant === a.combatant, stagedDestroyed,
  };
  s.shots.push(shot);
  return { state: s, shot };
}

export interface CbwInput { combatant: string; targetCombatant: string; fromCountry?: string }

/** Spend one CBW token to cancel one unlaunched ball of a targeted combatant, once per turn (H-06, H-12).
 *  If `fromCountry` is omitted the ball comes from the target member holding the most home balls,
 *  then from its largest staged stock. The spender loses 1 RESTRAINT. */
export function playCbw(state: GameState, a: CbwInput): { state: GameState; record: CbwRecord } {
  const s = clone(state);
  if (activeCombatant(s) !== a.combatant) throw new RuleError("TURN", `${a.combatant} is not the active combatant`);
  const me = s.combatants[a.combatant], them = s.combatants[a.targetCombatant];
  if (!them || them.id === me.id) throw new RuleError("H-10", "CBW must target another combatant");
  if (me.cbwStock < 1) throw new RuleError("H-13", `${a.combatant} has no CBW tokens`);
  if (me.cbwUsedOnTurn === s.turn) throw new RuleError("H-06", "one CBW token per turn");

  let from: string | null = null, fromStaged = false;
  const home = them.members.filter((m) => s.countries[m].homeBalls > 0 && (!a.fromCountry || m === a.fromCountry))
    .sort((x, y) => s.countries[y].homeBalls - s.countries[x].homeBalls || x.localeCompare(y));
  if (home.length) { from = home[0]; s.countries[from].homeBalls -= 1; }
  else {
    const st = s.staged.filter((x) => x.combatant === them.id && x.count > 0 && (!a.fromCountry || x.host === a.fromCountry))
      .sort((x, y) => y.count - x.count || x.host.localeCompare(y.host))[0];
    if (!st) throw new RuleError("H-06", `${them.id} has no ball to cancel`);
    st.count -= 1; from = st.host; fromStaged = true;
  }
  me.cbwStock -= 1;
  me.cbwUsedOnTurn = s.turn;
  me.restraintPenalty += 1;
  const record: CbwRecord = { turn: s.turn, combatant: me.id, target: them.id, cancelledFrom: from, fromStaged };
  s.cbw.push(record);
  return { state: s, record };
}

function advance(state: GameState, skipIdle: boolean): GameState {
  const s = state;
  for (let i = 0; i < s.order.length; i++) {
    s.active = (s.active + 1) % s.order.length;
    if (s.active === 0) s.turn += 1;
    if (!skipIdle || canAct(s, s.order[s.active])) return s;
  }
  return s; // nobody can act: the match is over
}

/** Hand the turn to the next combatant that can still act. */
export function endTurn(state: GameState, skipIdle = true): GameState {
  return advance(clone(state), skipIdle);
}

/** True when no included combatant can launch or spend CBW. */
export const isOver = (s: GameState): boolean => s.order.every((id) => !canAct(s, id));

/** Mean member RESTRAINT minus CBW penalties: the H-07 tie-break value. */
export function meanRestraint(s: GameState, combatant: string): number {
  const c = s.combatants[combatant];
  return c.members.reduce((n, m) => n + s.countries[m].restraint, 0) / c.members.length - c.restraintPenalty;
}

export interface TallyRow {
  combatant: string; hitsDelivered: number; hitsTaken: number; friendlyHits: number;
  zonesStruck: number; ballsRemaining: number; meanRestraint: number; score: number;
}

/** PLACEHOLDER tally. The canon (C-05) says a game master tallies results through statistical indices but
 *  does not define them. This default scores enemy hits delivered minus hits taken, with ties broken by
 *  mean RESTRAINT (H-07). Replace `score` with the game's own indices. */
export function tally(s: GameState): TallyRow[] {
  const rows = s.order.map((id): TallyRow => {
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
