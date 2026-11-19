import { describe, expect, it } from "vitest";
import { GameState, SCHEMA_VERSION, hashState, migrateState } from "../../src/index.js";
import { bundle, newGame } from "../helpers.js";
import { play, quiet } from "../scripts.js";

/** What a v1 save looked like: no traitCounters, schemaVersion 1. */
function asV1(s: GameState): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { nations: Record<string, Record<string, unknown>> };
  raw.schemaVersion = 1;
  for (const id of Object.keys(raw.nations)) delete raw.nations[id]!.traitCounters;
  return raw;
}

describe("migrateState", () => {
  it("current version is 2", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });

  it("lifts a v1 save to v2 and it parses", () => {
    const v1 = asV1(newGame(5));
    expect(GameState.safeParse(v1).success).toBe(false);
    const v2 = migrateState(v1);
    expect(v2.schemaVersion).toBe(2);
    expect(v2.nations.india!.traitCounters).toEqual({});
  });

  it("a migrated mid-game v1 save resumes like the original", () => {
    const half = play(bundle, newGame(8), { india: quiet, pakistan: quiet }, 10).final;
    const fromOriginal = play(bundle, half, { india: quiet, pakistan: quiet });
    const fromMigrated = play(bundle, migrateState(asV1(half)), { india: quiet, pakistan: quiet });
    expect(hashState(fromMigrated.final)).toBe(hashState(fromOriginal.final));
  });

  it("passes current states through and does not mutate its input", () => {
    const s = newGame(2);
    const before = JSON.stringify(s);
    expect(migrateState(s)).toEqual(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("refuses newer or unversioned saves", () => {
    expect(() => migrateState({ ...newGame(), schemaVersion: 99 })).toThrow(/reads up to/);
    expect(() => migrateState({ turn: 0 })).toThrow(/schemaVersion/);
    expect(() => migrateState("nope")).toThrow();
  });
});
