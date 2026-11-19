import { emitEvent } from "../../logic/events.js";
import { nextInt, rollBp } from "../../rng.js";
import { RULES } from "../rules.js";
import { activeNations, nationContent, type Turn } from "../turn.js";

// Step 10. Only intel_focus refreshes beliefs in slice 1. For each observer in
// id order with a focus: re-estimate warheads (one draw, if the target's
// program is visible), then try to find one unknown site (one draw, if any remain).

export function resolveIntel(t: Turn): void {
  const { state } = t;
  for (const [observerId] of activeNations(state)) {
    const targetId = t.intelFocus.get(observerId);
    if (targetId === undefined) continue;
    const target = state.nations[targetId];
    const belief = state.beliefs[observerId]?.[targetId];
    if (target === undefined || belief === undefined) continue;
    const content = nationContent(t, targetId);

    if (!content.nuclear.opacity || target.nuclear.exposed) {
      const truth = target.nuclear.warheads;
      const prevWidth = belief.warheads ? belief.warheads.high - belief.warheads.low : Math.floor((truth * 2) / 5);
      const width = Math.max(2, Math.floor((prevWidth * 3) / 4));
      const low = Math.max(0, truth - nextInt(state.rng, width + 1));
      const conf = Math.min(RULES.maxConfidenceBp, (belief.warheads?.confidenceBp ?? 0) + RULES.intelConfidenceGainBp);
      belief.warheads = { low, high: low + width, confidenceBp: conf, asOfTurn: state.turn };
    }

    const unknown = content.sites.map((s) => s.id).filter((s) => !belief.knownSites.includes(s)).sort();
    const found = unknown[0];
    if (found !== undefined && rollBp(state.rng, RULES.siteDiscoveryBp)) {
      belief.knownSites = [...belief.knownSites, found].sort();
      emitEvent(state, {
        type: "site_discovered", visibility: "private", actor: observerId, target: targetId,
        text: `Intelligence has located ${content.sites.find((s) => s.id === found)!.name}.`,
        data: { site: found },
      });
    }
  }
}
