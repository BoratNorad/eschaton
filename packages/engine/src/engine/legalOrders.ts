import type { ContentBundle } from "../content/bundle.js";
import { indexContent } from "../content/index-content.js";
import type { GameState, Order, OrderSet } from "../schema/index.js";
import { sortedEntries } from "../util/determinism.js";
import { RULES } from "./rules.js";
import { judgeOrder, judgeOrders } from "./steps/validate.js";
import { activeNations, makeTurn, nationContent, type Turn } from "./turn.js";

// Two read-only entry points over the step-1 rules:
//
// legalOrders   A MENU for clients and AI: every order kind this nation can use
//               now, each legal on its own. Numeric fields are sampled (see
//               below), so it is not exhaustive: an unlisted value can still be
//               legal. Budgets are per order, so two listed orders may not fit
//               in one turn together.
// checkOrderSet The AUTHORITY: exactly what step 1 will accept, in submission
//               order with shared budgets. The server uses this to reject
//               orders as they arrive.

const MOBILIZE_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const SANCTION_SEVERITIES = [10, 25, 50];
const SIGNALS = ["reassurance", "warning", "threat", "ultimatum"] as const;
const INVEST_TRACKS = [
  "nuclear", "conventional", "stability",
  "cbrn_detection", "cbrn_protection", "cbrn_decontamination", "cbrn_medical", "missile_defense",
] as const;
/** Activity label for covert_violation menu entries; any slug is accepted. */
const COVERT_ACTIVITY = "breach";

/** Orders legal for `nationId` this turn, each judged alone. Sorted by kind, then generation order. */
export function legalOrders(content: ContentBundle, state: GameState, nationId: string): Order[] {
  if (state.result !== undefined) return [];
  const n = state.nations[nationId];
  if (n === undefined || !n.active) return [];
  const t = makeTurn(indexContent(content), state);
  return candidates(t, nationId).filter((o) => judgeOrder(t, nationId, n, o) === null);
}

export interface OrderSetCheck {
  /** Set-level problem (wrong turn, nation not playing); when present, no order is accepted. */
  setError?: string;
  /** One entry per submitted order: null = accepted, else the reason it will be dropped. */
  orders: Array<string | null>;
}

/** Exactly what step 1 of resolveTurn will accept from this set. */
export function checkOrderSet(content: ContentBundle, state: GameState, set: OrderSet): OrderSetCheck {
  const n = state.nations[set.nationId];
  const fail = (setError: string): OrderSetCheck => ({ setError, orders: set.orders.map(() => setError) });
  if (state.result !== undefined) return fail("the game is over");
  if (n === undefined || !n.active) return fail("nation is not playing");
  if (set.turn !== state.turn) return fail(`orders are for turn ${set.turn}, not ${state.turn}`);
  const t = makeTurn(indexContent(content), state);
  return { orders: judgeOrders(t, set.nationId, set.orders) };
}

function candidates(t: Turn, nationId: string): Order[] {
  const { state, map } = t;
  const n = state.nations[nationId]!;
  const content = nationContent(t, nationId);
  const others = activeNations(state).map(([id]) => id).filter((id) => id !== nationId);
  const otherSides = [...new Set(others.map((id) => state.nations[id]!.side))].filter((s) => s !== n.side).sort();
  const scenarioTreaties = [...t.scenario.treaties].sort();
  const out: Order[] = [];

  // Posture
  for (let level = 1; level <= 5; level++) if (level !== n.alert) out.push({ kind: "set_alert", level });
  for (const level of MOBILIZE_LEVELS) if (level !== n.mobilization) out.push({ kind: "mobilize", level });
  for (const track of INVEST_TRACKS)
    for (let amount = 1; amount <= RULES.investPointsPerTurn; amount++) out.push({ kind: "invest", track, amount });
  for (const target of others) out.push({ kind: "intel_focus", target });

  // Movement: every adjacent region, strengths in steps of 5 plus the full garrison.
  for (const [from, available] of sortedEntries(n.forces)) {
    const strengths = [...new Set([...stepsOf5(available), available])].filter((s) => s >= 1);
    const neighbours = map.links
      .flatMap((l) => (l.from === from ? [l.to] : l.to === from ? [l.from] : []))
      .sort();
    for (const to of [...new Set(neighbours)])
      for (const strength of strengths) out.push({ kind: "deploy", fromRegion: from, toRegion: to, strength });
  }

  // Diplomacy
  for (const to of others)
    for (const signal of SIGNALS)
      for (const sincere of [true, false]) out.push({ kind: "signal", to, signal, sincere });
  for (const treatyId of scenarioTreaties) {
    if (others.length > 0) out.push({ kind: "propose_treaty", treatyId, to: others });
    out.push({ kind: "sign_treaty", treatyId });
    out.push({ kind: "withdraw_treaty", treatyId });
    out.push({ kind: "covert_violation", treatyId, activity: COVERT_ACTIVITY });
  }
  for (const target of others)
    for (const severity of SANCTION_SEVERITIES) out.push({ kind: "sanction", target, severity });
  for (const side of otherSides) {
    out.push({ kind: "propose_ceasefire", with: side });
    out.push({ kind: "accept_ceasefire", with: side });
  }

  // Strikes: every rival site and metro x delivery system x payload, at count 1 and at the max.
  for (const targetNation of others) {
    const tc = nationContent(t, targetNation);
    const known = new Set(state.beliefs[nationId]?.[targetNation]?.knownSites ?? []);
    const targets = [...tc.sites.map((s) => s.id).filter((id) => known.has(id)), ...tc.metros.map((m) => m.id)].sort();
    for (const targetId of targets)
      for (const d of content.delivery)
        for (const payload of d.payloads) {
          const max = maxLaunch(n, d.id, payload);
          for (const count of [...new Set([1, max])].filter((c) => c >= 1))
            out.push({ kind: "strike", targetId, deliveryId: d.id, payload, count });
        }
  }

  // aid, recruit, join_pipeline and use_trait have no legal form in slice 1.
  return out;
}

function stepsOf5(max: number): number[] {
  const out: number[] = [];
  for (let s = 5; s <= max; s += 5) out.push(s);
  return out;
}

function maxLaunch(n: GameState["nations"][string], deliveryId: string, payload: string): number {
  const launchers = n.deliveryCounts[deliveryId] ?? 0;
  if (payload === "nuclear") return Math.min(launchers, n.nuclear.warheads);
  if (payload === "chemical") return Math.min(launchers, Math.floor(n.chemicalTonnes / RULES.chemicalTonnesPerLauncher));
  return launchers;
}
