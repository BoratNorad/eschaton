import { rollD10 } from "../rng.js";
import { sortedEntries } from "../util/determinism.js";
import { PhaseId, type Effect, type GameState, type PartyStatus } from "../schema/index.js";
import {
  LogicError, MAX_HOOK_DEPTH, nationState, requireRng, resolveNationId, resolveSide, withBindings, type EvalContext,
} from "./context.js";
import { emitEvent } from "./events.js";
import { addPressure, shiftTension } from "./tension.js";
import { assertNever, clamp, effectiveStat } from "./values.js";

/**
 * Apply effects in list order to ctx.state (the resolveTurn draft). Each effect
 * sees the results of the ones before it.
 *
 * - RNG: `stat_roll` consumes exactly one draw, before its branch runs.
 *   No other effect draws.
 * - An effect aimed at a nation that is not in this game is a no-op.
 * - Treaty hooks (violate_treaty -> onViolation) nest at most MAX_HOOK_DEPTH deep.
 */
export function applyEffects(ctx: EvalContext, effects: readonly Effect[]): void {
  for (const e of effects) applyEffect(ctx, e);
}

export function applyEffect(ctx: EvalContext, e: Effect): void {
  const { state } = ctx;
  switch (e.kind) {
    case "raise_tension":
    case "lower_tension": {
      const a = resolveSide(ctx, e.pair[0]);
      const b = resolveSide(ctx, e.pair[1]);
      shiftTension(state, a, b, e.kind === "raise_tension" ? e.levels : -e.levels, ctx.source);
      return;
    }
    case "add_pressure":
      addPressure(state, resolveSide(ctx, e.pair[0]), resolveSide(ctx, e.pair[1]), e.points, ctx.source);
      return;
    case "stat_roll": {
      const rng = requireRng(ctx, "stat_roll");
      const roll = rollD10(rng); // always drawn, even if the nation is absent
      const n = nationState(ctx, e.nation);
      if (n === undefined) return;
      const stat = effectiveStat(state, n, e.stat);
      const need = stat - (e.difficulty - 5);
      const passed = roll <= need;
      emitEvent(state, {
        type: "stat_roll",
        visibility: "hidden",
        text: `${n.nationId} ${e.stat} roll ${roll} vs ${need}: ${passed ? "pass" : "fail"}.`,
        actor: n.nationId,
        data: { stat: e.stat, value: stat, difficulty: e.difficulty, roll, need, passed, source: ctx.source },
      });
      applyEffects(ctx, passed ? e.onPass : e.onFail);
      return;
    }
    case "modify_stat": {
      const n = nationState(ctx, e.nation);
      if (n === undefined) return;
      n.modifiers.push({ stat: e.stat, delta: e.delta, untilTurn: state.turn + e.turns, source: ctx.source });
      return;
    }
    case "stability_shock": {
      const n = nationState(ctx, e.nation);
      if (n === undefined) return;
      n.stability = clamp(n.stability + e.amount, 0, 100);
      return;
    }
    case "set_flag":
      state.flags[e.flag] = e.value;
      return;
    case "emit_event":
      emitEvent(state, {
        type: e.eventType,
        visibility: e.visibility,
        text: e.text,
        actor: e.actor === undefined ? undefined : resolveNationId(ctx, e.actor),
        target: e.target === undefined ? undefined : resolveNationId(ctx, e.target),
        data: { source: ctx.source },
      });
      return;
    case "unlock_action": {
      const n = nationState(ctx, e.nation);
      if (n === undefined) return;
      const untilTurn = state.turn + e.turns;
      const existing = n.unlockedActions.find((u) => u.action === e.action);
      if (existing) existing.untilTurn = Math.max(existing.untilTurn, untilTurn);
      else n.unlockedActions.push({ action: e.action, untilTurn });
      return;
    }
    case "violate_treaty":
      violateTreaty(ctx, resolveNationId(ctx, e.nation), e.treaty);
      return;
    case "expose_program": {
      const n = nationState(ctx, e.nation);
      if (n === undefined) return;
      // Only the nuclear track has an `exposed` bit in state; the event records the rest.
      if (e.track === "nuclear") n.nuclear.exposed = true;
      emitEvent(state, {
        type: "program_exposed",
        visibility: "public",
        text: `A ${e.track} weapons program in ${n.nationId} has been exposed.`,
        target: n.nationId,
        data: { track: e.track, source: ctx.source },
      });
      return;
    }
    case "reveal_site":
      revealSite(ctx, e.site);
      return;
    case "sanction":
      imposeSanction(ctx, resolveSide(ctx, e.by), resolveNationId(ctx, e.against), e.severity);
      return;
    case "add_leakage":
      state.leakagePool = Math.max(0, state.leakagePool + e.amount);
      return;
    case "spawn_actor": {
      if (!ctx.content.nonstate.has(e.actor)) return;
      const row = state.nonState[e.actor];
      if (row?.active) return;
      state.nonState[e.actor] = { active: true, stepIndex: 0 };
      emitEvent(state, {
        type: "actor_spawned",
        visibility: "hidden",
        text: `${e.actor} becomes active.`,
        data: { actor: e.actor, source: ctx.source },
      });
      return;
    }
    case "change_phase": {
      if (state.phase === e.phase) return;
      const from = state.phase;
      state.phase = e.phase;
      emitEvent(state, {
        type: "phase_changed",
        visibility: "public",
        text: `A new era begins: ${e.phase}.`,
        data: { from, to: e.phase, source: ctx.source },
      });
      return;
    }
    default:
      return assertNever(e);
  }
}

/**
 * Overt violation: runs the treaty's onViolation hook with $actor = violator.
 * No-op unless the violator is a signed/ratified party and the treaty is in force.
 * Party status does not change (withdrawal is a separate order). The hook's own
 * effects decide what, if anything, is announced.
 */
export function violateTreaty(ctx: EvalContext, nationId: string, treatyId: string): void {
  const treaty = ctx.content.treaties.get(treatyId);
  const n = ctx.state.nations[nationId];
  if (treaty === undefined || n === undefined) return;
  if (!isBoundBy(n.treaties[treatyId])) return;
  if (!treatyInForce(ctx.state, treaty.inForce, treaty.entersForceAtPhase)) return;
  runTreatyHook(ctx, nationId, treatyId, "onViolation");
}

export function isBoundBy(status: PartyStatus | undefined): boolean {
  return status === "signed" || status === "ratified";
}

/** Run one of a treaty's hooks with $actor = nationId. No status checks. */
export function runTreatyHook(
  ctx: EvalContext,
  nationId: string,
  treatyId: string,
  hook: "onSign" | "onViolation" | "onWithdrawal",
): void {
  const treaty = ctx.content.treaties.get(treatyId);
  if (treaty === undefined) return;
  if (ctx.depth >= MAX_HOOK_DEPTH) throw new LogicError(ctx.source, `treaty hooks nested deeper than ${MAX_HOOK_DEPTH}`);
  applyEffects(withBindings(ctx, { actor: nationId }, treatyId), treaty[hook]);
}

/** Shared by the `sanction` effect and the `sanction` order. Severity accumulates, capped at 100. */
export function imposeSanction(ctx: EvalContext, bySide: string, againstId: string, severity: number): void {
  const n = ctx.state.nations[againstId];
  if (n === undefined) return;
  n.sanctionsAgainst = Math.min(100, n.sanctionsAgainst + severity);
  emitEvent(ctx.state, {
    type: "sanction_imposed",
    visibility: "public",
    text: `${bySide} imposes sanctions on ${n.nationId}.`,
    target: n.nationId,
    data: { by: bySide, severity, source: ctx.source },
  });
}

export function treatyInForce(state: GameState, inForce: boolean, entersForceAtPhase: PhaseId | undefined): boolean {
  if (inForce) return true;
  if (entersForceAtPhase === undefined) return false;
  return PhaseId.options.indexOf(state.phase) >= PhaseId.options.indexOf(entersForceAtPhase);
}

/** Public reveal: the owner's site becomes known to every other nation in the game. */
function revealSite(ctx: EvalContext, siteId: string): void {
  const { state } = ctx;
  const ownerId = ctx.content.siteOwner.get(siteId);
  const owner = ownerId === undefined ? undefined : state.nations[ownerId];
  if (ownerId === undefined || owner === undefined) return;
  if (!owner.discoveredSites.includes(siteId)) {
    owner.discoveredSites.push(siteId);
    owner.discoveredSites.sort();
  }
  for (const [, byTarget] of sortedEntries(state.beliefs)) {
    const belief = byTarget[ownerId];
    if (belief === undefined || belief.knownSites.includes(siteId)) continue;
    belief.knownSites.push(siteId);
    belief.knownSites.sort();
  }
  const name = ctx.content.nations.get(ownerId)?.sites.find((s) => s.id === siteId)?.name ?? siteId;
  emitEvent(state, {
    type: "site_revealed",
    visibility: "public",
    text: `${name} has been revealed.`,
    target: ownerId,
    data: { site: siteId, source: ctx.source },
  });
}
