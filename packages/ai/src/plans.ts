import { getTension, rollBp, type ContentBundle, type GameState, type Order, type RngState } from "@eschaton/engine";
import type { Stats } from "./personality.js";

// A plan is a whole turn's order set built from the legal menu around one
// intent. The AI scores a handful of plans instead of searching all order
// combinations. Every order is taken from `menu`, so each is legal on its own,
// and plans respect the per-turn budgets (one alert, one mobilize, 10 invest).

export type PlanKind = "steady" | "deescalate" | "posture" | "coerce" | "assault" | "strike" | "nuclear";
export const PLAN_KINDS: readonly PlanKind[] = ["steady", "deescalate", "posture", "coerce", "assault", "strike", "nuclear"];

export interface PlanInput {
  content: ContentBundle;
  state: GameState;
  me: string;
  rival: string;
  menu: readonly Order[];
  stats: Stats;
  rng: RngState;
}

type OrderOf<K extends Order["kind"]> = Extract<Order, { kind: K }>;

function ofKind<K extends Order["kind"]>(menu: readonly Order[], kind: K): Array<OrderOf<K>> {
  return menu.filter((o): o is OrderOf<K> => o.kind === kind);
}

const MILITARY_KINDS = new Set(["air_base", "missile_base", "army_base", "command_bunker", "naval_base", "mobile_missile_base", "bomber_base"]);
const NUCLEAR_FACILITY = new Set(["weapons_lab", "warhead_assembly", "enrichment", "reactor", "research_reactor", "reprocessing"]);

/** Returns null when the plan has nothing distinctive to offer this turn. */
export function buildPlan(kind: PlanKind, p: PlanInput): Order[] | null {
  const me = p.state.nations[p.me]!;
  const level = getTension(p.state, me.side, p.state.nations[p.rival]!.side).level;
  const out: Order[] = [...baseline(p, level)];
  const add = (o: Order | undefined) => {
    if (o) out.push(o);
    return o !== undefined;
  };

  switch (kind) {
    case "steady":
      if (level >= 3) add(alert(p.menu, Math.max(3, me.alert)));
      return out;
    case "deescalate": {
      const ok =
        add(signal(p, "reassurance", true)) ||
        add(ofKind(p.menu, "accept_ceasefire")[0]) ||
        add(ofKind(p.menu, "propose_ceasefire")[0]);
      add(alert(p.menu, Math.min(5, me.alert + 1)));
      add(mobilize(p.menu, me.mobilization - 20));
      return ok || level >= 2 ? out : null;
    }
    case "posture":
      add(alert(p.menu, Math.max(3, me.alert - 1)));
      add(mobilize(p.menu, me.mobilization + 20));
      add(signal(p, level >= 3 ? "threat" : "warning"));
      return out;
    case "coerce":
      if (level < 2) return null;
      add(alert(p.menu, Math.max(2, me.alert - 1)));
      add(mobilize(p.menu, 100));
      add(signal(p, "ultimatum"));
      return out;
    case "assault": {
      const a = bestAssault(p);
      if (!a) return null;
      out.push(a);
      add(mobilize(p.menu, 100));
      add(alert(p.menu, Math.max(2, me.alert - 1)));
      return out;
    }
    case "strike": {
      const s = bestStrike(p, "conventional");
      if (!s) return null;
      out.push(s);
      add(bestAssault(p));
      add(alert(p.menu, Math.max(1, me.alert - 1)));
      return out;
    }
    case "nuclear": {
      const s = bestStrike(p, "nuclear");
      if (!s) return null;
      out.push(s);
      add(bestStrike(p, "conventional"));
      return out;
    }
  }
}

/** Every plan carries these: watch the rival, and invest by temperament. */
function baseline(p: PlanInput, level: number): Order[] {
  const out: Order[] = [];
  const focus = ofKind(p.menu, "intel_focus").find((o) => o.target === p.rival);
  if (focus) out.push(focus);
  // Domestic-minded leaders shore up stability; others build readiness or defenses as crises deepen.
  const split: Array<[string, number]> =
    p.stats.dom >= 7 ? [["stability", 6], [level >= 3 ? "conventional" : "cbrn_protection", 4]]
    : level >= 3 ? [["conventional", 6], ["missile_defense", 4]]
    : [["stability", 4], ["nuclear", 3], ["cbrn_protection", 3]];
  for (const [track, amount] of split) {
    const o = ofKind(p.menu, "invest").find((x) => x.track === track && x.amount === amount);
    if (o) out.push(o);
  }
  return out;
}

function alert(menu: readonly Order[], level: number): Order | undefined {
  return ofKind(menu, "set_alert").find((o) => o.level === level);
}

/** The menu offers mobilization in steps of 10; take the closest legal level toward the target. */
function mobilize(menu: readonly Order[], target: number): Order | undefined {
  const options = ofKind(menu, "mobilize");
  let best: OrderOf<"mobilize"> | undefined;
  for (const o of options) if (!best || Math.abs(o.level - target) < Math.abs(best.level - target)) best = o;
  return best;
}

function signal(p: PlanInput, kind: "reassurance" | "warning" | "threat" | "ultimatum", forceSincere?: boolean): Order | undefined {
  const sincere = forceSincere ?? rollBp(p.rng, weightsSincere(p.stats));
  return ofKind(p.menu, "signal").find((o) => o.to === p.rival && o.signal === kind && o.sincere === sincere);
}

function weightsSincere(s: Stats): number {
  return (10 - s.blf) * 1000;
}

/** Biggest push into rival-held ground, preferring regions the rival's objectives name (they hurt most). */
function bestAssault(p: PlanInput): Order | undefined {
  const assaults = ofKind(p.menu, "deploy").filter((o) => {
    const owner = p.state.nations[p.rival]!.regionsControlled.includes(o.toRegion);
    return owner;
  });
  let best: OrderOf<"deploy"> | undefined;
  for (const o of assaults) if (!best || o.strength > best.strength) best = o;
  return best;
}

/** Highest-value known target for this payload, at the largest legal count. Avoids treaty-listed nuclear sites for conventional strikes. */
function bestStrike(p: PlanInput, payload: "conventional" | "nuclear"): Order | undefined {
  const rivalContent = p.content.nations.find((n) => n.id === p.rival)!;
  const value = (targetId: string): number => {
    const site = rivalContent.sites.find((s) => s.id === targetId);
    if (site) {
      if (payload === "conventional" && site.kinds.some((k) => NUCLEAR_FACILITY.has(k))) return -1;
      const military = site.kinds.some((k) => MILITARY_KINDS.has(k));
      return site.value + (military ? 30 : 0);
    }
    // Metros: never a conventional target here; for nuclear use, a last resort below military targets.
    const metro = rivalContent.metros.find((m) => m.id === targetId);
    return metro && payload === "nuclear" ? metro.economicWeight : -1;
  };
  let best: OrderOf<"strike"> | undefined;
  let bestScore = 0;
  for (const o of ofKind(p.menu, "strike")) {
    if (o.payload !== payload) continue;
    const v = value(o.targetId);
    if (v <= 0) continue;
    const score = v * 100 + Math.min(o.count, payload === "nuclear" ? 2 : 50);
    if (score > bestScore || (score === bestScore && best && o.count < best.count)) {
      best = payload === "nuclear" ? { ...o, count: Math.min(o.count, 2) } : o;
      bestScore = score;
    }
  }
  return best;
}
