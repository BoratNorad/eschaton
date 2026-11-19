import { describe, expect, it } from "vitest";
import { applyEffects, effectiveStat, LogicError, nextU32, type Effect, type GameState } from "../../src/index.js";
import { ctxFor, newGame, readOnlyCtx } from "../helpers.js";

const tension = (s: GameState) => s.tensions["india|pakistan"]!;

function run(effects: Effect[], opts: { bindings?: object; mutate?: (s: GameState) => void; seed?: number } = {}) {
  const s = newGame(opts.seed ?? 1);
  opts.mutate?.(s);
  applyEffects(ctxFor(s, opts.bindings ?? {}), effects);
  return s;
}

describe("applyEffects", () => {
  it("raise_tension / lower_tension clamp to 1-5 and emit tension_changed", () => {
    const s = run([{ kind: "raise_tension", pair: ["india", "pakistan"], levels: 4 }]);
    expect(tension(s).level).toBe(5);
    expect(tension(s).lastIncidentTurn).toBe(0);
    expect(s.events.map((e) => e.type)).toEqual(["tension_changed"]);
    const t = run([{ kind: "lower_tension", pair: ["pakistan", "india"], levels: 4 }]);
    expect(tension(t).level).toBe(1);
    const noop = run([{ kind: "raise_tension", pair: ["india", "pakistan"], levels: 1 }], { mutate: (x) => (tension(x).level = 5) });
    expect(noop.events).toEqual([]);
  });

  it("add_pressure: 100 raises one level and resets to 0; floors at 0; caps at 99 on level 5", () => {
    const s = run([{ kind: "add_pressure", pair: ["india", "pakistan"], points: 80 }]); // starts at 30
    expect(tension(s)).toMatchObject({ level: 3, pressure: 0 });
    const t = run([{ kind: "add_pressure", pair: ["india", "pakistan"], points: -100 }]);
    expect(tension(t)).toMatchObject({ level: 2, pressure: 0 });
    const u = run([{ kind: "add_pressure", pair: ["india", "pakistan"], points: 100 }], { mutate: (x) => (tension(x).level = 5) });
    expect(tension(u)).toMatchObject({ level: 5, pressure: 99 });
  });

  it("stat_roll draws once, logs a hidden event and runs one branch", () => {
    const passed: boolean[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const s = run(
        [{
          kind: "stat_roll", nation: "india", stat: "esc", difficulty: 6,
          onPass: [{ kind: "set_flag", flag: "passed", value: true }],
          onFail: [{ kind: "set_flag", flag: "failed", value: true }],
        }],
        { seed },
      );
      const roll = s.events.find((e) => e.type === "stat_roll")!;
      expect(roll.visibility).toBe("hidden");
      expect(roll.data.need).toBe(7); // esc 8 - (6 - 5)
      expect(roll.data.passed).toBe((roll.data.roll as number) <= 7);
      expect(s.flags.passed === true).toBe(roll.data.passed);
      expect(s.flags.failed === true).toBe(!roll.data.passed);
      passed.push(roll.data.passed as boolean);
    }
    expect(passed).toContain(true);
    expect(passed).toContain(false);
  });

  it("stat_roll advances the RNG by exactly one draw", () => {
    const a = newGame(7);
    const b = newGame(7);
    applyEffects(ctxFor(a), [{ kind: "stat_roll", nation: "india", stat: "esc", difficulty: 5, onPass: [], onFail: [] }]);
    nextU32(b.rng);
    expect(a.rng).toEqual(b.rng);
  });

  it("stat_roll in a read-only context throws", () => {
    expect(() =>
      applyEffects(readOnlyCtx(newGame()), [{ kind: "stat_roll", nation: "india", stat: "esc", difficulty: 5, onPass: [], onFail: [] }]),
    ).toThrow(LogicError);
  });

  it("modify_stat adds a timed modifier tagged with the source", () => {
    const s = run([{ kind: "modify_stat", nation: "india", stat: "par", delta: 2, turns: 3 }]);
    expect(s.nations.india!.modifiers).toEqual([{ stat: "par", delta: 2, untilTurn: 3, source: "test_source" }]);
    expect(effectiveStat(s, s.nations.india!, "par")).toBe(7);
    s.turn = 3;
    expect(effectiveStat(s, s.nations.india!, "par")).toBe(5);
  });

  it("stability_shock clamps to 0-100", () => {
    expect(run([{ kind: "stability_shock", nation: "india", amount: -12 }]).nations.india!.stability).toBe(53);
    expect(run([{ kind: "stability_shock", nation: "india", amount: -100 }]).nations.india!.stability).toBe(0);
    expect(run([{ kind: "stability_shock", nation: "india", amount: 100 }]).nations.india!.stability).toBe(100);
  });

  it("set_flag", () => {
    expect(run([{ kind: "set_flag", flag: "x_y", value: true }]).flags.x_y).toBe(true);
  });

  it("emit_event resolves bindings and derives the audience", () => {
    const s = run(
      [
        { kind: "emit_event", eventType: "a", visibility: "public", text: "t", actor: "$actor", target: "$target" },
        { kind: "emit_event", eventType: "b", visibility: "private", text: "t", actor: "$actor", target: "$target" },
        { kind: "emit_event", eventType: "c", visibility: "coalition", text: "t", actor: "$actor" },
      ],
      { bindings: { actor: "pakistan", target: "india" } },
    );
    expect(s.events.map((e) => [e.seq, e.type, e.actor, e.target, e.audience])).toEqual([
      [0, "a", "pakistan", "india", []],
      [1, "b", "pakistan", "india", ["india", "pakistan"]],
      [2, "c", "pakistan", undefined, ["pakistan"]], // split theater: own side only
    ]);
    expect(s.nextEventSeq).toBe(3);
  });

  it("unlock_action adds or extends", () => {
    const s = run([
      { kind: "unlock_action", nation: "india", action: "coercive_mobilization", turns: 12 },
      { kind: "unlock_action", nation: "india", action: "coercive_mobilization", turns: 4 },
    ]);
    expect(s.nations.india!.unlockedActions).toEqual([{ action: "coercive_mobilization", untilTurn: 12 }]);
  });

  it("violate_treaty runs onViolation with $actor = violator, only for parties", () => {
    const s = run([{ kind: "violate_treaty", nation: "pakistan", treaty: "lahore_declaration" }]);
    expect(s.nations.india!.stability).toBe(55);
    expect(s.nations.india!.modifiers).toEqual([{ stat: "par", delta: 2, untilTurn: 12, source: "lahore_declaration" }]);
    expect(s.nations.pakistan!.treaties.lahore_declaration).toBe("ratified");

    const v = run([{ kind: "violate_treaty", nation: "india", treaty: "india_pakistan_nuclear_facilities" }]);
    const ev = v.events.find((e) => e.type === "treaty_violated")!;
    expect(ev.actor).toBe("india");
    expect(tension(v).level).toBe(4);

    const np = run([{ kind: "violate_treaty", nation: "pakistan", treaty: "lahore_declaration" }], {
      mutate: (x) => (x.nations.pakistan!.treaties.lahore_declaration = "withdrawn"),
    });
    expect(np.nations.india!.stability).toBe(65);
  });

  it("expose_program", () => {
    const s = run([{ kind: "expose_program", nation: "india", track: "nuclear" }], {
      mutate: (x) => (x.nations.india!.nuclear.exposed = false),
    });
    expect(s.nations.india!.nuclear.exposed).toBe(true);
    expect(s.events[0]).toMatchObject({ type: "program_exposed", target: "india", visibility: "public" });
  });

  it("reveal_site updates the owner and every rival's beliefs", () => {
    const s = run([{ kind: "reveal_site", site: "india_cw_depot" }]);
    expect(s.nations.india!.discoveredSites).toContain("india_cw_depot");
    expect(s.beliefs.pakistan!.india!.knownSites).toContain("india_cw_depot");
    expect(s.events[0]).toMatchObject({ type: "site_revealed", target: "india" });
  });

  it("sanction accumulates up to 100", () => {
    const s = run([
      { kind: "sanction", by: "$actor_side", against: "india", severity: 60 },
      { kind: "sanction", by: "pakistan", against: "india", severity: 60 },
    ], { bindings: { actor: "pakistan" } });
    expect(s.nations.india!.sanctionsAgainst).toBe(100);
    expect(s.events.map((e) => e.data.by)).toEqual(["pakistan", "pakistan"]);
  });

  it("add_leakage floors at 0", () => {
    expect(run([{ kind: "add_leakage", amount: 5 }, { kind: "add_leakage", amount: -2 }]).leakagePool).toBe(3);
    expect(run([{ kind: "add_leakage", amount: -2 }]).leakagePool).toBe(0);
  });

  it("spawn_actor ignores actors that have no content", () => {
    expect(run([{ kind: "spawn_actor", actor: "nobody" }]).nonState).toEqual({});
  });

  it("change_phase", () => {
    const s = run([{ kind: "change_phase", phase: "gulf_expansion" }, { kind: "change_phase", phase: "gulf_expansion" }]);
    expect(s.phase).toBe("gulf_expansion");
    expect(s.events.map((e) => e.type)).toEqual(["phase_changed"]);
  });

  it("effects aimed at nations outside the game are no-ops", () => {
    const s = run([{ kind: "stability_shock", nation: "usa", amount: -10 }]);
    expect(s.nations.usa).toBeUndefined();
  });

  it("does not touch anything but the given state", () => {
    const s = newGame();
    const copy = structuredClone(s);
    applyEffects(ctxFor(copy), [{ kind: "raise_tension", pair: ["india", "pakistan"], levels: 1 }]);
    expect(s).toEqual(newGame());
  });
});
