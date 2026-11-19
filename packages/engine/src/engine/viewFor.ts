import type { ContentBundle } from "../content/bundle.js";
import { PlayerView, type GameEvent, type GameState } from "../schema/index.js";
import { sortedEntries } from "../util/determinism.js";

/**
 * The fog-of-war slice one nation is allowed to see. The server sends only this.
 *
 * - self: own NationState, exact.
 * - others: coalition, alert posture (publicly observable), the viewer's belief
 *   about them, the status of sites the viewer knows about, and metro damage
 *   (cities are public). Stability is shown only for nations on the viewer's side.
 *   Never true warheads, stockpiles, forces, covert sites or treaty violations.
 * - tensions: the whole ladder (public).
 * - events: public ones, plus private/coalition events whose audience includes
 *   the viewer. Hidden events never appear.
 *
 * Everything is deep-copied: a client cannot reach back into the state.
 */
export function viewFor(_content: ContentBundle, state: GameState, nationId: string): PlayerView {
  const self = state.nations[nationId];
  if (self === undefined) throw new Error(`${nationId} is not in this game`);

  const others: PlayerView["others"] = {};
  for (const [id, n] of sortedEntries(state.nations)) {
    if (id === nationId) continue;
    const belief = state.beliefs[nationId]?.[id] ?? { knownSites: [], perceivedBlfBp: 5000 };
    const sitesKnown: Record<string, GameState["nations"][string]["sites"][string]> = {};
    for (const siteId of belief.knownSites) {
      const status = n.sites[siteId];
      if (status !== undefined) sitesKnown[siteId] = status;
    }
    const entry: PlayerView["others"][string] = {
      coalition: n.coalition,
      alert: n.alert,
      belief: structuredClone(belief),
      sitesKnown,
      metros: structuredClone(n.metros),
    };
    if (n.side === self.side) entry.stability = n.stability;
    others[id] = entry;
  }

  return {
    viewer: nationId,
    turn: state.turn,
    phase: state.phase,
    self: structuredClone(self),
    others,
    tensions: structuredClone(state.tensions),
    events: state.events.filter((e) => canSee(e, nationId)).map((e) => structuredClone(e)),
  };
}

export function canSee(e: GameEvent, nationId: string): boolean {
  switch (e.visibility) {
    case "public":
      return true;
    case "hidden":
      return false;
    case "coalition":
    case "private":
      return e.audience.includes(nationId);
  }
}

/**
 * After-action replay: a copy of the state with every event made public.
 * Hidden detail (signal sincerity, dice, misperceptions, covert acts) becomes
 * readable; the simulation state itself is already complete.
 */
export function revealAll(state: GameState): GameState {
  const out = structuredClone(state);
  for (const e of out.events) {
    if (e.visibility === "public") continue;
    e.data = { ...e.data, originalVisibility: e.visibility };
    e.visibility = "public";
    e.audience = [];
  }
  return out;
}

/** Runtime guard for tests and the server: throws if a view breaks the PlayerView schema. */
export function assertView(view: PlayerView): void {
  PlayerView.parse(view);
}
