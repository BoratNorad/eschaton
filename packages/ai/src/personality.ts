import type { LeaderStats, NationState, PlayerView } from "@eschaton/engine";

// Leader stats -> decision weights. The compendium's stat block:
//   AGG  base chance to initiate force          ESC  provocation needed before WMD release
//   PAR  misreads exercises as attacks          BLF  share of signals not backed by intent
//   LOY  resistance to unilateral action        DOM  how much domestic pain constrains choices
//   CTL  tightness of central control

export type Stats = LeaderStats;

/** Own effective stats: base plus active modifiers, clamped 1-10. Known exactly from the view. */
export function ownStats(view: PlayerView): Stats {
  return effective(view.self, view.turn);
}

export function effective(n: Pick<NationState, "baseStats" | "modifiers">, turn: number): Stats {
  const out = { ...n.baseStats };
  for (const m of n.modifiers) if (turn < m.untilTurn) out[m.stat] += m.delta;
  for (const k of Object.keys(out) as Array<keyof Stats>) out[k] = Math.min(10, Math.max(1, out[k]));
  return out;
}

export interface Weights {
  /** Value of hurting the enemy, per point of damage. */
  aggression: number;
  /** Cost per escalation step squared. High ESC fears escalation more. */
  escalationFear: number;
  /** Value per stability point. */
  domestic: number;
  /** Chance (bp) that a threat signal is sincere. */
  sincereBp: number;
  /** Weight on worst-case outcomes in lookahead (paranoid leaders hedge). */
  caution: number;
}

export function weightsFor(s: Stats): Weights {
  return {
    aggression: 0.3 + s.agg * 0.12,
    escalationFear: 2 + s.esc * 1.5,
    domestic: 0.8 + s.dom * 0.15,
    sincereBp: (10 - s.blf) * 1000,
    caution: s.par / 10,
  };
}
