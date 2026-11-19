import { describe, expect, it } from "vitest";
import {
  TRAITS, effectiveStat, resolveTurn, validateReferences, type ContentBundle, type GameState, type Order, type OrderSet,
} from "../../src/index.js";
import { loadBundle, newGame } from "../helpers.js";

// Each trait in isolation: a bundle where only the trait under test is active,
// triggers disabled, so effects are exact.

function bundleWith(opts: { leader?: Record<string, string[]>; coalition?: string[]; triggerBp?: number } = {}): ContentBundle {
  const b = structuredClone(loadBundle());
  for (const l of b.leaders) {
    const keep = opts.leader?.[l.id] ?? [];
    l.traits = l.traits.filter((t) => keep.includes(t.id));
  }
  for (const c of b.coalitions) c.specialRules = c.specialRules.filter((r) => (opts.coalition ?? []).includes(r.id));
  for (const t of b.triggers) t.chanceBp = opts.triggerBp ?? 0;
  return b;
}

const run = (b: ContentBundle, s: GameState, orders: Record<string, Order[]> = {}) =>
  resolveTurn(b, s, Object.entries(orders).map(([nationId, o]): OrderSet => ({ nationId, turn: s.turn, orders: o }))).state;

const tension = (s: GameState) => s.tensions["india|pakistan"]!;

describe("registry and validation", () => {
  it("covers every trait the shipped content uses", () => {
    const b = loadBundle();
    const used = [...b.leaders.flatMap((l) => l.traits), ...b.coalitions.flatMap((c) => c.specialRules)].map((t) => t.id);
    for (const id of used) expect(TRAITS.has(id), id).toBe(true);
    expect(validateReferences(b)).toEqual([]);
  });

  it("rejects unknown ids, wrong scope and bad params", () => {
    const b = structuredClone(loadBundle());
    b.leaders.find((l) => l.id === "vajpayee")!.traits.push({ id: "mind_control", params: {} });
    b.leaders.find((l) => l.id === "musharraf")!.traits.push({ id: "third_party_brokers", params: {} });
    b.leaders.find((l) => l.id === "musharraf")!.traits.find((t) => t.id === "khan_network")!.params = { leakagePerTurn: "lots" };
    expect(validateReferences(b)).toEqual([
      'leader musharraf: trait "khan_network" leakagePerTurn: Expected number, received string',
      'leader musharraf: trait "third_party_brokers" is a coalition trait, not a leader trait',
      'leader vajpayee: unknown trait "mind_control" (no handler in src/traits)',
    ]);
  });
});

describe("coercive_restraint (Vajpayee)", () => {
  const b = bundleWith({ leader: { vajpayee: ["coercive_restraint"] } });

  it("does nothing at or below the mobilization cap", () => {
    const s = newGame();
    s.nations.india!.mobilization = 50;
    const s1 = run(b, s);
    expect(s1.nations.india!.traitCounters).toEqual({});
    expect(s1.nations.india!.stability).toBe(65);
  });

  it("pressures the rival every turn at a rising stability cost, and resets on demobilizing", () => {
    let s = newGame();
    s.nations.india!.mobilization = 80;
    s.nations.india!.stability = 100;
    tension(s).level = 4; // keep mobilization legal-looking; upkeep does not care
    const costs: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = s.nations.india!.stability;
      s = run(b, s);
      costs.push(before - s.nations.india!.stability);
    }
    // 2 + floor(k * DOM 7 / 30), plus 1 per turn from mobilization upkeep and 1 from war-level tension.
    expect(costs).toEqual([4, 4, 4, 4, 5, 5]);
    expect(s.nations.india!.traitCounters).toEqual({ coercive_restraint: 6 });
    s.nations.india!.mobilization = 0;
    expect(run(b, s).nations.india!.traitCounters).toEqual({});
  });

  it("adds its pressure on top of posture upkeep", () => {
    const s = newGame();
    s.nations.india!.mobilization = 80;
    const without = run(bundleWith(), structuredClone(s));
    const withTrait = run(b, s);
    expect(tension(withTrait).pressure - tension(without).pressure).toBe(5);
  });
});

describe("no_first_use (Vajpayee)", () => {
  const b = bundleWith({ leader: { vajpayee: ["no_first_use"] } });

  function nuclearTurn(who: "india" | "pakistan") {
    const s = newGame();
    tension(s).level = 5;
    s.nations[who]!.alert = 1;
    const strike: Order = who === "india"
      ? { kind: "strike", targetId: "karachi", deliveryId: "agni_ii", payload: "nuclear", count: 1 }
      : { kind: "strike", targetId: "mumbai", deliveryId: "ghauri", payload: "nuclear", count: 1 };
    return run(b, s, { [who]: [strike] });
  }

  it("India using WMD first costs 40 stability and is announced", () => {
    const s = nuclearTurn("india");
    expect(s.events.find((e) => e.type === "pledge_broken")).toMatchObject({ actor: "india", visibility: "public" });
    expect(s.nations.india!.stability).toBeLessThanOrEqual(25);
  });

  it("does nothing when Pakistan goes first", () => {
    const s = nuclearTurn("pakistan");
    expect(s.events.some((e) => e.type === "pledge_broken")).toBe(false);
  });
});

describe("stated_thresholds (Musharraf)", () => {
  const b = bundleWith({ leader: { musharraf: ["stated_thresholds"] } });
  const esc = (s: GameState) => effectiveStat(s, s.nations.pakistan!, "esc");

  it("each red line drops ESC by 2 once, publicly", () => {
    let s = newGame();
    s.nations.pakistan!.stability = 20; // politics
    s.nations.pakistan!.sanctionsAgainst = 60; // economy
    s = run(b, s);
    expect(esc(s)).toBe(1); // 4 - 2 - 2 = 0, floored at 1
    expect(s.events.filter((e) => e.type === "red_line_crossed").map((e) => e.data.line)).toEqual(["economy", "politics"]);
    const again = run(b, s);
    expect(again.events.filter((e) => e.type === "red_line_crossed")).toHaveLength(2); // no repeats
  });

  it("territory and armed-forces lines", () => {
    const s = newGame();
    s.nations.pakistan!.regionsControlled = s.nations.pakistan!.regionsControlled.filter((r) => r !== "azad_kashmir_gilgit");
    s.nations.pakistan!.forces = { punjab_pk: 20 }; // start total is 80
    const s1 = run(b, s);
    expect(s1.events.filter((e) => e.type === "red_line_crossed").map((e) => e.data.line)).toEqual(["territory", "armed_forces"]);
    expect(s1.nations.pakistan!.baseStats.esc).toBe(1);
  });

  it("stays quiet in peacetime", () => {
    const s = run(b, newGame());
    expect(s.flags).toEqual({});
    expect(esc(s)).toBe(4);
  });
});

describe("khan_network (Musharraf)", () => {
  const b = bundleWith({ leader: { musharraf: ["khan_network"] } });

  it("leaks 2 a turn while CTL is below 7", () => {
    let s = newGame();
    for (let i = 0; i < 3; i++) s = run(b, s);
    expect(s.leakagePool).toBe(6);
  });

  it("stops when CTL is raised to 7", () => {
    const s = newGame();
    s.nations.pakistan!.modifiers.push({ stat: "ctl", delta: 2, untilTurn: 10, source: "test" });
    expect(run(b, s).leakagePool).toBe(0);
  });
});

describe("stability_instability_paradox (INDPAK)", () => {
  it("raises flashpoint chances while both sides are armed", () => {
    // At 1 bp about 0.04 fires are expected in 400 turns; with +150 bp about 6.
    const fires = (b: ContentBundle) => {
      let count = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const s = newGame(seed);
        s.flags.kargil_happened = true; // keep kargil out
        count += run(b, s).triggerFires.parliament_attack!.count;
      }
      return count;
    };
    expect(fires(bundleWith({ triggerBp: 1 }))).toBe(0);
    expect(fires(bundleWith({ triggerBp: 1, coalition: ["stability_instability_paradox"] }))).toBeGreaterThan(0);
  });

  it("leaves disabled triggers disabled", () => {
    const b = bundleWith({ triggerBp: 0, coalition: ["stability_instability_paradox"] });
    for (let seed = 1; seed <= 50; seed++) expect(run(b, newGame(seed)).triggerFires.parliament_attack!.count).toBe(0);
  });

  it("cuts assault odds between members", () => {
    const chance = (b: ContentBundle, disarm = false) => {
      const s = newGame(1);
      tension(s).level = 3;
      s.nations.india!.forces.punjab_haryana = 60;
      if (disarm) s.nations.pakistan!.nuclear.warheads = 0;
      const out = run(b, s, { india: [{ kind: "deploy", fromRegion: "punjab_haryana", toRegion: "punjab_pk", strength: 60 }] });
      const e = out.events.find((x) => x.type === "region_captured" || x.type === "assault_repulsed")!;
      return e.data.chanceBp as number;
    };
    const paradox = bundleWith({ coalition: ["stability_instability_paradox"] });
    const plain = chance(bundleWith());
    expect(chance(paradox)).toBe(Math.max(500, plain - 2000));
    expect(chance(paradox, true)).toBe(plain);
  });
});

describe("third_party_brokers (INDPAK)", () => {
  it("is registered and inert", () => {
    const withIt = bundleWith({ coalition: ["third_party_brokers"] });
    const without = bundleWith();
    expect(run(withIt, newGame(3))).toEqual(run(without, newGame(3)));
  });
});
