import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive types shared by every schema.
// Rule: simulation state holds integers only. Probabilities are basis points
// (0-10000), shares are percent (0-100), stats are 1-10. No floats in state.
// ---------------------------------------------------------------------------

/** Lowercase snake_case id, unique across ALL content: "india", "kahuta", "parliament_attack". */
export const Slug = z.string().regex(/^[a-z][a-z0-9_]*$/, "ids must be lowercase snake_case");
export type Slug = z.infer<typeof Slug>;

/** Leader stat on the 1-10 scale. */
export const Stat = z.number().int().min(1).max(10);
/** 0-10 rating for hardness, survivability, capability. */
export const Rating = z.number().int().min(0).max(10);
/** Probability in basis points: 10000 = certain. */
export const Bp = z.number().int().min(0).max(10_000);
/** Share or level in percent, 0-100. */
export const Pct = z.number().int().min(0).max(100);
export const NonNegInt = z.number().int().min(0);
export const PosInt = z.number().int().min(1);
export const Year = z.number().int().min(1900).max(2100);
export const Uint32 = z.number().int().min(0).max(4_294_967_295);

export const StatKey = z.enum(["agg", "esc", "par", "blf", "loy", "dom", "ctl"]);
export type StatKey = z.infer<typeof StatKey>;

export const CoalitionId = z.enum([
  "AMNAT", // America and NATO
  "SOVWAR", // Soviet Union and Warsaw Pact
  "REDCHI", // People's Republic of China
  "INDPAK", // India and Pakistan (split theater)
  "IRLIBSYR", // Libya and Syria; Iran and Iraq join in Phase 2 (displayed as LIBSYR before)
  "SOUTHAF", // South Africa
  "LATAM", // Latin America
  "NONAL", // neutral and non-aligned pool (not playable)
]);
export type CoalitionId = z.infer<typeof CoalitionId>;

/**
 * A side in a tension pair. Normally a coalition id (UPPERCASE). Members of a
 * split-theater coalition (INDPAK) are separate sides, keyed by nation id (lowercase).
 */
export const Side = z.union([CoalitionId, Slug]);
export type Side = z.infer<typeof Side>;

export const PhaseId = z.enum(["cold_composite", "gulf_expansion", "inheritance"]);
export type PhaseId = z.infer<typeof PhaseId>;

/** 1 Rivalry, 2 Incident, 3 Crisis, 4 Conventional war, 5 WMD threshold. */
export const TensionLevel = z.number().int().min(1).max(5);
export const TENSION_LABELS = ["", "Rivalry", "Incident", "Crisis", "Conventional war", "WMD threshold"] as const;

/** Alert posture: 5 = peacetime, 1 = war imminent (DEFCON-style). */
export const AlertLevel = z.number().int().min(1).max(5);

export const Visibility = z.enum([
  "public", // everyone
  "coalition", // the actor's side
  "private", // the listed audience only
  "hidden", // engine only; revealed in the after-action replay
]);
export type Visibility = z.infer<typeof Visibility>;

export const SiteStatus = z.enum(["intact", "damaged", "destroyed", "contaminated", "captured"]);
export type SiteStatus = z.infer<typeof SiteStatus>;

export const PartyStatus = z.enum(["nonparty", "signed", "ratified", "withdrawn"]);
export type PartyStatus = z.infer<typeof PartyStatus>;

export const Payload = z.enum(["conventional", "nuclear", "chemical", "biological", "radiological"]);
export type Payload = z.infer<typeof Payload>;

/** Small parameter bag for traits and rules. Integers, strings and booleans only: no floats. */
export const Params = z.record(z.string(), z.union([z.number().int(), z.string(), z.boolean()]));
export type Params = z.infer<typeof Params>;

/** Reference to a mechanic implemented in engine code (src/traits). Params tune it per leader. */
export const TraitRef = z
  .object({
    id: Slug,
    params: Params.default({}),
  })
  .strict();
export type TraitRef = z.infer<typeof TraitRef>;
