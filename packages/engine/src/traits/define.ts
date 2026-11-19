import type { z } from "zod";
import type { Params, Trigger } from "../schema/index.js";
import type { Turn } from "../engine/turn.js";

// A trait is a named mechanic that content switches on: leader `traits` and
// coalition `specialRules` reference it by id, with params that tune it.
// Handlers hook into fixed points of resolveTurn, so the turn order never
// changes. Hooks must not draw from the RNG: traits shift numbers, the steps roll.

/** Who carries the trait: a leader (via their nation) or a coalition. */
export type TraitHolder =
  | { scope: "leader"; nationId: string }
  | { scope: "coalition"; coalitionId: string };

export interface TraitDef<P> {
  id: string;
  scope: TraitHolder["scope"];
  /** One line for tooling and the UI's rules glossary. */
  summary: string;
  /** Parsed with defaults applied: P is the OUTPUT type. */
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  /** Step 5, after all strikes resolve. */
  afterStrikes?(t: Turn, holder: TraitHolder, p: P): void;
  /** Step 9, before tension upkeep. */
  upkeep?(t: Turn, holder: TraitHolder, p: P): void;
  /** Step 7: adjust a trigger's chance before its roll. Return the new bp (clamped by the caller). */
  triggerChanceBp?(t: Turn, holder: TraitHolder, p: P, trigger: Trigger, bp: number): number;
  /** Step 4: adjust an assault's success chance before its roll. Return the new bp (clamped by the caller). */
  assaultChanceBp?(t: Turn, holder: TraitHolder, p: P, attackerId: string, defenderId: string, bp: number): number;
}

/** A trait with its params bound; what the runner calls. */
export interface BoundTrait {
  id: string;
  afterStrikes?(t: Turn, holder: TraitHolder): void;
  upkeep?(t: Turn, holder: TraitHolder): void;
  triggerChanceBp?(t: Turn, holder: TraitHolder, trigger: Trigger, bp: number): number;
  assaultChanceBp?(t: Turn, holder: TraitHolder, attackerId: string, defenderId: string, bp: number): number;
}

/** Type-erased registry entry. */
export interface RegisteredTrait {
  id: string;
  scope: TraitHolder["scope"];
  summary: string;
  /** Errors for bad params; empty when valid. */
  validate(params: Params): string[];
  bind(params: Params): BoundTrait;
}

export function defineTrait<P>(def: TraitDef<P>): RegisteredTrait {
  return {
    id: def.id,
    scope: def.scope,
    summary: def.summary,
    validate(params) {
      const r = def.params.safeParse(params);
      return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`);
    },
    bind(params) {
      const p = def.params.parse(params);
      const bound: BoundTrait = { id: def.id };
      if (def.afterStrikes) bound.afterStrikes = (t, h) => def.afterStrikes!(t, h, p);
      if (def.upkeep) bound.upkeep = (t, h) => def.upkeep!(t, h, p);
      if (def.triggerChanceBp) bound.triggerChanceBp = (t, h, tr, bp) => def.triggerChanceBp!(t, h, p, tr, bp);
      if (def.assaultChanceBp) bound.assaultChanceBp = (t, h, a, d, bp) => def.assaultChanceBp!(t, h, p, a, d, bp);
      return bound;
    },
  };
}

/** The nation id of a leader-scope holder; throws for a coalition holder (a registry bug). */
export function holderNation(h: TraitHolder): string {
  if (h.scope !== "leader") throw new Error("leader trait bound to a coalition");
  return h.nationId;
}

export function holderCoalition(h: TraitHolder): string {
  if (h.scope !== "coalition") throw new Error("coalition rule bound to a leader");
  return h.coalitionId;
}
