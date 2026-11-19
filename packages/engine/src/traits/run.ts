import type { Trigger } from "../schema/index.js";
import { activeNations, nationContent, type Turn } from "../engine/turn.js";
import type { BoundTrait, TraitHolder } from "./define.js";
import { TRAITS } from "./registry.js";

// Calls trait hooks in a fixed order: leader traits of active nations in nation
// id order (then the nation's legacy-file traits), then coalition rules in
// coalition id order; within a holder, content order.

interface Active {
  holder: TraitHolder;
  trait: BoundTrait;
}

function activeTraits(t: Turn): Active[] {
  const out: Active[] = [];
  const bind = (holder: TraitHolder, id: string, params: Record<string, number | string | boolean>) => {
    const reg = TRAITS.get(id);
    if (reg === undefined) throw new Error(`trait "${id}" has no handler (run npm run validate)`);
    out.push({ holder, trait: reg.bind(params) });
  };
  for (const [nationId, n] of activeNations(t.state)) {
    const leader = t.idx.leaders.get(n.leaderId);
    for (const tr of leader?.traits ?? []) bind({ scope: "leader", nationId }, tr.id, tr.params);
    for (const lf of nationContent(t, nationId).legacyFiles)
      for (const tr of lf.traits) bind({ scope: "leader", nationId }, tr.id, tr.params);
  }
  for (const coalitionId of [...t.scenario.coalitions].sort()) {
    const c = t.idx.coalitions.get(coalitionId);
    for (const tr of c?.specialRules ?? []) bind({ scope: "coalition", coalitionId }, tr.id, tr.params);
  }
  return out;
}

/** End of step 5. */
export function runAfterStrikes(t: Turn): void {
  for (const { holder, trait } of activeTraits(t)) trait.afterStrikes?.(t, holder);
}

/** Start of step 9. */
export function runUpkeep(t: Turn): void {
  for (const { holder, trait } of activeTraits(t)) trait.upkeep?.(t, holder);
}

/** Step 7. The caller clamps the result to 0-10000. */
export function adjustTriggerChance(t: Turn, trigger: Trigger, bp: number): number {
  let out = bp;
  for (const { holder, trait } of activeTraits(t)) if (trait.triggerChanceBp) out = trait.triggerChanceBp(t, holder, trigger, out);
  return out;
}

/** Step 4. The caller clamps the result to the battle limits. */
export function adjustAssaultChance(t: Turn, attackerId: string, defenderId: string, bp: number): number {
  let out = bp;
  for (const { holder, trait } of activeTraits(t))
    if (trait.assaultChanceBp) out = trait.assaultChanceBp(t, holder, attackerId, defenderId, out);
  return out;
}
