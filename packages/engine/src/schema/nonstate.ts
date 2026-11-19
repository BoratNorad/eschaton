import { z } from "zod";
import { Condition, Effect } from "./logic.js";
import { Bp, NonNegInt, Slug, Stat } from "./primitives.js";

export const LadderStep = z
  .object({
    id: Slug,
    label: z.string().min(1),
    /** Leakage-pool points consumed to attempt the step. */
    leakageCost: NonNegInt,
    failureBp: Bp,
    /** Chance an attempt is detected by intel regardless of success. */
    exposureBp: Bp,
  })
  .strict();

export const NonStateActor = z
  .object({
    id: Slug,
    name: z.string().min(1),
    leaderName: z.string().min(1),
    alias: z.string().min(1),
    stats: z.object({ agg: Stat, esc: Stat, par: Stat, blf: Stat, ctl: Stat }).strict(),
    operatingRegions: z.array(Slug).min(1),
    spawn: z.object({ when: Condition, minLeakage: NonNegInt }).strict(),
    ladder: z.array(LadderStep).min(1),
    /** Run on a successful attack. Bindings: $target = the struck nation. */
    attackEffects: z.array(Effect).min(1),
  })
  .strict();
export type NonStateActor = z.infer<typeof NonStateActor>;
