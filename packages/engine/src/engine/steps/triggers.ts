import { applyEffects } from "../../logic/effect.js";
import { evaluateCondition } from "../../logic/condition.js";
import { emitEvent } from "../../logic/events.js";
import { rollBp } from "../../rng.js";
import { clamp } from "../../logic/values.js";
import { adjustTriggerChance } from "../../traits/run.js";
import { sortedEntries } from "../../util/determinism.js";
import { ctxFor, type Turn } from "../turn.js";

// Step 7. Triggers in sorted id order. For each: skip on phase filter,
// maxFires or cooldown (no draws); evaluate `when` (draws only for `chance`
// leaves); if it holds, roll chanceBp as adjusted by traits (exactly one draw);
// on success apply effects.

export function resolveTriggers(t: Turn): void {
  const { state } = t;
  for (const [id, fires] of sortedEntries(state.triggerFires)) {
    const trigger = t.idx.triggers.get(id);
    if (trigger === undefined) continue;
    if (trigger.phases.length > 0 && !trigger.phases.includes(state.phase)) continue;
    if (trigger.maxFires !== undefined && fires.count >= trigger.maxFires) continue;
    if (fires.lastTurn >= 0 && state.turn - fires.lastTurn < trigger.cooldownTurns) continue;

    const bindings = { actor: trigger.bindings.actor, target: trigger.bindings.target };
    const ctx = ctxFor(t, id, bindings);
    if (!evaluateCondition(ctx, trigger.when)) continue;
    const chanceBp = clamp(adjustTriggerChance(t, trigger, trigger.chanceBp), 0, 10_000);
    if (!rollBp(state.rng, chanceBp)) continue;

    fires.count += 1;
    fires.lastTurn = state.turn;
    emitEvent(state, {
      type: "trigger_fired", visibility: "hidden",
      text: `Flashpoint: ${trigger.name}.`, data: { trigger: id, count: fires.count },
    });
    applyEffects(ctx, trigger.effects);
  }
}
