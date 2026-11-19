import { emitEvent } from "../../logic/events.js";
import { addPressure } from "../../logic/tension.js";
import { clamp } from "../../logic/values.js";
import { pairKey } from "../../util/determinism.js";
import { RULES } from "../rules.js";
import type { Turn } from "../turn.js";

/** A hostile act ends any ceasefire between the two sides. The breaker pays in stability. */
export function breakCeasefire(t: Turn, breakerId: string, otherSide: string): void {
  const { state } = t;
  const breaker = state.nations[breakerId]!;
  const key = pairKey(breaker.side, otherSide);
  if (!state.ceasefires.some((c) => c.pair === key)) return;
  state.ceasefires = state.ceasefires.filter((c) => c.pair !== key);
  breaker.stability = clamp(breaker.stability - 5, 0, 100);
  emitEvent(state, {
    type: "ceasefire_broken", visibility: "public", actor: breakerId,
    text: `${breakerId} breaks the ceasefire.`, data: { pair: key },
  });
  addPressure(state, breaker.side, otherSide, RULES.ceasefireBreakPressure, "ceasefire_broken");
}
