import { describe, expect, it } from "vitest";
import { GameState, hashState, resolveTurn, stableStringify } from "../../src/index.js";
import { bundle, newGame } from "../helpers.js";
import { hawk, play, quiet, type Script } from "../scripts.js";

const SCRIPTS: Array<[string, Script]> = [["quiet", quiet], ["hawk", hawk]];

describe("determinism", () => {
  for (const [name, script] of SCRIPTS) {
    it(`${name}: two runs in one process match hash-for-hash every turn`, () => {
      for (const seed of [1, 2, 99, 0xffffffff]) {
        const a = play(bundle, newGame(seed), { india: script, pakistan: script });
        const b = play(bundle, newGame(seed), { india: script, pakistan: script });
        expect(a.states.map(hashState)).toEqual(b.states.map(hashState));
      }
    });

    it(`${name}: every turn's state is schema-valid`, () => {
      const r = play(bundle, newGame(5), { india: script, pakistan: script });
      for (const s of r.states) expect(() => GameState.parse(s)).not.toThrow();
    });
  }

  it("never mutates the input state", () => {
    let state = newGame(3);
    for (let i = 0; i < 10; i++) {
      const before = stableStringify(state);
      const orders = ["india", "pakistan"].map((id) => ({ nationId: id, turn: state.turn, orders: hawk(state, id) }));
      const next = resolveTurn(bundle, state, orders).state;
      expect(stableStringify(state)).toBe(before);
      if (next.result) break;
      state = next;
    }
  });

  it("a JSON save/load round trip resumes identically", () => {
    const full = play(bundle, newGame(8), { india: quiet, pakistan: quiet });
    const half = play(bundle, newGame(8), { india: quiet, pakistan: quiet }, 20);
    const reloaded = JSON.parse(JSON.stringify(half.final)) as typeof half.final;
    const rest = play(bundle, reloaded, { india: quiet, pakistan: quiet });
    expect(hashState(rest.final)).toBe(hashState(full.final));
  });

  it("order-set submission order does not matter", () => {
    const s = newGame(4);
    const sets = ["india", "pakistan"].map((id) => ({ nationId: id, turn: 0, orders: hawk(s, id) }));
    const a = resolveTurn(bundle, s, sets).state;
    const b = resolveTurn(bundle, s, [...sets].reverse()).state;
    expect(hashState(a)).toBe(hashState(b));
  });

  it("different seeds diverge", () => {
    const a = play(bundle, newGame(1), { india: quiet, pakistan: quiet });
    const b = play(bundle, newGame(2), { india: quiet, pakistan: quiet });
    expect(hashState(a.final)).not.toBe(hashState(b.final));
  });

  it("returns exactly the events created this turn", () => {
    const s = newGame(1);
    const sets = ["india", "pakistan"].map((id) => ({ nationId: id, turn: 0, orders: hawk(s, id) }));
    const { state, events } = resolveTurn(bundle, s, sets);
    expect(events).toEqual(state.events);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  });
});
