import {
  getTension, indexContent, legalOrders, nextInt, pairKey, resolveTurn,
  type ContentBundle, type ContentIndex, type GameState, type Order, type PlayerView, type RngState, type Scenario,
} from "@eschaton/engine";
import { imagine } from "./imagine.js";
import { effective, ownStats, weightsFor, type Stats, type Weights } from "./personality.js";
import { buildPlan, PLAN_KINDS, type PlanKind } from "./plans.js";
import { aiRng } from "./rng.js";
import { scoreState } from "./score.js";

// Utility AI with crisis lookahead. Input is a PlayerView, never a GameState:
// fairness is enforced by the signature.
//
// Each turn: build a few whole-turn plans from the legal menu, imagine the
// hidden parts of the world from the AI's own beliefs, play each plan forward
// against a simple model of the rival (1 turn in calm times, 2 in a crisis,
// over several imagined worlds), score the results by the leader's weights,
// and pick the best. Nuclear plans are only considered once the leader's ESC
// threshold of provocation is crossed.

export interface AiOptions {
  /** The game's seed: with turn and nation, it seeds the AI's own random stream. */
  gameSeed: number;
  /** Imagined worlds per plan in a crisis (default 2). */
  crisisSamples?: number;
}

export interface Decision {
  orders: Order[];
  plan: PlanKind;
  scores: Partial<Record<PlanKind, number>>;
  nuclearGateOpen: boolean;
}

export function chooseOrders(content: ContentBundle, scenario: Scenario, view: PlayerView, opts: AiOptions): Order[] {
  return decide(content, scenario, view, opts).orders;
}

export function decide(content: ContentBundle, scenario: Scenario, view: PlayerView, opts: AiOptions): Decision {
  const me = view.viewer;
  const idx = indexContent(content);
  const rng = aiRng(opts.gameSeed, view.turn, me);
  const rival = mainRival(idx, view);
  const stats = ownStats(view);
  const w = weightsFor(stats);
  const level = viewTension(idx, view, rival);
  const crisis = level >= 3;
  const samples = crisis ? opts.crisisSamples ?? 2 : 1;
  const depth = crisis ? 2 : 1;
  const gate = nuclearGateOpen(idx, scenario, view, stats, rival);

  const worlds = Array.from({ length: samples }, () => imagine(content, scenario, view, rng));
  const menu = legalOrders(content, worlds[0]!, me);

  const scores: Partial<Record<PlanKind, number>> = {};
  let best: { plan: PlanKind; orders: Order[]; score: number } | undefined;
  const seen = new Set<string>();
  for (const plan of PLAN_KINDS) {
    if (plan === "nuclear" && !gate) continue;
    const orders = buildPlan(plan, { content, state: worlds[0]!, me, rival, menu, stats, rng });
    if (orders === null) continue;
    const key = JSON.stringify(orders);
    if (seen.has(key)) continue;
    seen.add(key);

    const results = worlds.map((world) => rollout(content, idx, world, me, rival, orders, depth, w, rng));
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    const worst = Math.min(...results);
    const noise = (nextInt(rng, 2001) - 1000) / 100; // +-10: variety between otherwise identical games
    const score = (1 - w.caution) * mean + w.caution * worst + noise;
    scores[plan] = Math.round(score);
    if (!best || score > best.score) best = { plan, orders, score };
  }
  const chosen = best ?? { plan: "steady" as const, orders: [], score: 0 };
  return { orders: chosen.orders, plan: chosen.plan, scores, nuclearGateOpen: gate };
}

function rollout(
  content: ContentBundle, idx: ContentIndex, world: GameState, me: string, rival: string,
  myOrders: Order[], depth: number, w: Weights, rng: RngState,
): number {
  let s = world;
  let mine = myOrders;
  for (let d = 0; d < depth && s.result === undefined; d++) {
    const theirs = rivalModel(content, idx, s, rival, me, rng);
    s = resolveTurn(content, s, [
      { nationId: me, turn: s.turn, orders: mine },
      { nationId: rival, turn: s.turn, orders: theirs },
    ]).state;
    if (d + 1 < depth && s.result === undefined) {
      // After our move, assume we hold steady and see how the rival reacts.
      const menu = legalOrders(content, s, me);
      mine = buildPlan("steady", { content, state: s, me, rival, menu, stats: effective(s.nations[me]!, s.turn), rng }) ?? [];
    }
  }
  return scoreState(idx, s, me, rival, w);
}

/**
 * What we expect the rival to do, from public information: its leader's stats
 * (published in content) and the situation. Deliberately simple: no lookahead,
 * so the AI never recurses into simulating the rival simulating it.
 */
function rivalModel(content: ContentBundle, idx: ContentIndex, s: GameState, rival: string, me: string, rng: RngState): Order[] {
  const n = s.nations[rival]!;
  const stats = publicStats(idx, n.leaderId) ?? effective(n, s.turn);
  const level = getTension(s, n.side, s.nations[me]!.side).level;
  const nukedBy = s.events.some((e) => e.type === "wmd_use" && e.actor === me && e.target === rival && e.data.payload === "nuclear");
  const plan: PlanKind =
    nukedBy ? "nuclear"
    : level >= 4 && stats.agg >= 6 ? "strike"
    : level >= 3 && stats.agg >= 6 ? "coerce"
    : level >= 3 ? "posture"
    : "steady";
  const menu = legalOrders(content, s, rival);
  const input = { content, state: s, me: rival, rival: me, menu, stats, rng };
  return buildPlan(plan, input) ?? buildPlan("steady", input) ?? [];
}

function publicStats(idx: ContentIndex, leaderId: string): Stats | undefined {
  return idx.leaders.get(leaderId)?.stats;
}

/**
 * ESC as a provocation threshold. Provocation counts what the compendium's
 * red lines describe: WMD used against us, ground lost, the capital hit, the
 * ladder at its top, the regime shaking. A No First Use leader never opens
 * the gate until WMD has been used against them.
 */
export function nuclearGateOpen(idx: ContentIndex, scenario: Scenario, view: PlayerView, stats: Stats, rival: string): boolean {
  const me = view.viewer;
  if (view.self.nuclear.warheads === 0) return false;
  const wmdAgainstMe = view.events.filter((e) => e.type === "wmd_use" && e.target === me);
  const nfu = idx.leaders.get(view.self.leaderId)?.traits.some((t) => t.id === "no_first_use") ?? false;
  if (nfu && wmdAgainstMe.length === 0) return false;

  let provocation = 0;
  if (wmdAgainstMe.some((e) => e.data.payload === "nuclear")) provocation += 4;
  else if (wmdAgainstMe.length > 0) provocation += 2;
  const map = idx.maps.get(scenario.mapId)!;
  provocation += map.regions.filter((r) => r.controller === me && view.control[r.id] !== me).length;
  const capital = idx.nations.get(me)!.capitalMetroId;
  if ((view.self.metros[capital]?.damage ?? 0) > 0) provocation += 2;
  if (viewTension(idx, view, rival) === 5) provocation += 1;
  if (view.self.stability < 30) provocation += 1;
  return provocation >= Math.ceil(stats.esc / 2);
}

/** The rival we face most tension with (sorted id breaks ties). */
function mainRival(idx: ContentIndex, view: PlayerView): string {
  let best = "";
  let bestLevel = -1;
  for (const id of Object.keys(view.others).sort()) {
    const level = viewTension(idx, view, id);
    if (level > bestLevel) [best, bestLevel] = [id, level];
  }
  return best;
}

/** Tension between the viewer and another nation, read from the (public) ladder. */
function viewTension(idx: ContentIndex, view: PlayerView, other: string): number {
  return view.tensions[pairKey(view.self.side, sideOf(idx, view, other))]?.level ?? 1;
}

/** A nation's side, from public content: its own id in a split theater, else its coalition. */
function sideOf(idx: ContentIndex, view: PlayerView, nationId: string): string {
  const coalition = view.others[nationId]?.coalition;
  if (coalition === undefined) return nationId;
  return idx.coalitions.get(coalition)?.splitTheater ? nationId : coalition;
}
