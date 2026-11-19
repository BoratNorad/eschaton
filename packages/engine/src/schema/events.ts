import { z } from "zod";
import { NonNegInt, Slug, Visibility } from "./primitives.js";

/**
 * Append-only log of everything that happened. Drives the news feed, fog of war,
 * AI memory, `event_occurred` conditions and the after-action replay.
 */
export const GameEvent = z
  .object({
    /** Strictly increasing across the whole game. */
    seq: NonNegInt,
    turn: NonNegInt,
    type: Slug,
    visibility: z.enum(Visibility.options),
    /** Nation ids that can see a "private" or "coalition" event. */
    audience: z.array(Slug).default([]),
    actor: Slug.optional(),
    target: Slug.optional(),
    /** Integer, string or boolean payload; no floats. */
    data: z.record(z.string(), z.union([z.number().int(), z.string(), z.boolean()])).default({}),
    text: z.string(),
  })
  .strict();
export type GameEvent = z.infer<typeof GameEvent>;
