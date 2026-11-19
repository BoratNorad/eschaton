import { GameState, SCHEMA_VERSION } from "../schema/state.js";

// Saved games and replays store states (or seeds + orders) from older engine
// versions. migrateState lifts any supported version to SCHEMA_VERSION, one
// step at a time, then validates. Each step takes plain JSON and returns plain
// JSON; never import current types into a step, they describe the NEW shape.

type Json = Record<string, unknown>;
type Step = (state: Json) => Json;

/** STEPS[v] upgrades a version-v state to v+1. */
const STEPS: Readonly<Record<number, Step>> = {
  1: v1ToV2,
};

export function migrateState(raw: unknown): GameState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a saved game state");
  let state = structuredClone(raw) as Json;
  let version = state.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) throw new Error("saved state has no schemaVersion");
  if (version > SCHEMA_VERSION) throw new Error(`saved state is version ${version}; this engine reads up to ${SCHEMA_VERSION}`);
  while (version < SCHEMA_VERSION) {
    const step = STEPS[version];
    if (step === undefined) throw new Error(`no migration from schema version ${version}`);
    state = step(state);
    version += 1;
    state.schemaVersion = version;
  }
  return GameState.parse(state);
}

/** v2 added NationState.traitCounters. Old games start with no counters. */
function v1ToV2(state: Json): Json {
  const nations = state.nations as Record<string, Json>;
  for (const id of Object.keys(nations).sort()) nations[id] = { ...nations[id], traitCounters: {} };
  return state;
}
