import { emitEvent } from "../../logic/events.js";
import { shiftTension } from "../../logic/tension.js";
import { clamp } from "../../logic/values.js";
import { nextInt } from "../../rng.js";
import type { NationState } from "../../schema/index.js";
import { pairKey } from "../../util/determinism.js";
import { RULES } from "../rules.js";
import { nationContent, ordersOf, regionController, tensionLevel, type Turn } from "../turn.js";
import { breakCeasefire } from "./ceasefire.js";

// Step 4. Moves are simultaneous in three passes:
//   1. every deploy leaves its origin;
//   2. moves into own, allied or empty regions arrive;
//   3. assaults resolve in nation id order, one roll each, against whatever
//      garrison is there after passes 1-2.
// A move takes effect this turn regardless of the link's moveTurns (slice 1).

export function resolveMovement(t: Turn): void {
  const { state } = t;
  const deploys = ordersOf(t, "deploy");

  for (const { nationId, order } of deploys) {
    const n = state.nations[nationId]!;
    const left = (n.forces[order.fromRegion] ?? 0) - order.strength;
    if (left > 0) n.forces[order.fromRegion] = left;
    else delete n.forces[order.fromRegion];
  }

  const assaults: typeof deploys = [];
  for (const d of deploys) {
    const controller = regionController(state, d.order.toRegion);
    const hostile = controller !== undefined && state.nations[controller]!.side !== state.nations[d.nationId]!.side;
    if (hostile) assaults.push(d);
    else addForces(state.nations[d.nationId]!, d.order.toRegion, d.order.strength);
  }

  for (const { nationId, order } of assaults) {
    const att = state.nations[nationId]!;
    const defId = regionController(state, order.toRegion);
    // The region may have changed hands in an earlier assault this turn.
    if (defId === undefined || defId === nationId || state.nations[defId]!.side === att.side) {
      addForces(att, order.toRegion, order.strength);
      continue;
    }
    const def = state.nations[defId]!;
    breakCeasefire(t, nationId, def.side);
    if (tensionLevel(state, att.side, def.side) < RULES.warLevel)
      shiftTension(state, att.side, def.side, RULES.warLevel - tensionLevel(state, att.side, def.side), "assault");
    const row = state.tensions[pairKey(att.side, def.side)];
    if (row) row.lastIncidentTurn = state.turn;

    const garrison = def.forces[order.toRegion] ?? 0;
    const terrain = t.map.regions.find((r) => r.id === order.toRegion)?.terrain;
    const attPower = order.strength * nationContent(t, nationId).conventional.army * (50 + att.readiness);
    const defPower = Math.floor(
      (garrison * nationContent(t, defId).conventional.army * (50 + def.readiness) *
        (terrain === "mountain" ? RULES.mountainDefensePct : 100)) / 100,
    );
    const chanceBp = defPower === 0
      ? RULES.maxBattleBp
      : clamp(Math.floor((attPower * 10_000) / (attPower + defPower)), RULES.minBattleBp, RULES.maxBattleBp);
    const roll = nextInt(state.rng, 10_000);
    const won = roll < chanceBp;
    const regionName = t.map.regions.find((r) => r.id === order.toRegion)?.name ?? order.toRegion;

    if (won) {
      def.regionsControlled = def.regionsControlled.filter((r) => r !== order.toRegion);
      delete def.forces[order.toRegion];
      att.regionsControlled = [...att.regionsControlled, order.toRegion].sort();
      addForces(att, order.toRegion, Math.max(1, Math.floor((order.strength * 3) / 4)));
      for (const s of nationContent(t, defId).sites)
        if (s.regionId === order.toRegion && def.sites[s.id] !== "destroyed") def.sites[s.id] = "captured";
      def.stability = clamp(def.stability + RULES.captureStabilityShock, 0, 100);
      emitEvent(state, {
        type: "region_captured", visibility: "public", actor: nationId, target: defId,
        text: `${nationId} forces take ${regionName}.`,
        data: { region: order.toRegion, chanceBp, roll },
      });
    } else {
      addForces(att, order.fromRegion, Math.floor(order.strength / 2));
      const left = garrison - Math.floor(order.strength / 4);
      if (left > 0) def.forces[order.toRegion] = left;
      else delete def.forces[order.toRegion];
      emitEvent(state, {
        type: "assault_repulsed", visibility: "public", actor: nationId, target: defId,
        text: `${defId} forces hold ${regionName}.`,
        data: { region: order.toRegion, chanceBp, roll },
      });
    }
  }
}

function addForces(n: NationState, region: string, strength: number): void {
  if (strength <= 0) return;
  n.forces[region] = Math.min(100, (n.forces[region] ?? 0) + strength);
}
