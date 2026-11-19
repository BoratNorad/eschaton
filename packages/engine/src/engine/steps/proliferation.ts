import { violateTreaty } from "../../logic/effect.js";
import { emitEvent } from "../../logic/events.js";
import { rollBp } from "../../rng.js";
import { activeNations, ctxFor, nationContent, type Turn } from "../turn.js";

// Step 6. Weapons production, then covert-violation detection rolls.
// Pipelines (state.pipelines) open in slice 4; indpak_1999 has none.

const PRODUCTION_KINDS = ["enrichment", "reactor", "reprocessing"];
const ARSENAL_STATUS_INDEX = 4; // undeclared_arsenal, declared_arsenal

export function resolveProliferation(t: Turn): void {
  const { state } = t;

  // Arsenals grow while at least one production site still works.
  for (const [id, n] of activeNations(state)) {
    if (n.nuclear.statusIndex < ARSENAL_STATUS_INDEX) continue;
    const content = nationContent(t, id);
    const producing = content.sites.some(
      (s) => s.kinds.some((k) => PRODUCTION_KINDS.includes(k)) && (n.sites[s.id] === "intact" || n.sites[s.id] === "damaged"),
    );
    if (!producing) continue;
    n.nuclear.progressBp += content.nuclear.progressPerTurnBp;
    while (n.nuclear.progressBp >= 10_000) {
      n.nuclear.progressBp -= 10_000;
      n.nuclear.warheads += 1;
    }
    n.nuclear.progressBp = Math.min(n.nuclear.progressBp, 10_000);
  }

  // One detection roll per ongoing covert violation, nation id order, then list order.
  for (const [id, n] of activeNations(state)) {
    const detected: string[] = [];
    for (const v of n.covertViolations) {
      const treaty = t.idx.treaties.get(v.treatyId);
      if (treaty === undefined) continue;
      if (rollBp(state.rng, treaty.detectionBpPerTurn)) detected.push(v.treatyId);
    }
    for (const treatyId of detected) {
      n.covertViolations = n.covertViolations.filter((v) => v.treatyId !== treatyId);
      emitEvent(state, {
        type: "covert_violation_detected", visibility: "public", actor: id,
        text: `${id} has been caught breaking ${t.idx.treaties.get(treatyId)?.name ?? treatyId}.`,
        data: { treaty: treatyId },
      });
      violateTreaty(ctxFor(t, treatyId), id, treatyId);
    }
  }
}
