import type { ContentIndex } from "../content/index-content.js";
import type { GameState, NationRef, NationState, RngState, SideRef } from "../schema/index.js";

/**
 * Everything a Condition or Effect needs. One context per evaluation site
 * (a trigger firing, a treaty hook, an objective check).
 */
export interface EvalContext {
  readonly content: ContentIndex;
  /** Conditions only read it. Effects mutate it: pass the resolveTurn draft, never an input state. */
  readonly state: GameState;
  /**
   * Source of `chance` draws and `stat_roll` dice. Undefined = read-only
   * evaluation (AI scoring, UI previews): hitting a roll then throws.
   */
  readonly rng: RngState | undefined;
  readonly bindings: Bindings;
  /** Id of the content object being run (trigger, treaty...). Tags modifiers and events. */
  readonly source: string;
  /** Nesting depth of treaty hooks; guards against violate_treaty loops in content. */
  readonly depth: number;
}

export interface Bindings {
  readonly self?: string;
  readonly actor?: string;
  readonly target?: string;
}

/** Content asked for something the context cannot provide. A content or engine bug, never a player error. */
export class LogicError extends Error {
  constructor(source: string, message: string) {
    super(`[${source}] ${message}`);
    this.name = "LogicError";
  }
}

export const MAX_HOOK_DEPTH = 8;

export function makeContext(
  content: ContentIndex,
  state: GameState,
  rng: RngState | undefined,
  source: string,
  bindings: Bindings = {},
): EvalContext {
  return { content, state, rng, bindings, source, depth: 0 };
}

export function withBindings(ctx: EvalContext, bindings: Bindings, source = ctx.source): EvalContext {
  return { ...ctx, bindings, source, depth: ctx.depth + 1 };
}

/** Resolve a NationRef to a nation id. Unbound `$` refs are content bugs and throw. */
export function resolveNationId(ctx: EvalContext, ref: NationRef): string {
  switch (ref) {
    case "$self":
    case "$actor":
    case "$target": {
      const id = ctx.bindings[ref.slice(1) as "self" | "actor" | "target"];
      if (id === undefined) throw new LogicError(ctx.source, `${ref} is not bound here`);
      return id;
    }
    default:
      return ref;
  }
}

/** The nation's runtime state, or undefined if it is not in this game. */
export function nationState(ctx: EvalContext, ref: NationRef): NationState | undefined {
  return ctx.state.nations[resolveNationId(ctx, ref)];
}

/** Resolve a SideRef. `$x_side` uses the bound nation's side; a nation outside the game throws. */
export function resolveSide(ctx: EvalContext, ref: SideRef): string {
  switch (ref) {
    case "$self_side":
    case "$actor_side":
    case "$target_side": {
      const nationRef = ref.slice(0, -"_side".length) as "$self" | "$actor" | "$target";
      const n = nationState(ctx, nationRef);
      if (n === undefined) throw new LogicError(ctx.source, `${ref}: bound nation is not in this game`);
      return n.side;
    }
    default:
      return ref;
  }
}

export function requireRng(ctx: EvalContext, what: string): RngState {
  if (ctx.rng === undefined) throw new LogicError(ctx.source, `${what} needs RNG but this evaluation is read-only`);
  return ctx.rng;
}
