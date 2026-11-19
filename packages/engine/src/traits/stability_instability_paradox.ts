import { z } from "zod";
import type { Turn } from "../engine/turn.js";
import { activeNations } from "../engine/turn.js";
import { defineTrait, holderCoalition } from "./define.js";

/**
 * INDPAK. Compendium: "mutual deterrence suppresses invasions but raises the
 * per-turn chance of sub-conventional incidents."
 *
 * While deterrence holds (every active member, at least two, has warheads):
 *   - triggers whose pair lies inside the coalition get +incidentBonusBp,
 *     unless content disabled them (chance 0 stays 0);
 *   - assaults between members lose invasionPenaltyBp of success chance.
 */
export const stabilityInstabilityParadox = defineTrait({
  id: "stability_instability_paradox",
  scope: "coalition",
  summary: "Nuclear deterrence makes invasions fail more often but flashpoints fire more often.",
  params: z
    .object({
      incidentBonusBp: z.number().int().min(0).max(10_000),
      invasionPenaltyBp: z.number().int().min(0).max(10_000),
    })
    .strict(),
  triggerChanceBp(t, holder, p, trigger, bp) {
    const coalition = holderCoalition(holder);
    if (bp === 0 || trigger.pair === undefined || !deterrenceHolds(t, coalition)) return bp;
    const sides = memberSides(t, coalition);
    return trigger.pair.every((s) => sides.has(s)) ? bp + p.incidentBonusBp : bp;
  },
  assaultChanceBp(t, holder, p, attackerId, defenderId, bp) {
    const coalition = holderCoalition(holder);
    const inside = t.state.nations[attackerId]?.coalition === coalition && t.state.nations[defenderId]?.coalition === coalition;
    return inside && deterrenceHolds(t, coalition) ? bp - p.invasionPenaltyBp : bp;
  },
});

function members(t: Turn, coalition: string) {
  return activeNations(t.state).filter(([, n]) => n.coalition === coalition);
}

function memberSides(t: Turn, coalition: string): Set<string> {
  return new Set(members(t, coalition).map(([, n]) => n.side));
}

export function deterrenceHolds(t: Turn, coalition: string): boolean {
  const m = members(t, coalition);
  return m.length >= 2 && m.every(([, n]) => n.nuclear.warheads > 0);
}
