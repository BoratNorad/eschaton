import { z } from "zod";
import { effectiveStat } from "../logic/values.js";
import { defineTrait, holderNation } from "./define.js";

/**
 * Musharraf. Compendium: "leaks centrifuge and design data to other players
 * each turn unless CTL is raised."
 *
 * While the nation holds an arsenal and its effective CTL is below ctlToStop,
 * the global leakage pool grows by leakagePerTurn each turn. Until pipelines
 * open (slice 4) the pool only feeds non-state actors. Silent: nobody is told.
 */
export const khanNetwork = defineTrait({
  id: "khan_network",
  scope: "leader",
  summary: "Weapons know-how leaks abroad every turn unless command control is tightened.",
  params: z
    .object({
      leakagePerTurn: z.number().int().min(0).max(100),
      ctlToStop: z.number().int().min(1).max(10).default(7),
    })
    .strict(),
  upkeep(t, holder, p) {
    const n = t.state.nations[holderNation(holder)];
    if (n === undefined || !n.active) return;
    if (n.nuclear.statusIndex < 4) return; // no arsenal, nothing to leak
    if (effectiveStat(t.state, n, "ctl") >= p.ctlToStop) return;
    t.state.leakagePool += p.leakagePerTurn;
  },
});
