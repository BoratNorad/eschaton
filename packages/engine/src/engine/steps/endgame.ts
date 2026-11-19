import { applyEffect } from "../../logic/effect.js";
import { evaluateCondition } from "../../logic/condition.js";
import { emitEvent } from "../../logic/events.js";
import { isModifierActive } from "../../logic/values.js";
import { sortedEntries } from "../../util/determinism.js";
import { ctxFor, type Turn } from "../turn.js";

type Outcome = "win" | "loss" | "draw";

/** Step 11. First matching phase transition (scenario order), then victory checks. */
export function resolvePhaseAndVictory(t: Turn): void {
  for (const pt of t.scenario.phaseTransitions) {
    if (pt.to === t.state.phase) continue;
    if (!evaluateCondition(ctxFor(t, "phase_transition"), pt.when)) continue;
    applyEffect(ctxFor(t, "phase_transition"), { kind: "change_phase", phase: pt.to });
    break;
  }
  checkVictory(t, false);
}

/**
 * Step 12. Expire modifiers and unlocks, increment the turn. When the new turn
 * reaches maxTurns, run the victory checks once more at the new turn number
 * (so `turn_at_least: maxTurns` can hold) and end the game; anyone without an
 * outcome draws.
 */
export function resolveEndOfTurn(t: Turn): void {
  const { state } = t;
  state.turn += 1;
  for (const [, n] of sortedEntries(state.nations)) {
    n.modifiers = n.modifiers.filter((m) => isModifierActive(state, m.untilTurn));
    n.unlockedActions = n.unlockedActions.filter((u) => isModifierActive(state, u.untilTurn));
  }
  if (state.result === undefined && state.turn >= t.scenario.maxTurns) checkVictory(t, true);
}

/**
 * Victory entries in scenario order; earlier entries win ties for a nation.
 * Any entry firing ends the game. Nations left without an outcome lose if
 * someone won, otherwise draw.
 */
function checkVictory(t: Turn, final: boolean): void {
  const { state } = t;
  const outcomes: Record<string, Outcome> = {};
  const fired: string[] = [];
  const nationIds = sortedEntries(state.nations).map(([id]) => id);

  for (const v of t.scenario.victory) {
    if (!evaluateCondition(ctxFor(t, v.id), v.when)) continue;
    fired.push(v.id);
    for (const id of nationIds) {
      const n = state.nations[id]!;
      const applies = v.side === undefined || n.side === v.side || n.coalition === v.side;
      if (applies && outcomes[id] === undefined) outcomes[id] = v.outcome;
    }
  }
  if (fired.length === 0 && !final) return;

  const someoneWon = nationIds.some((id) => outcomes[id] === "win");
  for (const id of nationIds) outcomes[id] ??= someoneWon ? "loss" : "draw";
  state.result = { endedAtTurn: state.turn, outcomes };
  emitEvent(state, {
    type: "game_over", visibility: "public",
    text: `The game is over: ${nationIds.map((id) => `${id} ${outcomes[id]}`).join(", ")}.`,
    data: { victories: fired.join(",") || "none" },
  });
}
