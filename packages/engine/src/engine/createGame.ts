import type { ContentBundle } from "../content/bundle.js";
import { indexContent, type ContentIndex } from "../content/index-content.js";
import { nextInt, seedRng } from "../rng.js";
import {
  NuclearTrack, PhaseId, SCHEMA_VERSION, type GameState, type Nation, type NationState, type RngState, type Scenario,
} from "../schema/index.js";
import { pairKey } from "../util/determinism.js";
import { START } from "./defaults.js";

const NUCLEAR_STATUSES = NuclearTrack.shape.status.options;

/**
 * Build turn 0. Pure: same (content, scenario, seed) -> same state.
 * RNG draws (in this order): initial intel estimates, observer by observer in
 * sorted id order, target by target in sorted id order.
 * Throws if the scenario references content that is missing (run validate first).
 */
export function createGame(content: ContentBundle, scenario: Scenario, seed: number): GameState {
  const idx = indexContent(content);
  const map = idx.maps.get(scenario.mapId);
  if (map === undefined) throw new Error(`scenario ${scenario.id}: unknown map ${scenario.mapId}`);

  const rng = seedRng(seed);
  const nationIds = [...scenario.nations].sort();
  const nationContent = nationIds.map((id) => {
    const n = idx.nations.get(id);
    if (n === undefined) throw new Error(`scenario ${scenario.id}: unknown nation ${id}`);
    return n;
  });

  const nations: Record<string, NationState> = {};
  for (const n of nationContent) nations[n.id] = initialNation(idx, scenario, map.regions, n);

  // Every unordered pair of distinct sides starts at Rivalry, then scenario overrides.
  const sides = [...new Set(nationIds.map((id) => nations[id]!.side))].sort();
  const tensions: GameState["tensions"] = {};
  for (let i = 0; i < sides.length; i++)
    for (let j = i + 1; j < sides.length; j++)
      tensions[pairKey(sides[i]!, sides[j]!)] = { level: 1, pressure: 0, lastIncidentTurn: -1 };
  for (const t of scenario.initialTensions) {
    if (t.pair.some((s) => s.startsWith("$"))) throw new Error(`scenario ${scenario.id}: initialTensions cannot use bindings`);
    tensions[pairKey(t.pair[0], t.pair[1])] = { level: t.level, pressure: t.pressure, lastIncidentTurn: -1 };
  }

  const beliefs: GameState["beliefs"] = {};
  for (const observer of nationContent) {
    const row: GameState["beliefs"][string] = {};
    for (const target of nationContent) {
      if (target.id === observer.id) continue;
      row[target.id] = initialBelief(rng, target);
    }
    beliefs[observer.id] = row;
  }

  const triggerFires: GameState["triggerFires"] = {};
  for (const id of [...scenario.triggers].sort()) triggerFires[id] = { count: 0, lastTurn: -1 };
  const nonState: GameState["nonState"] = {};
  for (const id of [...scenario.nonStateActors].sort()) nonState[id] = { active: false, stepIndex: 0 };

  return {
    schemaVersion: SCHEMA_VERSION,
    scenarioId: scenario.id,
    seed: seed >>> 0,
    rng,
    turn: 0,
    phase: scenario.startingPhase,
    nations,
    tensions,
    beliefs,
    flags: {},
    triggerFires,
    pipelines: [],
    leakagePool: 0,
    nonState,
    ceasefires: [],
    events: [],
    nextEventSeq: 0,
  };
}

function initialNation(
  idx: ContentIndex,
  scenario: Scenario,
  regions: ReadonlyArray<{ id: string; controller: string }>,
  n: Nation,
): NationState {
  const leader = idx.leaders.get(n.leaderId);
  if (leader === undefined) throw new Error(`nation ${n.id}: unknown leader ${n.leaderId}`);
  const coalition = idx.coalitions.get(n.coalition.id);
  const phaseIdx = (p: PhaseId) => PhaseId.options.indexOf(p);

  const treaties: NationState["treaties"] = {};
  for (const tid of [...scenario.treaties].sort()) {
    const t = idx.treaties.get(tid);
    if (t === undefined) throw new Error(`scenario ${scenario.id}: unknown treaty ${tid}`);
    treaties[tid] = t.parties[n.id] ?? "nonparty";
  }

  const forces: NationState["forces"] = {};
  for (const d of n.conventional.deployments) forces[d.regionId] = Math.min(100, (forces[d.regionId] ?? 0) + d.strength);

  return {
    nationId: n.id,
    side: coalition?.splitTheater ? n.id : n.coalition.id,
    coalition: n.coalition.id,
    active: n.coalition.joinsAt === undefined || phaseIdx(n.coalition.joinsAt) <= phaseIdx(scenario.startingPhase),
    leaderId: leader.id,
    leaderAlive: true,
    baseStats: { ...leader.stats },
    modifiers: [],
    stability: n.stability,
    readiness: START.readiness,
    mobilization: START.mobilization,
    alert: START.alert,
    nuclear: {
      warheads: n.nuclear.warheads,
      progressBp: n.nuclear.progressBp,
      statusIndex: NUCLEAR_STATUSES.indexOf(n.nuclear.status),
      exposed: n.nuclear.status === "declared_arsenal",
    },
    chemicalTonnes: n.chemical.stockpileTonnes,
    bioCapability: n.biological.capability,
    deliveryCounts: Object.fromEntries(n.delivery.map((d) => [d.id, d.count])),
    sites: Object.fromEntries(n.sites.map((s) => [s.id, "intact" as const])),
    discoveredSites: n.sites.filter((s) => s.discovery === "public").map((s) => s.id).sort(),
    metros: Object.fromEntries(
      n.metros.map((m) => [m.id, { populationK: m.populationK, damage: 0, contaminated: false }]),
    ),
    regionsControlled: regions.filter((r) => r.controller === n.id).map((r) => r.id).sort(),
    forces,
    cbrn: { ...n.cbrn },
    treaties,
    covertViolations: [],
    unlockedActions: [],
    sanctionsAgainst: 0,
  };
}

/**
 * Rivals start with a band that contains the true value at a random offset,
 * so the midpoint never leaks the truth. Opaque programs get no estimate;
 * chemical estimates exist only for flagged major stockpiles.
 */
function initialBelief(rng: RngState, target: Nation): GameState["beliefs"][string][string] {
  const belief: GameState["beliefs"][string][string] = {
    knownSites: target.sites.filter((s) => s.discovery === "public").map((s) => s.id).sort(),
    perceivedBlfBp: START.perceivedBlfBp,
  };
  const nuclearKnown = target.nuclear.status === "declared_arsenal" || target.nuclear.status === "undeclared_arsenal";
  if (!target.nuclear.opacity && nuclearKnown) {
    const conf = target.nuclear.status === "declared_arsenal" ? START.declaredConfidenceBp : START.undeclaredConfidenceBp;
    belief.warheads = band(rng, target.nuclear.warheads, conf);
  }
  if (target.flags.majorCwStockpile) belief.chemicalTonnes = band(rng, target.chemical.stockpileTonnes, START.undeclaredConfidenceBp);
  return belief;
}

/** Width = 40% of the true value (min 2), placed so that low <= truth <= high. One draw. */
function band(rng: RngState, truth: number, confidenceBp: number) {
  const width = Math.max(2, Math.floor((truth * 2) / 5));
  const low = Math.max(0, truth - nextInt(rng, width + 1));
  return { low, high: low + width, confidenceBp, asOfTurn: 0 };
}
