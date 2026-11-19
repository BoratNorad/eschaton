import { emitEvent } from "../../logic/events.js";
import { addPressure, shiftTension } from "../../logic/tension.js";
import { clamp, effectiveStat } from "../../logic/values.js";
import { rollBp } from "../../rng.js";
import { sortedEntries } from "../../util/determinism.js";
import { RULES } from "../rules.js";
import { activeNations, hasActiveCeasefire, nationContent, tensionLevel, type Turn } from "../turn.js";

// Step 9. In order: domestic stability upkeep; pressure from posture and
// decay; de-escalation; then misperception (PAR) rolls. Only PAR rolls draw.

export function resolveUpkeep(t: Turn): void {
  const { state } = t;
  const nations = activeNations(state);

  // --- stability -----------------------------------------------------------
  for (const [id, n] of nations) {
    let delta = 0;
    if (n.mobilization > RULES.mobilizationFreeCap) delta -= 1;
    if (n.sanctionsAgainst >= RULES.sanctionStabilityThreshold) delta -= 1;
    const maxLevel = Math.max(0, ...nations.filter(([, o]) => o.side !== n.side).map(([, o]) => tensionLevel(state, n.side, o.side)));
    if (maxLevel >= RULES.warLevel) delta -= 1;
    // Calm times slowly restore the starting level.
    if (delta === 0 && maxLevel <= 2 && n.stability < nationContent(t, id).stability) delta = 1;
    n.stability = clamp(n.stability + delta, 0, 100);
    n.sanctionsAgainst = Math.max(0, n.sanctionsAgainst - RULES.sanctionDecayPerTurn);
  }

  // --- pressure, decay, de-escalation ------------------------------------------
  for (const [key, row] of sortedEntries(state.tensions)) {
    const [a, b] = key.split("|") as [string, string];
    let posture = 0;
    for (const [, n] of nations) {
      if (n.side !== a && n.side !== b) continue;
      if (n.mobilization > RULES.mobilizationFreeCap) posture += RULES.postureUpkeepPressure;
      if (n.alert <= 2) posture += RULES.postureUpkeepPressure;
    }
    if (posture > 0) {
      addPressure(state, a, b, posture, "posture");
      continue;
    }
    const quiet = state.turn - row.lastIncidentTurn;
    if (quiet < RULES.quietTurnsBeforeDecay) continue;
    const decay = hasActiveCeasefire(state, a, b) ? RULES.ceasefirePressureDecay : RULES.pressureDecay;
    if (row.pressure > 0) {
      row.pressure = Math.max(0, row.pressure - decay);
    } else if (quiet >= RULES.quietTurnsBeforeDeescalate && row.level > 1) {
      shiftTension(state, a, b, -1, "quiet");
      // The reset pressure doubles as the timer before the next step down.
      row.pressure = RULES.deescalateResetPressure;
    }
  }

  // --- misperception -----------------------------------------------------------
  // One roll per (nation, rival side at level >= 3), nation id then side order.
  for (const [id, n] of nations) {
    const rivalSides = [...new Set(nations.map(([, o]) => o.side))].filter((s) => s !== n.side).sort();
    for (const side of rivalSides) {
      if (tensionLevel(state, n.side, side) < RULES.minLevelForMisperception) continue;
      const rivalOnAlert = nations.some(([, o]) => o.side === side && o.alert <= 2);
      const bp = effectiveStat(state, n, "par") * RULES.misperceptionBpPerPar * (rivalOnAlert ? 2 : 1);
      if (!rollBp(state.rng, bp)) continue;
      emitEvent(state, {
        type: "false_alarm", visibility: "private", actor: id,
        text: `Warning: sensors suggest ${side} may be preparing an attack. This is unconfirmed.`,
        data: { side },
      });
      emitEvent(state, {
        type: "misperception", visibility: "hidden", actor: id,
        text: `${id} misread ${side}'s activity as a threat.`, data: { side, bp },
      });
      addPressure(state, n.side, side, RULES.misperceptionPressure, "misperception");
    }
  }
}
