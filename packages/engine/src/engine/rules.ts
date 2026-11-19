// Tunable numbers for turn resolution. Integers only. Placeholders until the
// balance harness (slice 2) tunes them; change freely, but expect golden
// hashes to move.

export const RULES = {
  // --- orders ---
  investPointsPerTurn: 10,
  /** Sum of `sanction` severity a nation may impose per turn. */
  maxSanctionPerTurn: 50,
  /** Mobilization above this needs tension >= warLevel or the `coercive_mobilization` unlock. */
  mobilizationFreeCap: 50,
  /** Max change in mobilization per turn. */
  mobilizationStep: 20,
  /** Max change in readiness per turn as it drifts toward its alert-level target. */
  readinessStep: 10,
  /** Turns a ceasefire proposal stays open. */
  ceasefireProposalTurns: 2,

  // --- tension thresholds (levels 1-5) ---
  /** Hostile deploys allowed from here. */
  assaultLevel: 3,
  /** Conventional strikes allowed from here; assaults and strikes push tension at least here. */
  warLevel: 4,
  /** WMD payloads allowed only here. */
  wmdLevel: 5,
  /** Compendium: at Conventional war, chemical use becomes possible for leaders with effective ESC at or below this. */
  chemicalAtWarMaxEsc: 3,
  /** Nuclear payloads also need alert at or below this. */
  nuclearAlertMax: 2,

  // --- pressure ---
  signalPressure: { reassurance: -5, warning: 5, threat: 10, ultimatum: 20 },
  sanctionPressure: 5,
  /** Per nation on either side with mobilization > mobilizationFreeCap, and again with alert <= 2. */
  postureUpkeepPressure: 3,
  quietTurnsBeforeDecay: 3,
  pressureDecay: 5,
  ceasefirePressureDecay: 10,
  /** At 0 pressure after this many quiet turns, the level drops by one and pressure resets to deescalateResetPressure. */
  quietTurnsBeforeDeescalate: 6,
  deescalateResetPressure: 50,
  ceasefireBreakPressure: 30,

  // --- misperception (PAR) ---
  minLevelForMisperception: 3,
  /** Chance per point of effective `par`, per rival pair, per turn. Doubled if a rival is at alert <= 2. */
  misperceptionBpPerPar: 40,
  misperceptionPressure: 15,

  // --- stability upkeep ---
  sanctionDecayPerTurn: 5,
  sanctionStabilityThreshold: 25,

  // --- combat ---
  minBattleBp: 500,
  maxBattleBp: 9500,
  /** Defender multiplier on mountain terrain, in percent. */
  mountainDefensePct: 150,
  /** Strike hit chance before defenses. */
  missileHitBp: 8000,
  aircraftHitBp: 7000,
  /** Missile defense (0-100) removes this many bp per point. */
  missileDefenseBpPerPoint: 50,
  /** Defender air rating (0-100) removes this many bp per point from aircraft. */
  airDefenseBpPerPoint: 30,
  /** Per conventional hit: chance (bp) per point of (10 - hardness) to worsen a site by one step. */
  conventionalSiteBpPerSoftness: 1000,
  /** Nuclear hits destroy sites up to this hardness, and damage harder ones. */
  nuclearDestroysHardness: 8,
  /** Metro damage (percent) per hit, before defenses. */
  metroDamage: { conventional: 1, nuclear: 35, chemical: 4, biological: 3, radiological: 1 },
  chemicalTonnesPerLauncher: 1,
  wmdStabilityShock: -15,
  conventionalStabilityShockPerHit: -1,
  captureStabilityShock: -5,

  // --- intel ---
  intelConfidenceGainBp: 1000,
  maxConfidenceBp: 9500,
  siteDiscoveryBp: 2000,
} as const;

/** Site kinds the 1988 India-Pakistan agreement (and any `nuclear_facility_attack` treaty) protects. */
export const NUCLEAR_FACILITY_KINDS = [
  "weapons_lab", "warhead_assembly", "enrichment", "reactor", "research_reactor", "reprocessing",
] as const;

export const MISSILE_KINDS = ["icbm", "irbm", "mrbm", "srbm", "slbm", "cruise_missile"] as const;

export const UNLOCK_COERCIVE_MOBILIZATION = "coercive_mobilization";
