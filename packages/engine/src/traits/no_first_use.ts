import { z } from "zod";
import { emitEvent } from "../logic/events.js";
import { clamp } from "../logic/values.js";
import { defineTrait, holderNation } from "./define.js";

/**
 * Vajpayee. Compendium: an objective, "a credible minimum deterrent under a No
 * First Use pledge". The pledge does not forbid first use; breaking it costs
 * firstUseStabilityShock stability and is announced publicly.
 */
export const noFirstUse = defineTrait({
  id: "no_first_use",
  scope: "leader",
  summary: "Using WMD first breaks a public pledge: a large stability shock.",
  params: z.object({ firstUseStabilityShock: z.number().int().min(0).max(100) }).strict(),
  afterStrikes(t, holder, p) {
    const id = holderNation(holder);
    const { state } = t;
    const n = state.nations[id];
    if (n === undefined) return;
    const brokeNow = state.events.some((e) => e.turn === state.turn && e.type === "wmd_first_use" && e.actor === id);
    if (!brokeNow) return;
    n.stability = clamp(n.stability - p.firstUseStabilityShock, 0, 100);
    emitEvent(state, {
      type: "pledge_broken", visibility: "public", actor: id,
      text: `${id} has broken its No First Use pledge.`, data: { pledge: "no_first_use" },
    });
  },
});
