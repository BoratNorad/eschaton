import { z } from "zod";
import {
  Bp,
  CoalitionId,
  NonNegInt,
  Pct,
  PhaseId,
  PartyStatus,
  Side,
  SiteStatus,
  Slug,
  StatKey,
  TensionLevel,
  Visibility,
  type CoalitionId as CoalitionIdT,
  type PartyStatus as PartyStatusT,
  type PhaseId as PhaseIdT,
  type SiteStatus as SiteStatusT,
  type StatKey as StatKeyT,
  type Visibility as VisibilityT,
} from "./primitives.js";

// ---------------------------------------------------------------------------
// Declarative conditions and effects. Triggers, objectives, treaties, phase
// transitions and victory conditions are all written in this small language,
// so designers add events as data, never as engine code.
//
// Evaluation lives in src/logic/evaluate.ts (not yet written). Every new
// `kind` added here needs a handler there and a unit test.
// ---------------------------------------------------------------------------

/** A nation id, or a binding filled in at evaluation time. */
export const NationRef = z.union([Slug, z.enum(["$self", "$actor", "$target"])]);
export type NationRef = z.infer<typeof NationRef>;

/** A side id, or the side of a bound nation. */
export const SideRef = z.union([Side, z.enum(["$self_side", "$actor_side", "$target_side"])]);
export type SideRef = z.infer<typeof SideRef>;

export const SidePair = z.tuple([SideRef, SideRef]);
export type SidePair = z.infer<typeof SidePair>;

export const Metric = z.enum([
  "stability", // runtime domestic stability, 0-100
  "readiness", // 0-100
  "mobilization", // 0-100
  "nuclear_warheads",
  "nuclear_progress_bp",
  "chemical_tonnes",
  "bio_capability", // 0-10
  "cbrn_protection", // 0-100
]);
export type Metric = z.infer<typeof Metric>;

export const ProgramTrack = z.enum(["nuclear", "chemical", "biological", "missile"]);
export type ProgramTrack = z.infer<typeof ProgramTrack>;

// ----- Conditions ----------------------------------------------------------

export type Condition =
  | { kind: "always" }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] }
  | { kind: "not"; cond: Condition }
  | { kind: "phase_is"; phase: PhaseIdT }
  | { kind: "turn_at_least"; turn: number }
  | { kind: "tension_at_least"; pair: SidePair; level: number }
  | { kind: "stat_at_least"; nation: NationRef; stat: StatKeyT; value: number }
  | { kind: "stat_at_most"; nation: NationRef; stat: StatKeyT; value: number }
  | { kind: "metric_at_least"; nation: NationRef; metric: Metric; value: number }
  | { kind: "metric_at_most"; nation: NationRef; metric: Metric; value: number }
  | { kind: "flag_set"; flag: string }
  | { kind: "event_occurred"; eventType: string; withinTurns: number; actor?: NationRef; target?: NationRef }
  | { kind: "site_status"; site: string; status: SiteStatusT }
  | { kind: "controls_region"; nation: NationRef; region: string }
  | { kind: "member_of"; nation: NationRef; coalition: CoalitionIdT }
  | { kind: "treaty_status"; nation: NationRef; treaty: string; status: PartyStatusT }
  /** Consumes one RNG draw. Prefer a trigger's chanceBp; use this only inside nested logic. */
  | { kind: "chance"; bp: number };

const Stat10 = z.number().int().min(1).max(10);

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }).strict(),
    z.object({ kind: z.literal("all"), of: z.array(Condition).min(1) }).strict(),
    z.object({ kind: z.literal("any"), of: z.array(Condition).min(1) }).strict(),
    z.object({ kind: z.literal("not"), cond: Condition }).strict(),
    z.object({ kind: z.literal("phase_is"), phase: PhaseId }).strict(),
    z.object({ kind: z.literal("turn_at_least"), turn: NonNegInt }).strict(),
    z.object({ kind: z.literal("tension_at_least"), pair: SidePair, level: TensionLevel }).strict(),
    z.object({ kind: z.literal("stat_at_least"), nation: NationRef, stat: StatKey, value: Stat10 }).strict(),
    z.object({ kind: z.literal("stat_at_most"), nation: NationRef, stat: StatKey, value: Stat10 }).strict(),
    z.object({ kind: z.literal("metric_at_least"), nation: NationRef, metric: Metric, value: NonNegInt }).strict(),
    z.object({ kind: z.literal("metric_at_most"), nation: NationRef, metric: Metric, value: NonNegInt }).strict(),
    z.object({ kind: z.literal("flag_set"), flag: Slug }).strict(),
    z
      .object({
        kind: z.literal("event_occurred"),
        eventType: Slug,
        withinTurns: NonNegInt,
        actor: NationRef.optional(),
        target: NationRef.optional(),
      })
      .strict(),
    z.object({ kind: z.literal("site_status"), site: Slug, status: SiteStatus }).strict(),
    z.object({ kind: z.literal("controls_region"), nation: NationRef, region: Slug }).strict(),
    z.object({ kind: z.literal("member_of"), nation: NationRef, coalition: CoalitionId }).strict(),
    z.object({ kind: z.literal("treaty_status"), nation: NationRef, treaty: Slug, status: PartyStatus }).strict(),
    z.object({ kind: z.literal("chance"), bp: Bp }).strict(),
  ]),
);

// ----- Effects -------------------------------------------------------------

export type Effect =
  | { kind: "raise_tension"; pair: SidePair; levels: number }
  | { kind: "lower_tension"; pair: SidePair; levels: number }
  /** Pressure accumulates 0-99; reaching 100 raises the level by one and resets to 0. */
  | { kind: "add_pressure"; pair: SidePair; points: number }
  /** Roll 1d10 against the current stat: pass if roll <= stat - (difficulty - 5). */
  | { kind: "stat_roll"; nation: NationRef; stat: StatKeyT; difficulty: number; onPass: Effect[]; onFail: Effect[] }
  | { kind: "modify_stat"; nation: NationRef; stat: StatKeyT; delta: number; turns: number }
  | { kind: "stability_shock"; nation: NationRef; amount: number }
  | { kind: "set_flag"; flag: string; value: boolean }
  | {
      kind: "emit_event";
      eventType: string;
      visibility: VisibilityT;
      text: string;
      actor?: NationRef;
      target?: NationRef;
    }
  | { kind: "unlock_action"; nation: NationRef; action: string; turns: number }
  | { kind: "violate_treaty"; nation: NationRef; treaty: string }
  | { kind: "expose_program"; nation: NationRef; track: ProgramTrack }
  | { kind: "reveal_site"; site: string }
  | { kind: "sanction"; by: SideRef; against: NationRef; severity: number }
  | { kind: "add_leakage"; amount: number }
  | { kind: "spawn_actor"; actor: string }
  | { kind: "change_phase"; phase: PhaseIdT };

export const Effect: z.ZodType<Effect> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("raise_tension"), pair: SidePair, levels: z.number().int().min(1).max(4) }).strict(),
    z.object({ kind: z.literal("lower_tension"), pair: SidePair, levels: z.number().int().min(1).max(4) }).strict(),
    z
      .object({ kind: z.literal("add_pressure"), pair: SidePair, points: z.number().int().min(-100).max(100) })
      .strict(),
    z
      .object({
        kind: z.literal("stat_roll"),
        nation: NationRef,
        stat: StatKey,
        difficulty: Stat10,
        onPass: z.array(Effect),
        onFail: z.array(Effect),
      })
      .strict(),
    z
      .object({
        kind: z.literal("modify_stat"),
        nation: NationRef,
        stat: StatKey,
        delta: z.number().int().min(-9).max(9),
        turns: z.number().int().min(1),
      })
      .strict(),
    z
      .object({ kind: z.literal("stability_shock"), nation: NationRef, amount: z.number().int().min(-100).max(100) })
      .strict(),
    z.object({ kind: z.literal("set_flag"), flag: Slug, value: z.boolean() }).strict(),
    z
      .object({
        kind: z.literal("emit_event"),
        eventType: Slug,
        visibility: Visibility,
        text: z.string().min(1),
        actor: NationRef.optional(),
        target: NationRef.optional(),
      })
      .strict(),
    z
      .object({ kind: z.literal("unlock_action"), nation: NationRef, action: Slug, turns: z.number().int().min(1) })
      .strict(),
    z.object({ kind: z.literal("violate_treaty"), nation: NationRef, treaty: Slug }).strict(),
    z.object({ kind: z.literal("expose_program"), nation: NationRef, track: ProgramTrack }).strict(),
    z.object({ kind: z.literal("reveal_site"), site: Slug }).strict(),
    z.object({ kind: z.literal("sanction"), by: SideRef, against: NationRef, severity: Pct }).strict(),
    z.object({ kind: z.literal("add_leakage"), amount: z.number().int().min(-100).max(100) }).strict(),
    z.object({ kind: z.literal("spawn_actor"), actor: Slug }).strict(),
    z.object({ kind: z.literal("change_phase"), phase: PhaseId }).strict(),
  ]),
);
