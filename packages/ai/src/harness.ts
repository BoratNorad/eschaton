import {
  createGame, resolveTurn, viewFor,
  type ContentBundle, type GameState, type Order, type OrderSet, type PlayerView, type Scenario,
} from "@eschaton/engine";
import { decide } from "./choose.js";
import type { PlanKind } from "./plans.js";

// Headless games for balance testing. The harness itself sees everything (it
// is the referee), but every controller only ever receives its own PlayerView.

export type Controller = (view: PlayerView, gameSeed: number) => { orders: Order[]; plan?: PlanKind };

export interface GameRecord {
  seed: number;
  turns: number;
  outcomes: Record<string, "win" | "loss" | "draw">;
  victories: string;
  maxTension: number;
  firstWarTurn: number | null;
  firstLevel5Turn: number | null;
  nuclearUse: boolean;
  /** Nations that used nuclear weapons first (both, if simultaneous). */
  nuclearFirstUsers: string[];
  anyWmd: boolean;
  assaults: number;
  regionsCaptured: number;
  conventionalStrikes: number;
  triggersFired: Record<string, number>;
  plans: Record<string, Partial<Record<PlanKind, number>>>;
  finalStability: Record<string, number>;
}

export function aiController(content: ContentBundle, scenario: Scenario): Controller {
  return (view, gameSeed) => {
    const d = decide(content, scenario, view, { gameSeed });
    return { orders: d.orders, plan: d.plan };
  };
}

export function playGame(
  content: ContentBundle,
  scenario: Scenario,
  seed: number,
  controllers?: Record<string, Controller>,
): GameRecord {
  let state = createGame(content, scenario, seed);
  const ids = Object.keys(state.nations).sort();
  const ctl = controllers ?? Object.fromEntries(ids.map((id) => [id, aiController(content, scenario)]));
  const plans: GameRecord["plans"] = Object.fromEntries(ids.map((id) => [id, {}]));
  let maxTension = maxLevel(state);
  let firstWarTurn: number | null = null;
  let firstLevel5Turn: number | null = null;

  while (state.result === undefined) {
    const sets: OrderSet[] = [];
    for (const id of ids) {
      if (!state.nations[id]!.active) continue;
      const { orders, plan } = ctl[id]!(viewFor(content, state, id), seed);
      if (plan) plans[id]![plan] = (plans[id]![plan] ?? 0) + 1;
      sets.push({ nationId: id, turn: state.turn, orders });
    }
    const resolvedTurn = state.turn;
    state = resolveTurn(content, state, sets).state;
    const level = maxLevel(state);
    maxTension = Math.max(maxTension, level);
    if (level >= 4 && firstWarTurn === null) firstWarTurn = resolvedTurn;
    if (level >= 5 && firstLevel5Turn === null) firstLevel5Turn = resolvedTurn;
  }

  const ev = state.events;
  const nuclear = ev.filter((e) => e.type === "wmd_use" && e.data.payload === "nuclear");
  const firstNuclearTurn = nuclear[0]?.turn;
  return {
    seed,
    turns: state.result!.endedAtTurn,
    outcomes: state.result!.outcomes,
    victories: String(ev.find((e) => e.type === "game_over")?.data.victories ?? "none"),
    maxTension,
    firstWarTurn,
    firstLevel5Turn,
    nuclearUse: nuclear.length > 0,
    nuclearFirstUsers: [...new Set(nuclear.filter((e) => e.turn === firstNuclearTurn).map((e) => e.actor!))].sort(),
    anyWmd: ev.some((e) => e.type === "wmd_use"),
    assaults: ev.filter((e) => e.type === "region_captured" || e.type === "assault_repulsed").length,
    regionsCaptured: ev.filter((e) => e.type === "region_captured").length,
    conventionalStrikes: ev.filter((e) => e.type === "strike" && e.data.payload === "conventional").length,
    triggersFired: Object.fromEntries(Object.keys(state.triggerFires).sort().map((t) => [t, state.triggerFires[t]!.count])),
    plans,
    finalStability: Object.fromEntries(ids.map((id) => [id, state.nations[id]!.stability])),
  };
}

function maxLevel(s: GameState): number {
  return Math.max(1, ...Object.keys(s.tensions).map((k) => s.tensions[k]!.level));
}

// ----- aggregate report -----------------------------------------------------

export interface BalanceReport {
  games: number;
  outcomes: Record<string, { win: number; loss: number; draw: number }>;
  mutualLoss: number;
  length: { mean: number; median: number; p10: number; p90: number; fullLength: number };
  reachedWar: number;
  reachedLevel5: number;
  nuclearUse: number;
  anyWmd: number;
  nuclearFirstUser: Record<string, number>;
  meanAssaults: number;
  meanCaptures: number;
  meanConventionalStrikes: number;
  triggerFireRate: Record<string, number>;
  planMix: Record<string, Record<string, number>>;
  meanFinalStability: Record<string, number>;
  /** Share of games ending by victory id. */
  endings: Record<string, number>;
}

/** Shares are fractions 0-1. */
export function summarize(records: readonly GameRecord[], maxTurns: number): BalanceReport {
  const n = records.length;
  const share = (pred: (r: GameRecord) => boolean) => records.filter(pred).length / n;
  const mean = (f: (r: GameRecord) => number) => records.reduce((a, r) => a + f(r), 0) / n;
  const nations = Object.keys(records[0]?.outcomes ?? {}).sort();
  const lengths = records.map((r) => r.turns).sort((a, b) => a - b);
  const q = (p: number) => lengths[Math.min(n - 1, Math.floor(p * n))] ?? 0;

  const planMix: BalanceReport["planMix"] = {};
  for (const id of nations) {
    const totals: Record<string, number> = {};
    for (const r of records) for (const [k, v] of Object.entries(r.plans[id] ?? {})) totals[k] = (totals[k] ?? 0) + (v ?? 0);
    const all = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    planMix[id] = Object.fromEntries(Object.keys(totals).sort().map((k) => [k, totals[k]! / all]));
  }
  const endings: Record<string, number> = {};
  for (const r of records) endings[r.victories] = (endings[r.victories] ?? 0) + 1 / n;
  const triggers = Object.keys(records[0]?.triggersFired ?? {}).sort();

  return {
    games: n,
    outcomes: Object.fromEntries(
      nations.map((id) => [id, {
        win: share((r) => r.outcomes[id] === "win"),
        loss: share((r) => r.outcomes[id] === "loss"),
        draw: share((r) => r.outcomes[id] === "draw"),
      }]),
    ),
    mutualLoss: share((r) => nations.every((id) => r.outcomes[id] === "loss")),
    length: { mean: mean((r) => r.turns), median: q(0.5), p10: q(0.1), p90: q(0.9), fullLength: share((r) => r.turns >= maxTurns) },
    reachedWar: share((r) => r.maxTension >= 4),
    reachedLevel5: share((r) => r.maxTension >= 5),
    nuclearUse: share((r) => r.nuclearUse),
    anyWmd: share((r) => r.anyWmd),
    nuclearFirstUser: Object.fromEntries(nations.map((id) => [id, share((r) => r.nuclearFirstUsers.includes(id))])),
    meanAssaults: mean((r) => r.assaults),
    meanCaptures: mean((r) => r.regionsCaptured),
    meanConventionalStrikes: mean((r) => r.conventionalStrikes),
    triggerFireRate: Object.fromEntries(triggers.map((t) => [t, share((r) => (r.triggersFired[t] ?? 0) > 0)])),
    planMix,
    meanFinalStability: Object.fromEntries(nations.map((id) => [id, mean((r) => r.finalStability[id] ?? 0)])),
    endings,
  };
}
