import {
  evaluateCondition, getTension, makeContext, type ContentIndex, type GameState,
} from "@eschaton/engine";
import type { Weights } from "./personality.js";

// How good a (possibly imagined) state is for `me`. Plain numbers, not
// simulation state, so floats are fine here.

const OUTCOME = { win: 1500, draw: 0, loss: -1500 } as const;

export function scoreState(idx: ContentIndex, s: GameState, me: string, rival: string, w: Weights): number {
  const outcome = s.result?.outcomes[me];
  if (outcome) return OUTCOME[outcome];
  if (s.events.some((e) => e.type === "nuclear_exchange")) return OUTCOME.loss;

  const n = s.nations[me]!;
  const r = s.nations[rival]!;
  const myContent = idx.nations.get(me)!;
  const rivalContent = idx.nations.get(rival)!;
  let v = 0;

  // The nation's own objectives, as written in content.
  const ctx = makeContext(idx, s, undefined, "ai", { self: me });
  for (const o of myContent.objectives) {
    try {
      if (evaluateCondition(ctx, o.satisfiedWhen)) v += o.weight * 4;
    } catch {
      /* objectives with `chance` leaves cannot be judged read-only; ignore them */
    }
  }

  v += w.domestic * n.stability * 2;
  v += n.regionsControlled.length * 25;
  v += sum(Object.values(n.forces)) * 0.4;
  v += n.nuclear.warheads * 0.5;
  v -= n.sanctionsAgainst * 0.3;

  for (const m of myContent.metros) v -= (n.metros[m.id]?.damage ?? 0) * (m.economicWeight + 2) * 0.6;
  for (const m of rivalContent.metros) v += (r.metros[m.id]?.damage ?? 0) * w.aggression * 0.2;
  for (const site of myContent.sites) v -= siteLoss(n.sites[site.id]) * site.value * 0.2;
  for (const site of rivalContent.sites) v += siteLoss(r.sites[site.id]) * site.value * 0.1 * w.aggression;

  // Pressure is partial escalation: a one-turn lookahead must still feel the
  // cost of pushing toward the next rung, not only of reaching it.
  const t = getTension(s, n.side, r.side);
  const rung = t.level - 1 + t.pressure / 100;
  v -= w.escalationFear * rung * rung;
  return v;
}

function siteLoss(status: string | undefined): number {
  switch (status) {
    case "damaged":
      return 0.5;
    case "destroyed":
    case "captured":
    case "contaminated":
      return 1;
    default:
      return 0;
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
