import { z } from "zod";
import { CbrnDefense } from "./nation.js";
import { GameEvent } from "./events.js";
import { LeaderStats } from "./leader.js";
import {
  AlertLevel, Bp, CoalitionId, NonNegInt, PartyStatus, Pct, PhaseId, SiteStatus, Slug, StatKey,
  TensionLevel, Uint32,
} from "./primitives.js";

// ---------------------------------------------------------------------------
// Runtime state. Everything here is plain JSON with integers only, so a state
// can be hashed, saved, sent over the network and replayed bit-for-bit.
// Content (nations, triggers...) is NOT copied in: state refers to it by id,
// and the engine reads it from the immutable ContentBundle.
// ---------------------------------------------------------------------------

/** v2: NationState.traitCounters. Migrations live in src/migrations/. */
export const SCHEMA_VERSION = 2 as const;

/** sfc32 generator state. Only src/rng.ts may read or advance it. */
export const RngState = z.object({ a: Uint32, b: Uint32, c: Uint32, d: Uint32 }).strict();
export type RngState = z.infer<typeof RngState>;

export const StatModifier = z
  .object({ stat: StatKey, delta: z.number().int().min(-9).max(9), untilTurn: NonNegInt, source: Slug })
  .strict();

export const MetroState = z
  .object({
    populationK: NonNegInt,
    /** Share of the metro destroyed or out of action, percent. */
    damage: Pct,
    contaminated: z.boolean(),
  })
  .strict();

export const NationState = z
  .object({
    nationId: Slug,
    side: z.string(),
    coalition: CoalitionId,
    active: z.boolean(),
    leaderId: Slug,
    leaderAlive: z.boolean(),
    /** Base stats copied from the leader at start or on succession; modifiers apply on top. */
    baseStats: LeaderStats,
    modifiers: z.array(StatModifier),
    stability: Pct,
    readiness: Pct,
    mobilization: Pct,
    alert: AlertLevel,
    nuclear: z
      .object({ warheads: NonNegInt, progressBp: Bp, statusIndex: z.number().int().min(0).max(5), exposed: z.boolean() })
      .strict(),
    chemicalTonnes: NonNegInt,
    bioCapability: z.number().int().min(0).max(10),
    deliveryCounts: z.record(Slug, NonNegInt),
    sites: z.record(Slug, SiteStatus),
    discoveredSites: z.array(Slug),
    metros: z.record(Slug, MetroState),
    regionsControlled: z.array(Slug),
    forces: z.record(Slug, Pct),
    cbrn: CbrnDefense,
    treaties: z.record(Slug, PartyStatus),
    covertViolations: z.array(z.object({ treatyId: Slug, sinceTurn: NonNegInt }).strict()),
    unlockedActions: z.array(z.object({ action: Slug, untilTurn: NonNegInt }).strict()),
    sanctionsAgainst: NonNegInt,
    /** Small per-trait counters keyed by trait id (e.g. turns spent mobilized). Owned by src/traits. */
    traitCounters: z.record(Slug, NonNegInt),
  })
  .strict();
export type NationState = z.infer<typeof NationState>;

export const TensionState = z
  .object({
    level: TensionLevel,
    /** 0-99; reaching 100 raises the level by one. */
    pressure: z.number().int().min(0).max(99),
    lastIncidentTurn: z.number().int().min(-1),
  })
  .strict();

/** What one nation believes about another. Low/high bound the true value. */
export const IntelEstimate = z
  .object({ low: NonNegInt, high: NonNegInt, confidenceBp: Bp, asOfTurn: NonNegInt })
  .strict();

export const Belief = z
  .object({
    warheads: IntelEstimate.optional(),
    chemicalTonnes: IntelEstimate.optional(),
    knownSites: z.array(Slug),
    /** Running estimate of the target's bluff rate, used to discount signals. */
    perceivedBlfBp: Bp,
  })
  .strict();

export const GameState = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    scenarioId: Slug,
    seed: Uint32,
    rng: RngState,
    turn: NonNegInt,
    phase: PhaseId,
    /** Keyed by nation id. Iterate with sortedEntries(), never Object.entries(). */
    nations: z.record(Slug, NationState),
    /** Keyed by pairKey(a, b). */
    tensions: z.record(z.string(), TensionState),
    /** beliefs[observer][target] */
    beliefs: z.record(Slug, z.record(Slug, Belief)),
    flags: z.record(Slug, z.boolean()),
    triggerFires: z.record(Slug, z.object({ count: NonNegInt, lastTurn: z.number().int().min(-1) }).strict()),
    pipelines: z.array(
      z
        .object({ pipelineId: Slug, supplier: Slug, recipient: Slug, accumulatedBp: NonNegInt, detected: z.boolean() })
        .strict(),
    ),
    leakagePool: NonNegInt,
    nonState: z.record(Slug, z.object({ active: z.boolean(), stepIndex: NonNegInt }).strict()),
    ceasefires: z.array(z.object({ pair: z.string(), sinceTurn: NonNegInt }).strict()),
    events: z.array(GameEvent),
    nextEventSeq: NonNegInt,
    result: z
      .object({ endedAtTurn: NonNegInt, outcomes: z.record(z.string(), z.enum(["win", "loss", "draw"])) })
      .strict()
      .optional(),
  })
  .strict();
export type GameState = z.infer<typeof GameState>;

/**
 * The fog-of-war slice one player receives. The server sends ONLY this, never
 * GameState. Own nation is exact; everyone else is filtered through beliefs.
 */
export const PlayerView = z
  .object({
    viewer: Slug,
    turn: NonNegInt,
    phase: PhaseId,
    self: NationState,
    others: z.record(
      Slug,
      z
        .object({
          coalition: CoalitionId,
          alert: AlertLevel.optional(),
          stability: Pct.optional(),
          belief: Belief,
          sitesKnown: z.record(Slug, SiteStatus),
          metros: z.record(Slug, MetroState),
        })
        .strict(),
    ),
    tensions: z.record(z.string(), TensionState),
    events: z.array(GameEvent),
  })
  .strict();
export type PlayerView = z.infer<typeof PlayerView>;
