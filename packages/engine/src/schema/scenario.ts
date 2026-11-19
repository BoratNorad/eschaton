import { z } from "zod";
import { Condition, SidePair } from "./logic.js";
import { CoalitionId, NonNegInt, PhaseId, PosInt, Side, Slug, TensionLevel } from "./primitives.js";

export const Scenario = z
  .object({
    id: Slug,
    name: z.string().min(1),
    description: z.string().min(1),
    mapId: Slug,
    turnLengthMonths: PosInt,
    maxTurns: PosInt,
    startingPhase: PhaseId,
    coalitions: z.array(CoalitionId).min(1),
    nations: z.array(Slug).min(1),
    treaties: z.array(Slug).default([]),
    triggers: z.array(Slug).default([]),
    pipelines: z.array(Slug).default([]),
    nonStateActors: z.array(Slug).default([]),
    initialTensions: z
      .array(z.object({ pair: SidePair, level: TensionLevel, pressure: z.number().int().min(0).max(99) }).strict())
      .default([]),
    phaseTransitions: z.array(z.object({ to: PhaseId, when: Condition }).strict()).default([]),
    victory: z
      .array(
        z
          .object({
            id: Slug,
            label: z.string().min(1),
            /** Absent = applies to everyone (shared catastrophe). */
            side: Side.optional(),
            outcome: z.enum(["win", "loss", "draw"]),
            when: Condition,
          })
          .strict(),
      )
      .min(1),
    /** Seats a human can take; the rest are AI. */
    humanSeats: z.array(Slug).min(1),
    turnTimerSeconds: NonNegInt.default(0),
  })
  .strict();
export type Scenario = z.infer<typeof Scenario>;
