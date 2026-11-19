import { emitEvent } from "../../logic/events.js";
import { isBoundBy, treatyInForce } from "../../logic/effect.js";
import { sortedEntries } from "../../util/determinism.js";
import { OrderSet, type GameState, type NationState, type Order } from "../../schema/index.js";
import { RULES, UNLOCK_COERCIVE_MOBILIZATION } from "../rules.js";
import {
  areAdjacent, distanceKm, hasActiveCeasefire, locateTarget, maxTensionFor, nationContent, regionController,
  tensionLevel, type AcceptedOrder, type OrderOf, type Turn,
} from "../turn.js";

// Step 1. Every order is judged against the START-of-turn state (nothing has
// been mutated yet), plus per-turn budgets accumulated in submission order.
// Rejected orders produce a private `order_rejected` event for their sender.

const INVEST_TRACKS_AVAILABLE = new Set([
  "nuclear", "conventional", "stability",
  "cbrn_detection", "cbrn_protection", "cbrn_decontamination", "cbrn_medical", "missile_defense",
]);

/** Per-nation budgets used so far this turn. */
interface Usage {
  alert: boolean;
  mobilize: boolean;
  intelFocus: boolean;
  investPoints: number;
  sanctionSeverity: number;
  deployedFrom: Map<string, number>;
  launchers: Map<string, number>;
  warheads: number;
  chemicalTonnes: number;
  treatyActions: Set<string>;
  ceasefireSides: Set<string>;
}

function newUsage(): Usage {
  return {
    alert: false, mobilize: false, intelFocus: false, investPoints: 0, sanctionSeverity: 0,
    deployedFrom: new Map(), launchers: new Map(), warheads: 0, chemicalTonnes: 0,
    treatyActions: new Set(), ceasefireSides: new Set(),
  };
}

export function validateOrders(t: Turn, submitted: readonly unknown[]): AcceptedOrder[] {
  const { state } = t;
  const sets: Array<{ set: OrderSet; at: number }> = [];
  submitted.forEach((raw, at) => {
    const parsed = OrderSet.safeParse(raw);
    if (!parsed.success) {
      emitEvent(state, {
        type: "orders_malformed", visibility: "hidden", text: "An order set failed schema validation and was dropped.",
        data: { position: at, issue: parsed.error.issues[0]?.message ?? "invalid" },
      });
      return;
    }
    sets.push({ set: parsed.data, at });
  });
  // Sort by nation; for duplicate nations, the earliest submission wins.
  sets.sort((x, y) => (x.set.nationId < y.set.nationId ? -1 : x.set.nationId > y.set.nationId ? 1 : x.at - y.at));

  const accepted: AcceptedOrder[] = [];
  const seen = new Set<string>();
  for (const { set } of sets) {
    const n = state.nations[set.nationId];
    const reject = (reason: string) =>
      emitEvent(state, {
        type: "orders_ignored", visibility: n ? "private" : "hidden", actor: n ? set.nationId : undefined,
        text: `Orders ignored: ${reason}.`, data: { reason },
      });
    if (n === undefined || !n.active) { reject("nation is not playing"); continue; }
    if (seen.has(set.nationId)) { reject("duplicate order set"); continue; }
    seen.add(set.nationId);
    if (set.turn !== state.turn) { reject(`orders are for turn ${set.turn}, not ${state.turn}`); continue; }

    const usage = newUsage();
    set.orders.forEach((order, index) => {
      const reason = checkOrder(t, set.nationId, n, order, usage);
      if (reason === null) {
        accepted.push({ nationId: set.nationId, index, order });
      } else {
        emitEvent(state, {
          type: "order_rejected", visibility: "private", actor: set.nationId,
          text: `Order ${index + 1} (${order.kind}) was not carried out: ${reason}.`,
          data: { index, kind: order.kind, reason },
        });
      }
    });
  }
  return accepted;
}

/** Null if legal (and charges the budget), else a short reason. */
export function checkOrder(t: Turn, nationId: string, n: NationState, order: Order, u: Usage): string | null {
  const { state } = t;
  const rival = (id: string): string | null => {
    if (id === nationId) return "cannot target yourself";
    const other = state.nations[id];
    if (other === undefined || !other.active) return `${id} is not in this game`;
    return null;
  };

  switch (order.kind) {
    case "set_alert":
      if (u.alert) return "only one alert order per turn";
      u.alert = true;
      return null;

    case "mobilize": {
      if (u.mobilize) return "only one mobilize order per turn";
      if (order.level > RULES.mobilizationFreeCap) {
        const unlocked = n.unlockedActions.some((a) => a.action === UNLOCK_COERCIVE_MOBILIZATION && state.turn < a.untilTurn);
        if (!unlocked && maxTensionFor(state, nationId) < RULES.warLevel)
          return `mobilizing above ${RULES.mobilizationFreeCap} needs war-level tension or a crisis unlock`;
      }
      u.mobilize = true;
      return null;
    }

    case "deploy":
      return checkDeploy(t, nationId, n, order, u);

    case "signal":
      return rival(order.to);

    case "propose_treaty": {
      if (!t.scenario.treaties.includes(order.treatyId)) return "treaty is not in this scenario";
      if (new Set(order.to).size !== order.to.length) return "duplicate recipients";
      for (const id of order.to) {
        const r = rival(id);
        if (r) return r;
      }
      return null;
    }

    case "sign_treaty":
    case "withdraw_treaty": {
      if (!t.scenario.treaties.includes(order.treatyId)) return "treaty is not in this scenario";
      if (u.treatyActions.has(order.treatyId)) return "only one action per treaty per turn";
      const status = n.treaties[order.treatyId] ?? "nonparty";
      if (order.kind === "sign_treaty" && status === "ratified") return "already ratified";
      if (order.kind === "withdraw_treaty" && !isBoundBy(status)) return "not a party";
      u.treatyActions.add(order.treatyId);
      return null;
    }

    case "covert_violation": {
      const treaty = t.idx.treaties.get(order.treatyId);
      if (treaty === undefined || !t.scenario.treaties.includes(order.treatyId)) return "treaty is not in this scenario";
      if (!isBoundBy(n.treaties[order.treatyId])) return "not bound by this treaty";
      if (!treatyInForce(state, treaty.inForce, treaty.entersForceAtPhase)) return "treaty is not in force";
      if (n.covertViolations.some((v) => v.treatyId === order.treatyId)) return "already violating this treaty";
      if (u.treatyActions.has(order.treatyId)) return "only one action per treaty per turn";
      u.treatyActions.add(order.treatyId);
      return null;
    }

    case "sanction": {
      const r = rival(order.target);
      if (r) return r;
      if (state.nations[order.target]!.side === n.side) return "cannot sanction your own side";
      if (order.severity < 1) return "severity must be at least 1";
      if (u.sanctionSeverity + order.severity > RULES.maxSanctionPerTurn)
        return `total sanction severity is capped at ${RULES.maxSanctionPerTurn} per turn`;
      u.sanctionSeverity += order.severity;
      return null;
    }

    case "invest": {
      if (!INVEST_TRACKS_AVAILABLE.has(order.track)) return `${order.track} investment is not available yet`;
      if (order.track === "nuclear" && n.nuclear.statusIndex < 4) return "no nuclear arsenal to expand";
      if (u.investPoints + order.amount > RULES.investPointsPerTurn)
        return `investment is capped at ${RULES.investPointsPerTurn} points per turn`;
      u.investPoints += order.amount;
      return null;
    }

    case "intel_focus": {
      if (u.intelFocus) return "only one intel focus per turn";
      const r = rival(order.target);
      if (r) return r;
      u.intelFocus = true;
      return null;
    }

    case "propose_ceasefire":
    case "accept_ceasefire": {
      const side = order.with;
      if (side === n.side) return "cannot make a ceasefire with your own side";
      if (!sortedEntries(state.nations).some(([, x]) => x.side === side && x.active)) return `${side} is not a side in this game`;
      if (hasActiveCeasefire(state, n.side, side)) return "a ceasefire is already in force";
      if (u.ceasefireSides.has(side)) return "only one ceasefire order per side per turn";
      if (order.kind === "accept_ceasefire" && !hasOpenProposal(state, side, n.side)) return "no open ceasefire proposal";
      u.ceasefireSides.add(side);
      return null;
    }

    case "strike":
      return checkStrike(t, nationId, n, order, u);

    case "aid":
    case "join_pipeline":
    case "recruit":
      return `${order.kind} is not available in this scenario`;

    case "use_trait":
      return "leader traits are not implemented yet";
  }
}

/** A ceasefire_proposed event from `fromSide` to `toSide` within the proposal window. */
export function hasOpenProposal(state: GameState, fromSide: string, toSide: string): boolean {
  const since = state.turn - RULES.ceasefireProposalTurns;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]!;
    if (e.turn < since) break;
    if (e.type === "ceasefire_proposed" && e.data.fromSide === fromSide && e.data.toSide === toSide) return true;
  }
  return false;
}

function checkDeploy(t: Turn, nationId: string, n: NationState, o: OrderOf<"deploy">, u: Usage): string | null {
  const { state, map } = t;
  if (o.fromRegion === o.toRegion) return "origin and destination are the same";
  if (!map.regions.some((r) => r.id === o.toRegion)) return `unknown region ${o.toRegion}`;
  const available = (n.forces[o.fromRegion] ?? 0) - (u.deployedFrom.get(o.fromRegion) ?? 0);
  if (available < o.strength) return `only ${available} strength available in ${o.fromRegion}`;
  if (!areAdjacent(map, o.fromRegion, o.toRegion)) return `${o.toRegion} is not adjacent to ${o.fromRegion}`;
  const controller = regionController(state, o.toRegion);
  if (controller !== undefined && controller !== nationId) {
    const defSide = state.nations[controller]!.side;
    if (defSide !== n.side && tensionLevel(state, n.side, defSide) < RULES.assaultLevel)
      return `an assault needs tension level ${RULES.assaultLevel} or higher`;
  }
  u.deployedFrom.set(o.fromRegion, (u.deployedFrom.get(o.fromRegion) ?? 0) + o.strength);
  return null;
}

function checkStrike(t: Turn, nationId: string, n: NationState, o: OrderOf<"strike">, u: Usage): string | null {
  const { state, map } = t;
  const target = locateTarget(t, o.targetId);
  if (target === undefined) return `unknown target ${o.targetId}`;
  const owner = state.nations[target.ownerId];
  if (target.ownerId === nationId || owner === undefined || !owner.active) return "not a valid target";
  if (owner.side === n.side) return "cannot strike your own side";
  const level = tensionLevel(state, n.side, owner.side);
  const wmd = o.payload !== "conventional";
  if (level < RULES.warLevel) return `strikes need tension level ${RULES.warLevel} or higher`;
  if (wmd && level < RULES.wmdLevel) return `WMD use needs tension level ${RULES.wmdLevel}`;

  const system = nationContent(t, nationId).delivery.find((d) => d.id === o.deliveryId);
  if (system === undefined) return `unknown delivery system ${o.deliveryId}`;
  if (!system.payloads.includes(o.payload)) return `${system.name} cannot carry a ${o.payload} payload`;
  const launchersLeft = (n.deliveryCounts[system.id] ?? 0) - (u.launchers.get(system.id) ?? 0);
  if (launchersLeft < o.count) return `only ${launchersLeft} ${system.name} available`;
  if (n.alert > 5 - system.readyTurns) return `${system.name} needs alert level ${5 - system.readyTurns} or lower`;

  switch (o.payload) {
    case "nuclear":
      if (n.alert > RULES.nuclearAlertMax) return `nuclear release needs alert level ${RULES.nuclearAlertMax} or lower`;
      if (n.nuclear.warheads - u.warheads < o.count) return "not enough warheads";
      break;
    case "chemical":
      if (n.chemicalTonnes - u.chemicalTonnes < o.count * RULES.chemicalTonnesPerLauncher) return "not enough chemical stock";
      break;
    case "biological":
      if (n.bioCapability === 0) return "no biological capability";
      break;
    case "radiological":
      if (nationContent(t, nationId).radiological.capability === 0) return "no radiological capability";
      break;
    case "conventional":
      break;
  }

  // Range: from operational basing sites, or from any controlled region for road-mobile systems.
  const origins = system.basingSiteIds.length > 0
    ? system.basingSiteIds
        .filter((sid) => n.sites[sid] !== "destroyed" && n.sites[sid] !== "captured")
        .map((sid) => nationContent(t, nationId).sites.find((s) => s.id === sid)!.regionId)
    : n.regionsControlled;
  if (origins.length === 0) return `${system.name} has no operational base`;
  let best = Number.MAX_SAFE_INTEGER;
  for (const r of origins) {
    const d = distanceKm(map, r, target.regionId);
    if (d !== undefined && d < best) best = d;
  }
  if (best > system.rangeKm) return `${target.name} is out of range of ${system.name}`;

  u.launchers.set(system.id, (u.launchers.get(system.id) ?? 0) + o.count);
  if (o.payload === "nuclear") u.warheads += o.count;
  if (o.payload === "chemical") u.chemicalTonnes += o.count * RULES.chemicalTonnesPerLauncher;
  return null;
}
