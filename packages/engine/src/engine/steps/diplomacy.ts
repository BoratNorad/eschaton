import { imposeSanction, isBoundBy, runTreatyHook } from "../../logic/effect.js";
import { emitEvent } from "../../logic/events.js";
import { addPressure, shiftTension } from "../../logic/tension.js";
import { pairKey } from "../../util/determinism.js";
import { RULES } from "../rules.js";
import { ctxFor, hasActiveCeasefire, ordersOf, type Turn } from "../turn.js";
import { hasOpenProposal } from "./validate.js";

// Step 2. Sub-order: treaty proposals, signatures, withdrawals, covert
// violations, signals, sanctions, ceasefire proposals, ceasefire acceptances.
// Within each, nations in id order, then submission order.

export function resolveDiplomacy(t: Turn): void {
  const { state } = t;

  for (const { nationId, order } of ordersOf(t, "propose_treaty")) {
    emitEvent(state, {
      type: "treaty_proposed", visibility: "private", actor: nationId,
      audience: [nationId, ...order.to],
      text: `${nationId} proposes ${treatyName(t, order.treatyId)}.`,
      data: { treaty: order.treatyId },
    });
  }

  for (const { nationId, order } of ordersOf(t, "sign_treaty")) {
    const n = state.nations[nationId]!;
    const from = n.treaties[order.treatyId] ?? "nonparty";
    const to = from === "signed" ? "ratified" : "signed";
    n.treaties[order.treatyId] = to;
    emitEvent(state, {
      type: to === "ratified" ? "treaty_ratified" : "treaty_signed", visibility: "public", actor: nationId,
      text: `${nationId} ${to === "ratified" ? "ratifies" : "signs"} ${treatyName(t, order.treatyId)}.`,
      data: { treaty: order.treatyId },
    });
    if (to === "signed") runTreatyHook(ctxFor(t, order.treatyId), nationId, order.treatyId, "onSign");
  }

  for (const { nationId, order } of ordersOf(t, "withdraw_treaty")) {
    const n = state.nations[nationId]!;
    if (!isBoundBy(n.treaties[order.treatyId])) continue;
    n.treaties[order.treatyId] = "withdrawn";
    n.covertViolations = n.covertViolations.filter((v) => v.treatyId !== order.treatyId);
    emitEvent(state, {
      type: "treaty_withdrawn", visibility: "public", actor: nationId,
      text: `${nationId} withdraws from ${treatyName(t, order.treatyId)}.`,
      data: { treaty: order.treatyId },
    });
    runTreatyHook(ctxFor(t, order.treatyId), nationId, order.treatyId, "onWithdrawal");
  }

  for (const { nationId, order } of ordersOf(t, "covert_violation")) {
    const n = state.nations[nationId]!;
    if (!isBoundBy(n.treaties[order.treatyId])) continue; // withdrew earlier this step
    n.covertViolations.push({ treatyId: order.treatyId, sinceTurn: state.turn });
    emitEvent(state, {
      type: "covert_violation_started", visibility: "hidden", actor: nationId,
      text: `${nationId} secretly breaks ${treatyName(t, order.treatyId)} (${order.activity}).`,
      data: { treaty: order.treatyId, activity: order.activity },
    });
  }

  for (const { nationId, order } of ordersOf(t, "signal")) {
    const from = state.nations[nationId]!;
    const to = state.nations[order.to]!;
    emitEvent(state, {
      type: "signal", visibility: "private", actor: nationId, target: order.to,
      text: `${nationId} sends ${order.to} a ${order.signal}.`,
      data: { signal: order.signal },
    });
    // Sincerity is never shown to players; the replay reveals it.
    emitEvent(state, {
      type: "signal_intent", visibility: "hidden", actor: nationId, target: order.to,
      text: `${nationId}'s ${order.signal} to ${order.to} was ${order.sincere ? "sincere" : "a bluff"}.`,
      data: { signal: order.signal, sincere: order.sincere },
    });
    addPressure(state, from.side, to.side, RULES.signalPressure[order.signal], "signal");
  }

  for (const { nationId, order } of ordersOf(t, "sanction")) {
    const by = state.nations[nationId]!;
    imposeSanction(ctxFor(t, "sanction_order"), by.side, order.target, order.severity);
    addPressure(state, by.side, state.nations[order.target]!.side, RULES.sanctionPressure, "sanction");
  }

  for (const { nationId, order } of ordersOf(t, "propose_ceasefire")) {
    const side = state.nations[nationId]!.side;
    emitEvent(state, {
      type: "ceasefire_proposed", visibility: "public", actor: nationId,
      text: `${side} proposes a ceasefire to ${order.with}.`,
      data: { fromSide: side, toSide: order.with },
    });
  }

  // Acceptances, plus mutual same-turn proposals, become ceasefires.
  const agreements: Array<[string, string]> = [];
  for (const { nationId, order } of ordersOf(t, "accept_ceasefire")) agreements.push([state.nations[nationId]!.side, order.with]);
  for (const { nationId, order } of ordersOf(t, "propose_ceasefire")) {
    const side = state.nations[nationId]!.side;
    if (hasOpenProposal(state, order.with, side)) agreements.push([side, order.with]);
  }
  for (const [a, b] of agreements) {
    if (hasActiveCeasefire(state, a, b)) continue;
    state.ceasefires.push({ pair: pairKey(a, b), sinceTurn: state.turn });
    emitEvent(state, {
      type: "ceasefire_agreed", visibility: "public",
      text: `${a} and ${b} agree to a ceasefire.`, data: { pair: pairKey(a, b) },
    });
    shiftTension(state, a, b, -1, "ceasefire");
    const row = state.tensions[pairKey(a, b)];
    if (row) row.pressure = 0;
  }
}

function treatyName(t: Turn, id: string): string {
  return t.idx.treaties.get(id)?.name ?? id;
}
