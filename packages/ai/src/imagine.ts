import {
  createGame, nextInt, nextU32, seedRng,
  type ContentBundle, type GameEvent, type GameState, type PlayerView, type RngState, type Scenario,
} from "@eschaton/engine";

// The AI plays fair: it sees only its PlayerView. To look ahead with the real
// engine it needs a full GameState, so it IMAGINES one: everything it knows is
// copied in exactly, everything hidden is filled from public content or
// sampled from its own estimates. The imagined state never touches the real
// game; it exists only inside one decision.

/** Events kept for lookahead: recent ones, plus the few that matter forever. */
const KEEP_TURNS = 12;
const FOREVER = new Set(["wmd_use", "wmd_first_use", "nuclear_exchange", "region_captured"]);

export function imagine(content: ContentBundle, scenario: Scenario, view: PlayerView, rng: RngState): GameState {
  const me = view.viewer;
  // Template: correct shapes and public starting values for every hidden field.
  const state = createGame(content, scenario, nextU32(rng));
  state.turn = view.turn;
  state.phase = view.phase;
  state.tensions = structuredClone(view.tensions);
  state.rng = seedRng(nextU32(rng));

  for (const id of Object.keys(state.nations).sort()) {
    const n = state.nations[id]!;
    if (id === me) {
      state.nations[id] = structuredClone(view.self);
      continue;
    }
    const o = view.others[id];
    if (o === undefined) continue;
    if (o.alert !== undefined) n.alert = o.alert;
    if (o.stability !== undefined) n.stability = o.stability;
    n.metros = structuredClone(o.metros);
    for (const [site, status] of Object.entries(o.sitesKnown)) n.sites[site] = status;
    const held = Object.keys(view.control).filter((r) => view.control[r] === id).sort();
    const forces: Record<string, number> = {};
    for (const r of held) forces[r] = n.forces[r] ?? 10; // start garrison, or a guess for captured ground
    n.regionsControlled = held;
    n.forces = forces;
    const w = o.belief.warheads;
    if (w) n.nuclear.warheads = w.low + nextInt(rng, w.high - w.low + 1);
    state.beliefs[me] ??= {};
    state.beliefs[me]![id] = structuredClone(o.belief);
  }

  const events = view.events.filter((e) => e.turn >= view.turn - KEEP_TURNS || FOREVER.has(e.type));
  state.events = events.map((e) => structuredClone(e));
  state.nextEventSeq = events.reduce((m, e) => Math.max(m, e.seq + 1), 0);
  state.ceasefires = ceasefiresFrom(view.events);
  applyPublicTreatyEvents(state, view.events);
  return state;
}

/** Ceasefires are public: agreed minus broken, in event order. */
function ceasefiresFrom(events: readonly GameEvent[]): GameState["ceasefires"] {
  const active = new Map<string, number>();
  for (const e of events) {
    const pair = typeof e.data.pair === "string" ? e.data.pair : undefined;
    if (e.type === "ceasefire_agreed" && pair) active.set(pair, e.turn);
    if (e.type === "ceasefire_broken" && pair) active.delete(pair);
  }
  return [...active.keys()].sort().map((pair) => ({ pair, sinceTurn: active.get(pair)! }));
}

/** Signatures and withdrawals are public; apply them to the template's treaty status. */
function applyPublicTreatyEvents(state: GameState, events: readonly GameEvent[]): void {
  for (const e of events) {
    const treaty = typeof e.data.treaty === "string" ? e.data.treaty : undefined;
    const n = e.actor ? state.nations[e.actor] : undefined;
    if (!treaty || !n) continue;
    if (e.type === "treaty_withdrawn") n.treaties[treaty] = "withdrawn";
    if (e.type === "treaty_signed") n.treaties[treaty] = "signed";
    if (e.type === "treaty_ratified") n.treaties[treaty] = "ratified";
  }
}

