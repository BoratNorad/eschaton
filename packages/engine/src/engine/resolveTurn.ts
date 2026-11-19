import type { TurnResult } from "../api.js";
import type { ContentBundle } from "../content/bundle.js";
import { indexContent } from "../content/index-content.js";
import type { GameState, OrderSet } from "../schema/index.js";
import { resolveDiplomacy } from "./steps/diplomacy.js";
import { resolveEndOfTurn, resolvePhaseAndVictory } from "./steps/endgame.js";
import { resolveIntel } from "./steps/intel.js";
import { resolveMovement } from "./steps/movement.js";
import { resolveNonState } from "./steps/nonstate.js";
import { resolvePosture } from "./steps/posture.js";
import { resolveProliferation } from "./steps/proliferation.js";
import { resolveStrikes } from "./steps/strikes.js";
import { resolveTriggers } from "./steps/triggers.js";
import { resolveUpkeep } from "./steps/upkeep.js";
import { validateOrders } from "./steps/validate.js";
import type { Turn } from "./turn.js";

/**
 * Resolve one WEGO turn. Pure: the input state is cloned once and never
 * touched. The step order is fixed (CLAUDE.md "Turn resolution order").
 * `orders` may come straight off the wire: each OrderSet is schema-checked in step 1.
 */
export function resolveTurn(content: ContentBundle, input: GameState, orders: readonly OrderSet[]): TurnResult {
  if (input.result !== undefined) throw new Error(`game ended at turn ${input.result.endedAtTurn}`);
  const idx = indexContent(content);
  const scenario = idx.scenarios.get(input.scenarioId);
  if (scenario === undefined) throw new Error(`unknown scenario ${input.scenarioId}`);
  const map = idx.maps.get(scenario.mapId);
  if (map === undefined) throw new Error(`unknown map ${scenario.mapId}`);

  const state = structuredClone(input);
  const firstSeq = state.nextEventSeq;
  const t: Turn = { idx, scenario, map, state, orders: [], intelFocus: new Map() };

  t.orders = validateOrders(t, orders); //   1
  resolveDiplomacy(t); //                    2
  resolvePosture(t); //                      3
  resolveMovement(t); //                     4
  resolveStrikes(t); //                      5
  resolveProliferation(t); //                6
  resolveTriggers(t); //                     7
  resolveNonState(t); //                     8
  resolveUpkeep(t); //                       9
  resolveIntel(t); //                       10
  resolvePhaseAndVictory(t); //             11
  resolveEndOfTurn(t); //                   12

  return { state, events: state.events.filter((e) => e.seq >= firstSeq) };
}
