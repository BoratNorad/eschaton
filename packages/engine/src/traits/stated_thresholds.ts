import { z } from "zod";
import { emitEvent } from "../logic/events.js";
import type { GameState } from "../schema/index.js";
import type { Turn } from "../engine/turn.js";
import { nationContent } from "../engine/turn.js";
import { defineTrait, holderNation } from "./define.js";

/**
 * Musharraf. Compendium: red lines Pakistani officials described publicly in
 * 2002 (loss of large territory, destruction of the armed forces, economic
 * strangulation, political destabilization), "each of which drops ESC sharply".
 *
 * Each red line fires once per game, lowering the leader's base ESC by
 * escDropPerThreshold (floor 1) and announcing it publicly (the red lines were
 * stated in public; the size of the drop is not shown). Tests, in step 9:
 *   territory     a region held at the start is lost
 *   armed_forces  total deployed strength below half its starting total
 *   economy       sanctions severity at or above 50
 *   politics      stability below 30
 */
const RED_LINES = ["territory", "armed_forces", "economy", "politics"] as const;
type RedLine = (typeof RED_LINES)[number];

const LABELS: Record<RedLine, string> = {
  territory: "loss of territory",
  armed_forces: "destruction of the armed forces",
  economy: "economic strangulation",
  politics: "political destabilization",
};

export const statedThresholds = defineTrait({
  id: "stated_thresholds",
  scope: "leader",
  summary: "Publicly stated red lines; crossing each one makes nuclear release much easier.",
  params: z.object({ escDropPerThreshold: z.number().int().min(1).max(9) }).strict(),
  upkeep(t, holder, p) {
    const id = holderNation(holder);
    const n = t.state.nations[id];
    if (n === undefined || !n.active) return;
    for (const line of RED_LINES) {
      const flag = `${id}_red_line_${line}`;
      if (t.state.flags[flag] === true || !crossed(t, id, line)) continue;
      t.state.flags[flag] = true;
      n.baseStats.esc = Math.max(1, n.baseStats.esc - p.escDropPerThreshold);
      emitEvent(t.state, {
        type: "red_line_crossed", visibility: "public", actor: id,
        text: `${id} declares a red line crossed: ${LABELS[line]}.`, data: { line },
      });
    }
  },
});

function crossed(t: Turn, id: string, line: RedLine): boolean {
  const n = t.state.nations[id]!;
  switch (line) {
    case "territory":
      return t.map.regions.some((r) => r.controller === id && !n.regionsControlled.includes(r.id));
    case "armed_forces": {
      const start = nationContent(t, id).conventional.deployments.reduce((sum, d) => sum + d.strength, 0);
      return start > 0 && totalForces(n) * 2 < start;
    }
    case "economy":
      return n.sanctionsAgainst >= 50;
    case "politics":
      return n.stability < 30;
  }
}

function totalForces(n: GameState["nations"][string]): number {
  let sum = 0;
  for (const region of Object.keys(n.forces).sort()) sum += n.forces[region] ?? 0;
  return sum;
}
