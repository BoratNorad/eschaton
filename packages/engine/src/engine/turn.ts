import type { ContentIndex } from "../content/index-content.js";
import { makeContext, type Bindings, type EvalContext } from "../logic/context.js";
import { getTension } from "../logic/tension.js";
import type { GameState, Nation, NationState, Order, Scenario, WorldMap } from "../schema/index.js";
import { pairKey, sortedEntries } from "../util/determinism.js";

export type OrderKind = Order["kind"];
export type OrderOf<K extends OrderKind> = Extract<Order, { kind: K }>;

/** An order that passed step 1. `index` is its position in the submitted OrderSet. */
export interface AcceptedOrder<K extends OrderKind = OrderKind> {
  nationId: string;
  index: number;
  order: OrderOf<K>;
}

/** Working data for one resolveTurn call. */
export interface Turn {
  readonly idx: ContentIndex;
  readonly scenario: Scenario;
  readonly map: WorldMap;
  /** The draft. Every step mutates it. */
  readonly state: GameState;
  /** Accepted orders, sorted by nation id, then submission index. */
  orders: AcceptedOrder[];
  /** observer -> target, from intel_focus orders (read in step 10). */
  readonly intelFocus: Map<string, string>;
}

export function ordersOf<K extends OrderKind>(t: Turn, kind: K): Array<AcceptedOrder<K>> {
  const out: Array<AcceptedOrder<K>> = [];
  // The kind check makes the narrowing sound; TS cannot see it through the generic.
  for (const o of t.orders) if (o.order.kind === kind) out.push(o as unknown as AcceptedOrder<K>);
  return out;
}

/** EvalContext over the draft with RNG enabled. */
export function ctxFor(t: Turn, source: string, bindings: Bindings = {}): EvalContext {
  return makeContext(t.idx, t.state, t.state.rng, source, bindings);
}

export function nationContent(t: Turn, id: string): Nation {
  const n = t.idx.nations.get(id);
  if (n === undefined) throw new Error(`nation ${id} has no content`);
  return n;
}

export function activeNations(state: GameState): Array<[string, NationState]> {
  return sortedEntries(state.nations).filter(([, n]) => n.active);
}

/** The nation controlling a region, or undefined (sea, unclaimed). */
export function regionController(state: GameState, regionId: string): string | undefined {
  for (const [id, n] of sortedEntries(state.nations)) if (n.regionsControlled.includes(regionId)) return id;
  return undefined;
}

export function tensionLevel(state: GameState, sideA: string, sideB: string): number {
  return sideA === sideB ? 0 : getTension(state, sideA, sideB).level;
}

/** Highest tension level between this nation's side and any other side. */
export function maxTensionFor(state: GameState, nationId: string): number {
  const side = state.nations[nationId]?.side;
  let max = 0;
  for (const [, other] of sortedEntries(state.nations)) {
    if (side === undefined || other.side === side) continue;
    max = Math.max(max, tensionLevel(state, side, other.side));
  }
  return max;
}

export function areAdjacent(map: WorldMap, a: string, b: string): boolean {
  return map.links.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

/** Whole km between region centroids, from the generated table. Undefined if missing. */
export function distanceKm(map: WorldMap, a: string, b: string): number | undefined {
  return a === b ? 0 : map.greatCircleKm[pairKey(a, b)];
}

export function hasActiveCeasefire(state: GameState, sideA: string, sideB: string): boolean {
  const key = pairKey(sideA, sideB);
  return state.ceasefires.some((c) => c.pair === key);
}

/** Owner and region of a strike target (site or metro). */
export function locateTarget(t: Turn, targetId: string):
  | { kind: "site" | "metro"; ownerId: string; regionId: string; hardness: number; name: string }
  | undefined {
  for (const n of t.idx.bundle.nations) {
    const site = n.sites.find((s) => s.id === targetId);
    if (site) return { kind: "site", ownerId: n.id, regionId: site.regionId, hardness: site.hardness, name: site.name };
    const metro = n.metros.find((m) => m.id === targetId);
    if (metro) return { kind: "metro", ownerId: n.id, regionId: metro.regionId, hardness: 0, name: metro.name };
  }
  return undefined;
}
