import { z } from "zod";
import { CoalitionId, PhaseId, Slug, TraitRef } from "./primitives.js";

export const Coalition = z
  .object({
    id: CoalitionId,
    /** Display name per phase; falls back to the id. IRLIBSYR shows "LIBSYR" in Phase 1. */
    names: z.record(PhaseId, z.string().min(1)).default({}),
    playable: z.boolean(),
    /** Members are separate tension sides who may fight each other (INDPAK). */
    splitTheater: z.boolean().default(false),
    leaderNationId: Slug.optional(),
    specialRules: z.array(TraitRef).default([]),
    description: z.string().min(1),
  })
  .strict();
export type Coalition = z.infer<typeof Coalition>;
