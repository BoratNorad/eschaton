import { z } from "zod";
import { Effect } from "./logic.js";
import { Bp, NonNegInt, PhaseId, Slug } from "./primitives.js";

/** A channel that moves capability between nations: Khan network, Scud exports, precursor trade. */
export const Pipeline = z
  .object({
    id: Slug,
    name: z.string().min(1),
    track: z.enum(["nuclear", "chemical", "missile"]),
    /** A nation id, or "market" for the Phase 3 black market. */
    supplier: Slug,
    eligibleRecipients: z.array(Slug).min(1),
    progressBpPerTurn: NonNegInt,
    detectionBpPerTurn: Bp,
    /** Leakage-pool points added each active turn (feeds non-state actors). */
    leakagePerTurn: NonNegInt.default(0),
    opensAt: PhaseId.optional(),
    /** The export-control or treaty regime that can shut it down. */
    counterTreatyId: Slug.optional(),
    /** Bindings: $actor = supplier, $target = recipient. */
    onDetected: z.array(Effect).default([]),
    historicalModel: z.string().min(1),
  })
  .strict();
export type Pipeline = z.infer<typeof Pipeline>;
