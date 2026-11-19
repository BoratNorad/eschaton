import { describe, expect, it } from "vitest";
import {
  PlayerView, applyEffects, makeContext, indexContent, revealAll, stableStringify, viewFor, type GameState,
} from "../../src/index.js";
import { bundle, newGame } from "../helpers.js";
import { hawk, play, quiet } from "../scripts.js";

const NATIONS = ["india", "pakistan"];

/** Every state of a hawkish and a quiet game: plenty of hidden, private and public events. */
function allStates(): GameState[] {
  return [
    newGame(1),
    ...play(bundle, newGame(1), { india: hawk, pakistan: hawk }).states,
    ...play(bundle, newGame(3), { india: quiet, pakistan: hawk }).states,
  ];
}

describe("viewFor: no leaks", () => {
  const states = allStates();

  it("is schema-valid for every viewer on every turn", () => {
    for (const s of states) for (const id of NATIONS) expect(() => PlayerView.parse(viewFor(bundle, s, id))).not.toThrow();
  });

  it("never includes hidden events, or private/coalition events outside their audience", () => {
    for (const s of states)
      for (const id of NATIONS)
        for (const e of viewFor(bundle, s, id).events) {
          expect(e.visibility).not.toBe("hidden");
          if (e.visibility !== "public") expect(e.audience).toContain(id);
        }
  });

  it("includes every event the viewer is entitled to, in order", () => {
    const s = states.at(-1)!;
    const v = viewFor(bundle, s, "india");
    const expected = s.events.filter((e) => e.visibility === "public" || e.audience.includes("india"));
    expect(v.events.map((e) => e.seq)).toEqual(expected.map((e) => e.seq));
  });

  it("never exposes signal sincerity, dice, or covert acts", () => {
    for (const s of states)
      for (const id of NATIONS) {
        const text = stableStringify(viewFor(bundle, s, id));
        expect(text).not.toContain('"sincere"');
        for (const t of ["signal_intent", "stat_roll", "misperception", "covert_violation_started", "trigger_fired"])
          expect(text).not.toContain(`"type":"${t}"`);
      }
  });

  it("shows rivals only through beliefs: no exact arsenal, stockpile, forces or stability", () => {
    for (const s of states) {
      const rival = viewFor(bundle, s, "pakistan").others.india!;
      expect(Object.keys(rival).sort()).toEqual(["alert", "belief", "coalition", "metros", "sitesKnown"]);
      const w = rival.belief.warheads;
      if (w) expect(w.high - w.low).toBeGreaterThanOrEqual(2); // a range, never the point value
    }
  });

  it("hides covert sites until the viewer discovers them", () => {
    const s = newGame(1);
    expect(viewFor(bundle, s, "pakistan").others.india!.sitesKnown).not.toHaveProperty("india_cw_depot");
    applyEffects(makeContext(indexContent(bundle), s, s.rng, "test"), [{ kind: "reveal_site", site: "india_cw_depot" }]);
    expect(viewFor(bundle, s, "pakistan").others.india!.sitesKnown).toHaveProperty("india_cw_depot", "intact");
  });

  it("shows own state exactly and as a copy", () => {
    const s = newGame(2);
    const v = viewFor(bundle, s, "india");
    expect(v.self).toEqual(s.nations.india);
    v.self.stability = 0;
    v.others.pakistan!.belief.knownSites.push("x");
    v.tensions["india|pakistan"]!.level = 5;
    expect(s.nations.india!.stability).toBe(65);
    expect(s.beliefs.india!.pakistan!.knownSites).not.toContain("x");
    expect(s.tensions["india|pakistan"]!.level).toBe(2);
  });

  it("throws for a nation outside the game", () => {
    expect(() => viewFor(bundle, newGame(), "usa")).toThrow();
  });
});

describe("revealAll", () => {
  it("makes every event public, records the original visibility, leaves the input alone", () => {
    const s = play(bundle, newGame(1), { india: hawk, pakistan: hawk }).final;
    const before = stableStringify(s);
    const r = revealAll(s);
    expect(stableStringify(s)).toBe(before);
    expect(r.events.every((e) => e.visibility === "public" && e.audience.length === 0)).toBe(true);
    const intent = r.events.find((e) => e.type === "signal_intent")!;
    expect(intent.data).toMatchObject({ originalVisibility: "hidden" });
    expect(viewFor(bundle, r, "india").events).toHaveLength(r.events.length);
    expect(r.events.length).toBe(s.events.length);
  });
});
