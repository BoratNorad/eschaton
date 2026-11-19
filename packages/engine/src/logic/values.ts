import type { GameState, Metric, NationState, StatKey } from "../schema/index.js";

/** A modifier counts while state.turn < untilTurn. A `turns: 3` modifier made on turn t covers t, t+1, t+2. */
export function isModifierActive(state: GameState, untilTurn: number): boolean {
  return state.turn < untilTurn;
}

/** Base stat plus active modifiers, clamped to 1-10. */
export function effectiveStat(state: GameState, n: NationState, stat: StatKey): number {
  let v = n.baseStats[stat];
  for (const m of n.modifiers) if (m.stat === stat && isModifierActive(state, m.untilTurn)) v += m.delta;
  return clamp(v, 1, 10);
}

export function metricValue(n: NationState, metric: Metric): number {
  switch (metric) {
    case "stability":
      return n.stability;
    case "readiness":
      return n.readiness;
    case "mobilization":
      return n.mobilization;
    case "nuclear_warheads":
      return n.nuclear.warheads;
    case "nuclear_progress_bp":
      return n.nuclear.progressBp;
    case "chemical_tonnes":
      return n.chemicalTonnes;
    case "bio_capability":
      return n.bioCapability;
    case "cbrn_protection":
      return n.cbrn.protection;
    default:
      return assertNever(metric);
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function assertNever(x: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(x)}`);
}
