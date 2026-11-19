import { rollBp } from "../rng.js";
import type { Condition } from "../schema/index.js";
import { nationState, requireRng, resolveNationId, resolveSide, type EvalContext } from "./context.js";
import { getTension } from "./tension.js";
import { assertNever, effectiveStat, metricValue } from "./values.js";

/**
 * Evaluate a Condition against ctx.state.
 *
 * - Reads state only, except `chance`, which advances ctx.rng by exactly one draw.
 * - `all` / `any` short-circuit left to right. The number of draws therefore
 *   depends on state, never on iteration order, so it stays deterministic.
 * - A nation id that is valid content but not in this game makes its leaf false
 *   (so `not` of it is true). An unbound `$` ref throws LogicError.
 */
export function evaluateCondition(ctx: EvalContext, c: Condition): boolean {
  const { state } = ctx;
  switch (c.kind) {
    case "always":
      return true;
    case "all":
      return c.of.every((x) => evaluateCondition(ctx, x));
    case "any":
      return c.of.some((x) => evaluateCondition(ctx, x));
    case "not":
      return !evaluateCondition(ctx, c.cond);
    case "phase_is":
      return state.phase === c.phase;
    case "turn_at_least":
      return state.turn >= c.turn;
    case "tension_at_least": {
      const a = resolveSide(ctx, c.pair[0]);
      const b = resolveSide(ctx, c.pair[1]);
      if (a === b) return false;
      return getTension(state, a, b).level >= c.level;
    }
    case "stat_at_least":
    case "stat_at_most": {
      const n = nationState(ctx, c.nation);
      if (n === undefined) return false;
      const v = effectiveStat(state, n, c.stat);
      return c.kind === "stat_at_least" ? v >= c.value : v <= c.value;
    }
    case "metric_at_least":
    case "metric_at_most": {
      const n = nationState(ctx, c.nation);
      if (n === undefined) return false;
      const v = metricValue(n, c.metric);
      return c.kind === "metric_at_least" ? v >= c.value : v <= c.value;
    }
    case "flag_set":
      return state.flags[c.flag] === true;
    case "event_occurred": {
      const fromTurn = state.turn - c.withinTurns;
      const actor = c.actor === undefined ? undefined : resolveNationId(ctx, c.actor);
      const target = c.target === undefined ? undefined : resolveNationId(ctx, c.target);
      // Newest first: recent events are the common case.
      for (let i = state.events.length - 1; i >= 0; i--) {
        const e = state.events[i]!;
        if (e.turn < fromTurn) break;
        if (e.type !== c.eventType) continue;
        if (actor !== undefined && e.actor !== actor) continue;
        if (target !== undefined && e.target !== target) continue;
        return true;
      }
      return false;
    }
    case "site_status": {
      const owner = ctx.content.siteOwner.get(c.site);
      const status = owner === undefined ? undefined : state.nations[owner]?.sites[c.site];
      return status === c.status;
    }
    case "controls_region": {
      const n = nationState(ctx, c.nation);
      return n !== undefined && n.regionsControlled.includes(c.region);
    }
    case "member_of": {
      const n = nationState(ctx, c.nation);
      return n !== undefined && n.active && n.coalition === c.coalition;
    }
    case "treaty_status": {
      const n = nationState(ctx, c.nation);
      if (n === undefined) return false;
      return (n.treaties[c.treaty] ?? "nonparty") === c.status;
    }
    case "chance":
      return rollBp(requireRng(ctx, "chance"), c.bp);
    default:
      return assertNever(c);
  }
}
