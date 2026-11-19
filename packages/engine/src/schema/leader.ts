import { z } from "zod";
import { Slug, Stat, TraitRef, Year } from "./primitives.js";

/**
 * The seven-stat block from the compendium.
 * agg  Aggression: base chance to initiate force
 * esc  Escalation threshold: higher = harder to push to WMD release
 * par  Paranoia: chance to misread exercises, launches or radar returns as attack
 * blf  Bluff: share of signals not backed by intent
 * loy  Coalition loyalty: resistance to defection and unilateral action
 * dom  Domestic sensitivity: how much stability shocks constrain choices
 * ctl  Command control: tightness of central control; low = rogue units, leakage
 */
export const LeaderStats = z
  .object({
    agg: Stat,
    esc: Stat,
    par: Stat,
    blf: Stat,
    loy: Stat,
    dom: Stat,
    ctl: Stat,
  })
  .strict();
export type LeaderStats = z.infer<typeof LeaderStats>;

export const Leader = z
  .object({
    id: Slug,
    /** Historical name. Shown only when the content setting `useHistoricalNames` is on. */
    name: z.string().min(1),
    /** Fictional analogue shown by default in public builds. */
    alias: z.string().min(1),
    title: z.string().min(1),
    /** True for collective leadership (Swiss Federal Council, Myanmar junta). */
    collective: z.boolean().default(false),
    snapshot: z.object({ from: Year, to: Year }).strict(),
    stats: LeaderStats,
    /** Mechanics implemented in src/traits, e.g. "letters_of_last_resort", "ryan". */
    traits: z.array(TraitRef).default([]),
    /** Short UI text describing documented decision-making style. Not a diagnosis. */
    profile: z.string().min(1),
    sources: z.array(z.string().url()).default([]),
  })
  .strict()
  .refine((l) => l.snapshot.from <= l.snapshot.to, { message: "snapshot.from must be <= snapshot.to" });
export type Leader = z.infer<typeof Leader>;
