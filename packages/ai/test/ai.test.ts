import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGame, GameState, legalOrders, resolveTurn, stableStringify, viewFor, type ContentBundle, type Order,
} from "@eschaton/engine";
import { loadContent } from "../../../tools/load-content.js";
import { applyOverrides, parseOverride } from "../../../tools/balance-overrides.js";
import { aiRng, chooseOrders, decide, imagine, nuclearGateOpen, playGame, summarize } from "../src/index.js";
import { indexContent, nextU32 } from "@eschaton/engine";

const { bundle } = loadContent(resolve(import.meta.dirname, "../../../data"));
const scenario = bundle.scenarios.find((s) => s.id === "indpak_1999")!;
const game = (seed = 1) => createGame(bundle, scenario, seed);

describe("fairness", () => {
  it("decides from the view alone: hidden truth does not change its orders", () => {
    const a = game(5);
    const b = structuredClone(a);
    // Change things India cannot see: Pakistan's true warheads, forces and stability.
    b.nations.pakistan!.nuclear.warheads = 3;
    b.nations.pakistan!.forces = { punjab_pk: 99 };
    b.nations.pakistan!.stability = 5;
    expect(viewFor(bundle, a, "india")).toEqual(viewFor(bundle, b, "india"));
    const oa = chooseOrders(bundle, scenario, viewFor(bundle, a, "india"), { gameSeed: 5 });
    const ob = chooseOrders(bundle, scenario, viewFor(bundle, b, "india"), { gameSeed: 5 });
    expect(oa).toEqual(ob);
  });

  it("imagines a schema-valid world that keeps what it knows and samples warheads within its estimate", () => {
    const s = game(3);
    const view = viewFor(bundle, s, "pakistan");
    for (let i = 0; i < 20; i++) {
      const world = imagine(bundle, scenario, view, aiRng(3, 0, `t${i}`));
      expect(() => GameState.parse(world)).not.toThrow();
      expect(world.nations.pakistan).toEqual(view.self);
      const est = view.others.india!.belief.warheads!;
      expect(world.nations.india!.nuclear.warheads).toBeGreaterThanOrEqual(est.low);
      expect(world.nations.india!.nuclear.warheads).toBeLessThanOrEqual(est.high);
      // A covert site Pakistan has not found keeps its public template status; nothing leaks from truth.
      expect(world.tensions).toEqual(view.tensions);
    }
  });
});

describe("determinism", () => {
  it("same view and seed give the same orders; it never touches the game's own RNG", () => {
    const s = game(9);
    const view = viewFor(bundle, s, "india");
    const before = stableStringify(s);
    expect(chooseOrders(bundle, scenario, view, { gameSeed: 9 })).toEqual(chooseOrders(bundle, scenario, view, { gameSeed: 9 }));
    expect(stableStringify(s)).toBe(before);
  });

  it("a whole AI game replays identically", () => {
    expect(playGame(bundle, scenario, 4)).toEqual(playGame(bundle, scenario, 4));
  });

  it("its random stream depends on seed, turn and nation", () => {
    const a = nextU32(aiRng(1, 0, "india"));
    expect(nextU32(aiRng(1, 0, "india"))).toBe(a);
    expect(nextU32(aiRng(2, 0, "india"))).not.toBe(a);
    expect(nextU32(aiRng(1, 1, "india"))).not.toBe(a);
    expect(nextU32(aiRng(1, 0, "pakistan"))).not.toBe(a);
  });
});

describe("legality and judgement", () => {
  it("submits only orders that step 1 accepts", () => {
    let s = game(2);
    for (let turn = 0; turn < 10 && !s.result; turn++) {
      const sets = ["india", "pakistan"].map((id) => ({
        nationId: id, turn: s.turn, orders: chooseOrders(bundle, scenario, viewFor(bundle, s, id), { gameSeed: 2 }),
      }));
      const { state, events } = resolveTurn(bundle, s, sets);
      expect(events.filter((e) => e.type === "order_rejected").map((e) => e.text)).toEqual([]);
      s = state;
    }
  });

  it("never considers nuclear plans in peacetime", () => {
    const view = viewFor(bundle, game(1), "pakistan");
    const d = decide(bundle, scenario, view, { gameSeed: 1 });
    expect(d.nuclearGateOpen).toBe(false);
    expect(Object.keys(d.scores)).not.toContain("nuclear");
  });

  it("No First Use keeps India's gate shut until WMD is used against it", () => {
    const s = game(1);
    s.tensions["india|pakistan"]!.level = 5;
    s.nations.india!.stability = 10;
    s.nations.india!.metros.delhi!.damage = 20;
    const idx = indexContent(bundle);
    const stats = { ...s.nations.india!.baseStats };
    expect(nuclearGateOpen(idx, scenario, viewFor(bundle, s, "india"), stats, "pakistan")).toBe(false);
    s.events.push({ seq: 0, turn: 0, type: "wmd_use", visibility: "public", audience: [], actor: "pakistan", target: "india", data: { payload: "nuclear" }, text: "x" });
    s.nextEventSeq = 1;
    expect(nuclearGateOpen(idx, scenario, viewFor(bundle, s, "india"), stats, "pakistan")).toBe(true);
  });

  it("Pakistan's low ESC opens its gate under heavy provocation", () => {
    const s = game(1);
    s.tensions["india|pakistan"]!.level = 5;
    s.nations.pakistan!.regionsControlled = s.nations.pakistan!.regionsControlled.filter((r) => r !== "azad_kashmir_gilgit");
    s.nations.india!.regionsControlled.push("azad_kashmir_gilgit");
    const idx = indexContent(bundle);
    expect(nuclearGateOpen(idx, scenario, viewFor(bundle, s, "pakistan"), s.nations.pakistan!.baseStats, "india")).toBe(true);
  });

  it("bluffs at roughly its BLF rate", () => {
    // Musharraf BLF 7: about 30% of threats sincere.
    const s = game(1);
    s.tensions["india|pakistan"]!.level = 3;
    let sincere = 0;
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const d = decide(bundle, scenario, viewFor(bundle, s, "pakistan"), { gameSeed: seed });
      for (const o of d.orders as Order[]) if (o.kind === "signal" && o.signal !== "reassurance") (total++, o.sincere && sincere++);
    }
    expect(total).toBeGreaterThan(20);
    expect(sincere / total).toBeGreaterThan(0.1);
    expect(sincere / total).toBeLessThan(0.55);
  });
});

describe("harness", () => {
  it("summarizes records into shares", () => {
    const recs = [1, 2].map((seed) => playGame(bundle, scenario, seed));
    const r = summarize(recs, scenario.maxTurns);
    expect(r.games).toBe(2);
    expect(r.outcomes.india!.win + r.outcomes.india!.loss + r.outcomes.india!.draw).toBeCloseTo(1);
    expect(r.nuclearUse).toBeGreaterThanOrEqual(0);
    expect(r.nuclearUse).toBeLessThanOrEqual(1);
  });

  it("what-if overrides patch only the given copy and refuse unknown fields or floats", () => {
    const b: ContentBundle = structuredClone(bundle);
    const rules: Record<string, unknown> = { pressureDecay: 5 };
    applyOverrides([parseOverride("rules.pressureDecay=9"), parseOverride("triggers.kargil_infiltration.chanceBp=100")], b, rules);
    expect(rules.pressureDecay).toBe(9);
    expect(b.triggers.find((t) => t.id === "kargil_infiltration")!.chanceBp).toBe(100);
    expect(bundle.triggers.find((t) => t.id === "kargil_infiltration")!.chanceBp).toBe(400);
    expect(() => applyOverrides([parseOverride("rules.nope=1")], b, rules)).toThrow(/unknown field/);
    expect(() => parseOverride("rules.pressureDecay=1.5")).toThrow(/integers/);
    expect(legalOrders(bundle, game(), "india").length).toBeGreaterThan(0);
  });
});
