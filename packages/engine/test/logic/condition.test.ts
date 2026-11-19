import { describe, expect, it } from "vitest";
import { evaluateCondition, LogicError, emitEvent, type Condition } from "../../src/index.js";
import { ctxFor, newGame, readOnlyCtx } from "../helpers.js";

const ev = (c: Condition, mutate?: (s: ReturnType<typeof newGame>) => void, bindings = {}) => {
  const s = newGame();
  mutate?.(s);
  return evaluateCondition(ctxFor(s, bindings), c);
};

describe("evaluateCondition", () => {
  it("always / all / any / not", () => {
    const T: Condition = { kind: "always" };
    const F: Condition = { kind: "not", cond: T };
    expect(ev(T)).toBe(true);
    expect(ev(F)).toBe(false);
    expect(ev({ kind: "all", of: [T, T] })).toBe(true);
    expect(ev({ kind: "all", of: [T, F] })).toBe(false);
    expect(ev({ kind: "any", of: [F, T] })).toBe(true);
    expect(ev({ kind: "any", of: [F, F] })).toBe(false);
  });

  it("all/any short-circuit: no draw after the deciding child", () => {
    const s = newGame();
    const before = { ...s.rng };
    const c: Condition = { kind: "all", of: [{ kind: "not", cond: { kind: "always" } }, { kind: "chance", bp: 5000 }] };
    expect(evaluateCondition(ctxFor(s), c)).toBe(false);
    expect(s.rng).toEqual(before);
  });

  it("phase_is / turn_at_least", () => {
    expect(ev({ kind: "phase_is", phase: "cold_composite" })).toBe(true);
    expect(ev({ kind: "phase_is", phase: "inheritance" })).toBe(false);
    expect(ev({ kind: "turn_at_least", turn: 0 })).toBe(true);
    expect(ev({ kind: "turn_at_least", turn: 3 })).toBe(false);
    expect(ev({ kind: "turn_at_least", turn: 3 }, (s) => (s.turn = 3))).toBe(true);
  });

  it("tension_at_least uses the unordered pair and side bindings", () => {
    expect(ev({ kind: "tension_at_least", pair: ["india", "pakistan"], level: 2 })).toBe(true);
    expect(ev({ kind: "tension_at_least", pair: ["pakistan", "india"], level: 3 })).toBe(false);
    expect(
      ev({ kind: "tension_at_least", pair: ["$actor_side", "$target_side"], level: 2 }, undefined, {
        actor: "pakistan",
        target: "india",
      }),
    ).toBe(true);
    expect(ev({ kind: "tension_at_least", pair: ["india", "india"], level: 1 })).toBe(false);
  });

  it("stat_at_least / stat_at_most include active modifiers only", () => {
    // musharraf agg 7
    expect(ev({ kind: "stat_at_least", nation: "pakistan", stat: "agg", value: 7 })).toBe(true);
    expect(ev({ kind: "stat_at_least", nation: "pakistan", stat: "agg", value: 8 })).toBe(false);
    expect(ev({ kind: "stat_at_most", nation: "pakistan", stat: "agg", value: 7 })).toBe(true);
    const boost = (untilTurn: number) => (s: ReturnType<typeof newGame>) =>
      s.nations.pakistan!.modifiers.push({ stat: "agg", delta: 2, untilTurn, source: "x" });
    expect(ev({ kind: "stat_at_least", nation: "pakistan", stat: "agg", value: 9 }, boost(1))).toBe(true);
    expect(ev({ kind: "stat_at_least", nation: "pakistan", stat: "agg", value: 9 }, boost(0))).toBe(false);
    // clamped to 10
    const big = (s: ReturnType<typeof newGame>) =>
      s.nations.pakistan!.modifiers.push({ stat: "agg", delta: 9, untilTurn: 5, source: "x" });
    expect(ev({ kind: "stat_at_most", nation: "pakistan", stat: "agg", value: 10 }, big)).toBe(true);
  });

  it("metric_at_least / metric_at_most", () => {
    expect(ev({ kind: "metric_at_least", nation: "india", metric: "stability", value: 65 })).toBe(true);
    expect(ev({ kind: "metric_at_least", nation: "india", metric: "stability", value: 66 })).toBe(false);
    expect(ev({ kind: "metric_at_most", nation: "pakistan", metric: "nuclear_warheads", value: 30 })).toBe(true);
    expect(ev({ kind: "metric_at_least", nation: "india", metric: "chemical_tonnes", value: 1000 })).toBe(true);
    expect(ev({ kind: "metric_at_least", nation: "$self", metric: "cbrn_protection", value: 25 }, undefined, { self: "india" })).toBe(true);
  });

  it("a nation outside the game makes leaves false", () => {
    expect(ev({ kind: "metric_at_least", nation: "usa", metric: "stability", value: 0 })).toBe(false);
    expect(ev({ kind: "not", cond: { kind: "controls_region", nation: "usa", region: "sindh" } })).toBe(true);
  });

  it("unbound $ refs throw LogicError", () => {
    expect(() => ev({ kind: "metric_at_least", nation: "$self", metric: "stability", value: 0 })).toThrow(LogicError);
    expect(() => ev({ kind: "tension_at_least", pair: ["$actor_side", "india"], level: 1 })).toThrow(LogicError);
  });

  it("flag_set", () => {
    expect(ev({ kind: "flag_set", flag: "kargil_happened" })).toBe(false);
    expect(ev({ kind: "flag_set", flag: "kargil_happened" }, (s) => (s.flags.kargil_happened = true))).toBe(true);
    expect(ev({ kind: "flag_set", flag: "kargil_happened" }, (s) => (s.flags.kargil_happened = false))).toBe(false);
  });

  it("event_occurred honours the window and actor/target filters", () => {
    const s = newGame();
    s.turn = 2;
    emitEvent(s, { type: "wmd_first_use", visibility: "hidden", text: "x", actor: "pakistan", target: "india" });
    s.turn = 5;
    const c = (withinTurns: number, extra: Partial<Extract<Condition, { kind: "event_occurred" }>> = {}): Condition => ({
      kind: "event_occurred", eventType: "wmd_first_use", withinTurns, ...extra,
    });
    const run = (cond: Condition, b = {}) => evaluateCondition(ctxFor(s, b), cond);
    expect(run(c(3))).toBe(true);
    expect(run(c(2))).toBe(false);
    expect(run(c(999, { actor: "pakistan" }))).toBe(true);
    expect(run(c(999, { actor: "india" }))).toBe(false);
    expect(run(c(999, { actor: "$self", target: "india" }), { self: "pakistan" })).toBe(true);
    expect(run({ kind: "event_occurred", eventType: "nuclear_exchange", withinTurns: 999 })).toBe(false);
  });

  it("site_status", () => {
    expect(ev({ kind: "site_status", site: "kahuta", status: "intact" })).toBe(true);
    expect(ev({ kind: "site_status", site: "kahuta", status: "destroyed" }, (s) => (s.nations.pakistan!.sites.kahuta = "destroyed"))).toBe(true);
  });

  it("controls_region", () => {
    expect(ev({ kind: "controls_region", nation: "india", region: "jammu_kashmir" })).toBe(true);
    expect(ev({ kind: "controls_region", nation: "pakistan", region: "jammu_kashmir" })).toBe(false);
  });

  it("member_of requires an active member", () => {
    expect(ev({ kind: "member_of", nation: "india", coalition: "INDPAK" })).toBe(true);
    expect(ev({ kind: "member_of", nation: "india", coalition: "AMNAT" })).toBe(false);
    expect(ev({ kind: "member_of", nation: "india", coalition: "INDPAK" }, (s) => (s.nations.india!.active = false))).toBe(false);
  });

  it("treaty_status defaults to nonparty", () => {
    expect(ev({ kind: "treaty_status", nation: "pakistan", treaty: "lahore_declaration", status: "ratified" })).toBe(true);
    expect(ev({ kind: "treaty_status", nation: "pakistan", treaty: "lahore_declaration", status: "nonparty" }, (s) => delete s.nations.pakistan!.treaties.lahore_declaration)).toBe(true);
  });

  it("chance consumes exactly one draw, and bp 0 / 10000 are certain", () => {
    const s = newGame();
    const ctx = ctxFor(s);
    const r0 = { ...s.rng };
    expect(evaluateCondition(ctx, { kind: "chance", bp: 0 })).toBe(false);
    const r1 = { ...s.rng };
    expect(r1).not.toEqual(r0);
    expect(evaluateCondition(ctx, { kind: "chance", bp: 10000 })).toBe(true);
    expect(s.rng).not.toEqual(r1);
  });

  it("chance in a read-only context throws", () => {
    expect(() => evaluateCondition(readOnlyCtx(newGame()), { kind: "chance", bp: 5000 })).toThrow(LogicError);
  });
});
