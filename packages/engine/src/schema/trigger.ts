import { z } from "zod";
import { Condition, Effect, SidePair } from "./logic.js";
import { Bp, NonNegInt, PhaseId, PosInt, Slug } from "./primitives.js";

/**
 * A flashpoint from the cross-coalition trigger matrix. Each turn, in id order,
 * every trigger whose `when` holds rolls `chanceBp`; on success its effects run.
 */
export const Trigger = z
  .object({
    id: Slug,
    name: z.string().min(1),
    /** The tension pair this flashpoint belongs to; omit for global events. */
    pair: SidePair.optional(),
    /** The real event it is modeled on, for the in-game history card. */
    historicalModel: z.string().min(1),
    /** Restrict to these phases; empty = all phases. */
    phases: z.array(PhaseId).default([]),
    when: Condition,
    chanceBp: Bp,
    effects: z.array(Effect).min(1),
    cooldownTurns: NonNegInt.default(0),
    /** Absent = unlimited. */
    maxFires: PosInt.optional(),
    /** Bindings available to effects: $actor and $target. */
    bindings: z.object({ actor: Slug.optional(), target: Slug.optional() }).strict().default({}),
  })
  .strict();
export type Trigger = z.infer<typeof Trigger>;
