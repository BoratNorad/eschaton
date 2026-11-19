import { z } from "zod";
import { addPressure } from "../logic/tension.js";
import { clamp, effectiveStat } from "../logic/values.js";
import { RULES } from "../engine/rules.js";
import { activeNations } from "../engine/turn.js";
import { defineTrait, holderNation } from "./define.js";

/**
 * Vajpayee. Compendium: "mobilization raises pressure on rivals each turn but
 * has a rising cost to the economy and DOM."
 *
 * Each turn mobilization is above RULES.mobilizationFreeCap:
 *   - +pressurePerTurn on every rival side;
 *   - the mobilized-turn counter rises by one;
 *   - stability falls by stabilityCostPerTurn + floor(counter * DOM / 30),
 *     so a long mobilization costs more each turn, faster for a high-DOM leader.
 * Demobilizing resets the counter.
 */
export const coerciveRestraint = defineTrait({
  id: "coercive_restraint",
  scope: "leader",
  summary: "Mobilization pressures rivals every turn, at a stability cost that rises the longer it lasts.",
  params: z
    .object({ pressurePerTurn: z.number().int().min(0).max(100), stabilityCostPerTurn: z.number().int().min(0).max(100) })
    .strict(),
  upkeep(t, holder, p) {
    const id = holderNation(holder);
    const n = t.state.nations[id];
    if (n === undefined || !n.active) return;
    if (n.mobilization <= RULES.mobilizationFreeCap) {
      delete n.traitCounters.coercive_restraint;
      return;
    }
    const turns = (n.traitCounters.coercive_restraint ?? 0) + 1;
    n.traitCounters.coercive_restraint = turns;
    const rivalSides = [...new Set(activeNations(t.state).map(([, o]) => o.side))].filter((s) => s !== n.side).sort();
    for (const side of rivalSides) addPressure(t.state, n.side, side, p.pressurePerTurn, "coercive_restraint");
    const cost = p.stabilityCostPerTurn + Math.floor((turns * effectiveStat(t.state, n, "dom")) / 30);
    n.stability = clamp(n.stability - cost, 0, 100);
  },
});
