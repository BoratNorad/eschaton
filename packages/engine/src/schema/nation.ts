import { z } from "zod";
import { Condition } from "./logic.js";
import {
  Bp, CoalitionId, NonNegInt, Pct, Payload, PhaseId, PosInt, Rating, Slug, TraitRef, Year,
} from "./primitives.js";

// ----- Places --------------------------------------------------------------

export const SiteKind = z.enum([
  "leadership", "command_bunker", "early_warning", "signals_station",
  "icbm_field", "mobile_missile_base", "missile_base", "ssbn_base", "bomber_base",
  "air_base", "naval_base", "army_base", "nuclear_sharing_base",
  "weapons_lab", "warhead_assembly", "enrichment", "reactor", "research_reactor", "reprocessing",
  "cw_production", "cw_storage", "bw_facility", "test_site", "launch_center",
  "chokepoint", "port", "energy", "industrial", "shelter",
]);
export type SiteKind = z.infer<typeof SiteKind>;

export const Site = z
  .object({
    id: Slug,
    name: z.string().min(1),
    regionId: Slug,
    kinds: z.array(SiteKind).min(1),
    /** 0 = soft target, 10 = deep mountain bunker. */
    hardness: Rating,
    /** What rivals know at game start. Covert sites must be found through intel. */
    discovery: z.enum(["public", "suspected", "covert"]),
    /** Strategic value used by AI targeting and victory scoring. */
    value: Pct,
    /** Set when this site stores weapons owned by another nation (nuclear sharing). */
    hostsWeaponsOf: Slug.optional(),
    notes: z.string().optional(),
  })
  .strict();
export type Site = z.infer<typeof Site>;

export const Metro = z
  .object({
    id: Slug,
    name: z.string().min(1),
    regionId: Slug,
    /** Population in thousands at the nation's snapshot year (approximate). */
    populationK: PosInt,
    /** Share of national economic output, percent. */
    economicWeight: Pct,
    isCapital: z.boolean().default(false),
    /** Extra global tension pressure if struck (holy cities, neutral venues). */
    strikePenalty: NonNegInt.default(0),
  })
  .strict();
export type Metro = z.infer<typeof Metro>;

// ----- Weapon tracks ---------------------------------------------------------
// Deliberately abstract: counts, tonnages and 0-10 ratings. No technical data.

export const NuclearTrack = z
  .object({
    status: z.enum(["none", "latent", "program", "threshold", "undeclared_arsenal", "declared_arsenal"]),
    warheads: NonNegInt,
    /** Progress toward the next status step, basis points. */
    progressBp: Bp.default(0),
    progressPerTurnBp: NonNegInt.default(0),
    /** Turns from a decision to a first usable weapon (latent and threshold states). */
    breakoutTurns: NonNegInt.optional(),
    /** Israel-style opacity: rivals' intel starts with no estimate at all. */
    opacity: z.boolean().default(false),
    testsConducted: NonNegInt.default(0),
  })
  .strict();
export type NuclearTrack = z.infer<typeof NuclearTrack>;

export const ChemicalTrack = z
  .object({
    status: z.enum(["none", "legacy", "program", "stockpile", "destroyed"]),
    stockpileTonnes: NonNegInt,
    /** Broad classes only, for defense and treaty mechanics. */
    agentClasses: z.array(z.enum(["blister", "nerve", "choking", "blood", "incapacitant", "riot_control"])).default([]),
    productionTonnesPerTurn: NonNegInt.default(0),
  })
  .strict();
export type ChemicalTrack = z.infer<typeof ChemicalTrack>;

export const BiologicalTrack = z
  .object({
    status: z.enum(["none", "legacy", "suspected", "research", "offensive"]),
    capability: Rating,
  })
  .strict();
export type BiologicalTrack = z.infer<typeof BiologicalTrack>;

export const RadiologicalTrack = z
  .object({
    capability: Rating,
    /** Per-turn chance of a reactor or storage accident (Kyshtym, Chernobyl). */
    accidentRiskBp: Bp.default(0),
  })
  .strict();
export type RadiologicalTrack = z.infer<typeof RadiologicalTrack>;

export const DeliveryKind = z.enum([
  "icbm", "irbm", "mrbm", "srbm", "slbm", "cruise_missile", "bomber", "strike_aircraft", "artillery",
]);

export const DeliverySystem = z
  .object({
    id: Slug,
    name: z.string().min(1),
    kind: DeliveryKind,
    /** Launchers or airframes available at start (approximate). */
    count: NonNegInt,
    rangeKm: PosInt,
    payloads: z.array(Payload).min(1),
    /** Sites the system operates from; empty for road-mobile systems. */
    basingSiteIds: z.array(Slug).default([]),
    /** Chance-of-surviving-a-first-strike rating. */
    survivability: Rating,
    /** Turns needed to bring the system to launch readiness from peacetime. */
    readyTurns: NonNegInt,
  })
  .strict();
export type DeliverySystem = z.infer<typeof DeliverySystem>;

/** Weapons this nation OWNS that sit on another nation's site (nuclear sharing). */
export const HostedWeapons = z
  .object({
    hostNationId: Slug,
    siteId: Slug,
    warheads: PosInt,
    release: z.enum(["owner_only", "dual_key"]),
  })
  .strict();

export const ProgramFlags = z
  .object({
    /** Template row "Biological weapons by country". */
    confirmedBwProgram: z.boolean().default(false),
    /** Template row "Chemical weapons by country". */
    majorCwStockpile: z.boolean().default(false),
    /** Template row "Nuclear weapons by country". */
    recognizedArsenal: z.boolean().default(false),
  })
  .strict();

export const LegacyFile = z
  .object({
    id: Slug,
    title: z.string().min(1),
    summary: z.string().min(1),
    /** Mechanics the legacy unlocks or modifies (e.g. a REDCHI grievance). */
    traits: z.array(TraitRef).default([]),
  })
  .strict();

// ----- Forces, defense, objectives ---------------------------------------------

export const ConventionalForces = z
  .object({
    army: Pct,
    air: Pct,
    navy: Pct,
    deployments: z.array(z.object({ regionId: Slug, strength: Pct }).strict()).default([]),
  })
  .strict();

export const CbrnDefense = z
  .object({
    detection: Pct,
    protection: Pct,
    decontamination: Pct,
    medical: Pct,
    missileDefense: Pct,
  })
  .strict();
export type CbrnDefense = z.infer<typeof CbrnDefense>;

export const Objective = z
  .object({
    id: Slug,
    label: z.string().min(1),
    /** Relative weight in AI utility and end-of-game scoring. */
    weight: Pct,
    /** Evaluated with $self bound to this nation. */
    satisfiedWhen: Condition,
  })
  .strict();
export type Objective = z.infer<typeof Objective>;

/** Phase 3 handover for Soviet republic sub-commands (Ukraine, Belarus, Kazakhstan). */
export const Inheritance = z
  .object({
    atPhase: PhaseId,
    warheads: NonNegInt,
    deliveryIds: z.array(Slug).default([]),
    /** False models republics that held warheads without launch codes. */
    launchCodes: z.boolean(),
  })
  .strict();

// ----- Nation ------------------------------------------------------------------

export const Nation = z
  .object({
    id: Slug,
    name: z.string().min(1),
    leaderId: Slug,
    snapshotYear: Year,
    coalition: z
      .object({
        id: CoalitionId,
        role: z.enum(["leader", "core", "associate", "subcommand", "client", "neutral"]),
        /** Absent = member from the start. */
        joinsAt: PhaseId.optional(),
        /** Required for subcommands: the nation that holds their codes. */
        parentNationId: Slug.optional(),
      })
      .strict(),
    /** Coalitions that may recruit this nation (neutral pool). */
    recruitableBy: z.array(CoalitionId).default([]),
    capitalMetroId: Slug,
    metros: z.array(Metro).min(1),
    sites: z.array(Site).default([]),
    nuclear: NuclearTrack,
    chemical: ChemicalTrack,
    biological: BiologicalTrack,
    radiological: RadiologicalTrack,
    delivery: z.array(DeliverySystem).default([]),
    hostedAbroad: z.array(HostedWeapons).default([]),
    conventional: ConventionalForces,
    cbrn: CbrnDefense,
    flags: ProgramFlags.default({}),
    legacyFiles: z.array(LegacyFile).default([]),
    objectives: z.array(Objective).default([]),
    inheritance: Inheritance.optional(),
    /** Starting domestic stability, 0-100. */
    stability: Pct,
  })
  .strict()
  .refine((n) => n.coalition.role !== "subcommand" || n.coalition.parentNationId !== undefined, {
    message: "subcommand nations need coalition.parentNationId",
  });
export type Nation = z.infer<typeof Nation>;
