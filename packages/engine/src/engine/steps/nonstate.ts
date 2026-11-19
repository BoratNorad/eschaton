import { applyEffects } from "../../logic/effect.js";
import { evaluateCondition } from "../../logic/condition.js";
import { emitEvent } from "../../logic/events.js";
import { nextInt, rollBp } from "../../rng.js";
import { sortedEntries } from "../../util/determinism.js";
import { ctxFor, regionController, type Turn } from "../turn.js";

// Step 8. Actors in sorted id order.
// Inactive: spawn when `spawn.when` holds and the leakage pool has minLeakage.
// Active: attempt the current ladder step if the pool can pay for it.
//   Draws per attempt, in order: failure roll, exposure roll.
//   Completing the last step is an attack: one more draw picks the target among
//   nations controlling an operating region; attackEffects run with $target bound,
//   then the ladder restarts.
// indpak_1999 has no actors; this is exercised by a synthetic test.

export function resolveNonState(t: Turn): void {
  const { state } = t;
  for (const [id, row] of sortedEntries(state.nonState)) {
    const actor = t.idx.nonstate.get(id);
    if (actor === undefined) continue;

    if (!row.active) {
      if (state.leakagePool < actor.spawn.minLeakage) continue;
      if (!evaluateCondition(ctxFor(t, id), actor.spawn.when)) continue;
      row.active = true;
      row.stepIndex = 0;
      emitEvent(state, { type: "actor_spawned", visibility: "hidden", text: `${actor.name} becomes active.`, data: { actor: id } });
      continue;
    }

    const step = actor.ladder[row.stepIndex];
    if (step === undefined || state.leakagePool < step.leakageCost) continue;
    state.leakagePool -= step.leakageCost;
    const failed = rollBp(state.rng, step.failureBp);
    const exposed = rollBp(state.rng, step.exposureBp);
    if (exposed)
      emitEvent(state, {
        type: "nonstate_activity_detected", visibility: "public",
        text: `Intelligence services report activity by ${actor.alias}.`, data: { actor: id, step: step.id },
      });
    if (failed) continue;
    row.stepIndex += 1;
    if (row.stepIndex < actor.ladder.length) continue;

    row.stepIndex = 0;
    const targets = [...new Set(actor.operatingRegions.map((r) => regionController(state, r)))]
      .filter((x): x is string => x !== undefined && state.nations[x]?.active === true)
      .sort();
    if (targets.length === 0) continue;
    const target = targets[nextInt(state.rng, targets.length)]!;
    emitEvent(state, {
      type: "nonstate_attack", visibility: "public", target,
      text: `${actor.alias} carries out an attack in ${target}.`, data: { actor: id },
    });
    applyEffects(ctxFor(t, id, { target }), actor.attackEffects);
  }
}
