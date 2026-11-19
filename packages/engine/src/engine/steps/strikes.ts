import { violateTreaty } from "../../logic/effect.js";
import { emitEvent } from "../../logic/events.js";
import { shiftTension } from "../../logic/tension.js";
import { clamp } from "../../logic/values.js";
import { rollBp } from "../../rng.js";
import type { GameState, NationState, Payload, SiteStatus } from "../../schema/index.js";
import { pairKey, sortedEntries } from "../../util/determinism.js";
import { MISSILE_KINDS, NUCLEAR_FACILITY_KINDS, RULES } from "../rules.js";
import { ctxFor, locateTarget, nationContent, ordersOf, tensionLevel, type Turn } from "../turn.js";
import { breakCeasefire } from "./ceasefire.js";

// Step 5. Every strike accepted in step 1 is launched: legality, launcher
// counts and range were fixed from start-of-turn positions, so a launcher
// destroyed this turn still fires (simultaneous resolution). Strikes then
// apply in nation id / submission order.
//
// RNG per strike, in order: one hit roll per launcher; then, for a site hit by
// conventional payload, one damage roll per hit.

export function resolveStrikes(t: Turn): void {
  const { state } = t;
  const strikes = ordersOf(t, "strike");
  if (strikes.length === 0) return;

  const wmdBefore = state.events.some((e) => e.type === "wmd_use");
  const firstUsers = new Set<string>();
  const facilityViolations = new Set<string>();

  for (const { nationId, order } of strikes) {
    const att = state.nations[nationId]!;
    const target = locateTarget(t, order.targetId)!;
    const def = state.nations[target.ownerId]!;
    const system = nationContent(t, nationId).delivery.find((d) => d.id === order.deliveryId)!;
    const isMissile = (MISSILE_KINDS as readonly string[]).includes(system.kind);
    const wmd = order.payload !== "conventional";

    breakCeasefire(t, nationId, def.side);

    const hitBp = Math.max(
      RULES.minBattleBp,
      isMissile
        ? RULES.missileHitBp - def.cbrn.missileDefense * RULES.missileDefenseBpPerPoint
        : RULES.aircraftHitBp - nationContent(t, target.ownerId).conventional.air * RULES.airDefenseBpPerPoint,
    );
    let hits = 0;
    for (let i = 0; i < order.count; i++) if (rollBp(state.rng, hitBp)) hits++;

    // Spend: missiles are expended; aircraft that miss are lost.
    const lost = isMissile ? order.count : order.count - hits;
    att.deliveryCounts[system.id] = Math.max(0, (att.deliveryCounts[system.id] ?? 0) - lost);
    if (order.payload === "nuclear") att.nuclear.warheads -= order.count;
    if (order.payload === "chemical") att.chemicalTonnes -= order.count * RULES.chemicalTonnesPerLauncher;

    if (target.kind === "site") {
      for (let i = 0; i < hits; i++) {
        const before = def.sites[order.targetId] ?? "intact";
        def.sites[order.targetId] = siteAfterHit(state, before, order.payload, target.hardness);
      }
      const kinds = nationContent(t, target.ownerId).sites.find((s) => s.id === order.targetId)!.kinds;
      if (hits > 0 && kinds.some((k) => (NUCLEAR_FACILITY_KINDS as readonly string[]).includes(k)))
        for (const tid of [...t.scenario.treaties].sort()) {
          const key = `${nationId}|${tid}`;
          if (facilityViolations.has(key)) continue;
          if (!t.idx.treaties.get(tid)?.covers.includes("nuclear_facility_attack")) continue;
          facilityViolations.add(key);
          violateTreaty(ctxFor(t, "strike"), nationId, tid);
        }
    } else if (hits > 0) {
      const metro = def.metros[order.targetId]!;
      const per = RULES.metroDamage[order.payload];
      const mitigation = metroMitigation(def, order.payload);
      metro.damage = Math.min(100, metro.damage + Math.floor((hits * per * (100 - mitigation)) / 100));
      if (wmd) metro.contaminated = true;
    }

    if (hits > 0) {
      const shock = wmd ? RULES.wmdStabilityShock : RULES.conventionalStabilityShockPerHit * hits;
      def.stability = clamp(def.stability + shock, 0, 100);
    }

    emitEvent(state, {
      type: "strike", visibility: "public", actor: nationId, target: target.ownerId,
      text: `${nationId} strikes ${target.name} (${order.payload}): ${hits} of ${order.count} hit.`,
      data: { targetId: order.targetId, payload: order.payload, launched: order.count, hits, delivery: system.id },
    });
    if (wmd) {
      emitEvent(state, {
        type: "wmd_use", visibility: "public", actor: nationId, target: target.ownerId,
        text: `${nationId} has used ${order.payload} weapons against ${target.ownerId}.`,
        data: { payload: order.payload, actorSide: att.side, targetSide: def.side },
      });
      if (!wmdBefore) firstUsers.add(nationId);
    }

    // Compendium: each WMD use moves every OTHER pair up one level.
    if (wmd) {
      const own = pairKey(att.side, def.side);
      for (const [key] of sortedEntries(state.tensions)) {
        if (key === own) continue;
        const [a, b] = key.split("|") as [string, string];
        shiftTension(state, a, b, 1, "wmd_spillover");
      }
    }

    const floor = wmd ? RULES.wmdLevel : RULES.warLevel;
    const level = tensionLevel(state, att.side, def.side);
    if (level < floor) shiftTension(state, att.side, def.side, floor - level, "strike");
    const row = state.tensions[pairKey(att.side, def.side)];
    if (row) row.lastIncidentTurn = state.turn;
  }

  // Simultaneous: everyone who used WMD in the first turn anyone did is a first user.
  for (const id of [...firstUsers].sort())
    emitEvent(state, {
      type: "wmd_first_use", visibility: "public", actor: id,
      text: `${id} is the first to cross the WMD threshold.`, data: {},
    });

  emitNuclearExchanges(state);
}

function siteAfterHit(state: GameState, status: SiteStatus, payload: Payload, hardness: number): SiteStatus {
  const worse: SiteStatus = status === "intact" ? "damaged" : "destroyed";
  switch (payload) {
    case "conventional":
      return rollBp(state.rng, (10 - hardness) * RULES.conventionalSiteBpPerSoftness) ? worse : status;
    case "nuclear":
      return hardness <= RULES.nuclearDestroysHardness ? "destroyed" : worse;
    case "chemical":
    case "biological":
    case "radiological":
      return status === "intact" || status === "damaged" ? "contaminated" : status;
  }
}

function metroMitigation(def: NationState, payload: Payload): number {
  switch (payload) {
    case "chemical":
      return def.cbrn.protection;
    case "biological":
      return def.cbrn.medical;
    case "radiological":
      return def.cbrn.decontamination;
    case "nuclear":
    case "conventional":
      return 0;
  }
}

/** A pair becomes a nuclear exchange once each side has used nuclear weapons on the other. */
function emitNuclearExchanges(state: GameState): void {
  const used = new Set<string>();
  const done = new Set<string>();
  for (const e of state.events) {
    if (e.type === "wmd_use" && e.data.payload === "nuclear") used.add(`${e.data.actorSide}>${e.data.targetSide}`);
    if (e.type === "nuclear_exchange") done.add(String(e.data.pair));
  }
  for (const [key] of sortedEntries(state.tensions)) {
    const [a, b] = key.split("|") as [string, string];
    if (done.has(key) || !used.has(`${a}>${b}`) || !used.has(`${b}>${a}`)) continue;
    emitEvent(state, {
      type: "nuclear_exchange", visibility: "public",
      text: `Nuclear exchange between ${a} and ${b}.`, data: { pair: key },
    });
  }
}
