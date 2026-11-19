import { pairKey } from "../util/determinism.js";
import { TENSION_LABELS, type GameState } from "../schema/index.js";
import { emitEvent } from "./events.js";
import { clamp } from "./values.js";

// Tension ladder primitives, shared by effects (step 7) and upkeep (step 9).

type TensionRow = GameState["tensions"][string];

const MIN_LEVEL = 1;
const MAX_LEVEL = 5;

export function getTension(state: GameState, a: string, b: string): TensionRow {
  return state.tensions[pairKey(a, b)] ?? { level: MIN_LEVEL, pressure: 0, lastIncidentTurn: -1 };
}

function rowFor(state: GameState, a: string, b: string): TensionRow {
  const key = pairKey(a, b);
  let row = state.tensions[key];
  if (row === undefined) {
    row = { level: MIN_LEVEL, pressure: 0, lastIncidentTurn: -1 };
    state.tensions[key] = row;
  }
  return row;
}

/** Move the level by `delta` (clamped 1-5). Emits a public `tension_changed` event if it moved. */
export function shiftTension(state: GameState, a: string, b: string, delta: number, source: string): void {
  if (a === b) return;
  const row = rowFor(state, a, b);
  const from = row.level;
  row.level = clamp(from + delta, MIN_LEVEL, MAX_LEVEL);
  if (delta > 0) row.lastIncidentTurn = state.turn;
  if (row.level !== from) {
    emitEvent(state, {
      type: "tension_changed",
      visibility: "public",
      text: `Tension ${pairKey(a, b)}: ${TENSION_LABELS[from]} -> ${TENSION_LABELS[row.level]}.`,
      data: { pair: pairKey(a, b), from, to: row.level, source },
    });
  }
}

/**
 * Add pressure (may be negative). Reaching 100 raises the level by one and
 * resets pressure to 0 (excess is discarded). At level 5 pressure caps at 99.
 * Pressure never goes below 0 and never lowers the level.
 */
export function addPressure(state: GameState, a: string, b: string, points: number, source: string): void {
  if (a === b) return;
  const row = rowFor(state, a, b);
  const next = row.pressure + points;
  if (next >= 100 && row.level < MAX_LEVEL) {
    row.pressure = 0;
    shiftTension(state, a, b, 1, source);
  } else {
    row.pressure = clamp(next, 0, 99);
  }
}
