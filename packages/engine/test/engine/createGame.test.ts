import { describe, expect, it } from "vitest";
import { GameState, hashState } from "../../src/index.js";
import { newGame } from "../helpers.js";

describe("createGame(indpak_1999)", () => {
  it("produces a schema-valid state", () => {
    expect(() => GameState.parse(newGame(1))).not.toThrow();
  });

  it("is deterministic per seed and varies with the seed", () => {
    expect(hashState(newGame(42))).toBe(hashState(newGame(42)));
    expect(hashState(newGame(42))).not.toBe(hashState(newGame(43)));
  });

  it("sets up both nations as separate split-theater sides", () => {
    const s = newGame();
    expect(Object.keys(s.nations).sort()).toEqual(["india", "pakistan"]);
    expect(s.nations.india!.side).toBe("india");
    expect(s.nations.pakistan!.side).toBe("pakistan");
    expect(s.tensions).toEqual({ "india|pakistan": { level: 2, pressure: 30, lastIncidentTurn: -1 } });
    expect(s.turn).toBe(0);
    expect(s.phase).toBe("cold_composite");
  });

  it("copies the content fields NationState declares", () => {
    const india = newGame().nations.india!;
    expect(india.baseStats).toEqual({ agg: 4, esc: 8, par: 5, blf: 5, loy: 7, dom: 7, ctl: 9 });
    expect(india.nuclear).toEqual({ warheads: 35, progressBp: 0, statusIndex: 5, exposed: true });
    expect(india.treaties).toEqual({
      india_pakistan_nuclear_facilities: "ratified", indus_waters_treaty: "ratified", lahore_declaration: "ratified",
    });
    expect(Object.keys(india.metros)).toContain("pune");
    expect(india.regionsControlled).toContain("jammu_kashmir");
    expect(india.discoveredSites).not.toContain("india_cw_depot");
    expect(india.forces).toEqual({ jammu_kashmir: 30, punjab_haryana: 25, rajasthan: 20, ladakh_kargil: 8 });
  });

  it("gives rivals a warhead band that contains the truth and hides covert sites", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = newGame(seed);
      const est = s.beliefs.pakistan!.india!.warheads!;
      expect(est.low).toBeLessThanOrEqual(35);
      expect(est.high).toBeGreaterThanOrEqual(35);
      expect(s.beliefs.pakistan!.india!.knownSites).not.toContain("india_cw_depot");
    }
  });
});
