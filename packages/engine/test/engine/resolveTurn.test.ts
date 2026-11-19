import { describe, expect, it } from "vitest";
import {
  createGame, resolveTurn, type ContentBundle, type GameState, type Order, type OrderSet,
} from "../../src/index.js";
import { bundle, loadBundle, newGame, scenario } from "../helpers.js";

const run = (s: GameState, orders: Record<string, Order[]>, content: ContentBundle = bundle) =>
  resolveTurn(
    content,
    s,
    Object.entries(orders).map(([nationId, o]): OrderSet => ({ nationId, turn: s.turn, orders: o })),
  );

const tension = (s: GameState) => s.tensions["india|pakistan"]!;
const types = (s: GameState) => s.events.map((e) => e.type);
const rejections = (s: GameState) => s.events.filter((e) => e.type === "order_rejected").map((e) => e.data.reason);

/** A bundle with every trigger's chance forced to `bp`. */
function withTriggerChance(bp: number): ContentBundle {
  const b = structuredClone(loadBundle());
  for (const t of b.triggers) t.chanceBp = bp;
  return b;
}
const noTriggers = withTriggerChance(0);

function atLevel(level: number, mutate?: (s: GameState) => void): GameState {
  const s = newGame(1);
  tension(s).level = level;
  mutate?.(s);
  return s;
}

describe("step 1: validation", () => {
  it("drops sets for the wrong turn, duplicate sets and unknown nations", () => {
    const s = newGame();
    const { state } = resolveTurn(noTriggers, s, [
      { nationId: "india", turn: 3, orders: [{ kind: "set_alert", level: 3 }] },
      { nationId: "pakistan", turn: 0, orders: [{ kind: "set_alert", level: 3 }] },
      { nationId: "pakistan", turn: 0, orders: [{ kind: "set_alert", level: 1 }] },
      { nationId: "usa", turn: 0, orders: [] },
    ]);
    expect(state.nations.india!.alert).toBe(5);
    expect(state.nations.pakistan!.alert).toBe(3);
    expect(state.events.filter((e) => e.type === "orders_ignored").map((e) => e.data.reason)).toEqual([
      "orders are for turn 3, not 0",
      "duplicate order set",
      "nation is not playing",
    ]);
  });

  it("drops malformed sets with a hidden event", () => {
    const bad = { nationId: "india", turn: 0, orders: [{ kind: "nuke_everything" }] } as unknown as OrderSet;
    const { state } = resolveTurn(noTriggers, newGame(), [bad]);
    expect(state.events[0]).toMatchObject({ type: "orders_malformed", visibility: "hidden" });
  });

  it("rejects illegal orders privately and keeps the legal ones", () => {
    const { state } = run(newGame(), {
      india: [
        { kind: "strike", targetId: "kahuta", deliveryId: "agni_i", payload: "conventional", count: 1 },
        { kind: "deploy", fromRegion: "jammu_kashmir", toRegion: "sindh", strength: 5 },
        { kind: "invest", track: "stability", amount: 8 },
        { kind: "invest", track: "stability", amount: 8 },
        { kind: "use_trait", traitId: "no_first_use", params: {} },
      ],
    }, noTriggers);
    expect(rejections(state)).toEqual([
      "strikes need tension level 4 or higher",
      "sindh is not adjacent to jammu_kashmir",
      "investment is capped at 10 points per turn",
      "leader traits are not implemented yet",
    ]);
    const rej = state.events.find((e) => e.type === "order_rejected")!;
    expect(rej.visibility).toBe("private");
    expect(rej.audience).toEqual(["india"]);
    expect(state.nations.india!.stability).toBe(69); // 65 + floor(8/2)
  });

  it("checks strike range, payload, alert and warheads against the start of the turn", () => {
    const s = atLevel(5, (x) => (x.nations.india!.alert = 3));
    const { state } = run(s, {
      india: [
        { kind: "set_alert", level: 1 }, // takes effect, but too late for this turn's release
        { kind: "strike", targetId: "kahuta", deliveryId: "agni_ii", payload: "nuclear", count: 1 },
        { kind: "strike", targetId: "karachi", deliveryId: "prithvi_ii", payload: "conventional", count: 1 },
        { kind: "strike", targetId: "kahuta", deliveryId: "agni_ii", payload: "chemical", count: 1 },
      ],
    }, noTriggers);
    expect(rejections(state)).toEqual([
      "nuclear release needs alert level 2 or lower",
      "Karachi is out of range of Prithvi-II",
      "Agni-II cannot carry a chemical payload",
    ]);
  });

  it("mobilization above 50 needs war-level tension or the crisis unlock", () => {
    const a = run(newGame(), { india: [{ kind: "mobilize", level: 70 }] }, noTriggers).state;
    expect(a.nations.india!.mobilization).toBe(0);
    const unlocked = newGame();
    unlocked.nations.india!.unlockedActions.push({ action: "coercive_mobilization", untilTurn: 5 });
    const b = run(unlocked, { india: [{ kind: "mobilize", level: 70 }] }, noTriggers).state;
    expect(b.nations.india!.mobilization).toBe(20); // moves at most 20 per turn
  });
});

describe("step 2: diplomacy", () => {
  it("withdrawal runs onWithdrawal, ends covert violations and changes status", () => {
    const s = newGame();
    s.nations.pakistan!.covertViolations.push({ treatyId: "lahore_declaration", sinceTurn: 0 });
    const { state } = run(s, { pakistan: [{ kind: "withdraw_treaty", treatyId: "lahore_declaration" }] }, noTriggers);
    expect(state.nations.pakistan!.treaties.lahore_declaration).toBe("withdrawn");
    expect(state.nations.pakistan!.covertViolations).toEqual([]);
    expect(types(state)).toContain("treaty_withdrawn");
  });

  it("suspending the Indus Waters Treaty is a public lever against Pakistan", () => {
    const { state } = run(newGame(), { india: [{ kind: "withdraw_treaty", treatyId: "indus_waters_treaty" }] }, noTriggers);
    expect(state.nations.india!.treaties.indus_waters_treaty).toBe("withdrawn");
    expect(state.events.find((e) => e.type === "water_treaty_suspended")).toMatchObject({ actor: "india", visibility: "public" });
    expect(tension(state).pressure).toBe(60); // 30 at start + 30; too soon for quiet decay
    expect(state.nations.pakistan!.modifiers).toEqual([{ stat: "par", delta: 1, untilTurn: 12, source: "indus_waters_treaty" }]);
  });

  it("signals: private to both parties, sincerity hidden, pressure applied", () => {
    const { state } = run(newGame(), { india: [{ kind: "signal", to: "pakistan", signal: "threat", sincere: false }] }, noTriggers);
    const [sig, intent] = state.events;
    expect(sig).toMatchObject({ type: "signal", visibility: "private", audience: ["india", "pakistan"] });
    expect(sig!.data).not.toHaveProperty("sincere");
    expect(intent).toMatchObject({ type: "signal_intent", visibility: "hidden", data: { sincere: false } });
    expect(tension(state).pressure).toBe(40);
  });

  it("mutual same-turn ceasefire proposals agree a ceasefire and lower tension", () => {
    const s = atLevel(4);
    const { state } = run(s, {
      india: [{ kind: "propose_ceasefire", with: "pakistan" }],
      pakistan: [{ kind: "propose_ceasefire", with: "india" }],
    }, noTriggers);
    expect(state.ceasefires).toEqual([{ pair: "india|pakistan", sinceTurn: 0 }]);
    expect(tension(state).level).toBe(3);
  });

  it("a proposal can be accepted next turn; a later strike breaks it", () => {
    const s0 = atLevel(4);
    const s1 = run(s0, { india: [{ kind: "propose_ceasefire", with: "pakistan" }] }, noTriggers).state;
    expect(s1.ceasefires).toEqual([]);
    const s2 = run(s1, { pakistan: [{ kind: "accept_ceasefire", with: "india" }] }, noTriggers).state;
    expect(s2.ceasefires).toHaveLength(1);
    tension(s2).level = 4;
    const s3 = run(s2, {
      pakistan: [{ kind: "strike", targetId: "ambala_air_base", deliveryId: "f16_pk", payload: "conventional", count: 4 }],
    }, noTriggers).state;
    expect(s3.ceasefires).toEqual([]);
    expect(types(s3)).toContain("ceasefire_broken");
  });
});

describe("steps 4-5: movement and strikes", () => {
  it("an assault on an empty enemy region always succeeds and captures sites", () => {
    const s = atLevel(3, (x) => {
      x.nations.india!.forces.punjab_haryana = 40;
      delete x.nations.pakistan!.forces.punjab_pk;
    });
    const { state } = run(s, { india: [{ kind: "deploy", fromRegion: "punjab_haryana", toRegion: "punjab_pk", strength: 40 }] }, noTriggers);
    expect(state.nations.india!.regionsControlled).toContain("punjab_pk");
    expect(state.nations.pakistan!.regionsControlled).not.toContain("punjab_pk");
    expect(state.nations.pakistan!.sites.sargodha_air_base).toBe("captured");
    expect(tension(state).level).toBe(4);
  });

  it("a nuclear exchange ends the game in mutual loss, both counted as first users", () => {
    const s = atLevel(5, (x) => {
      x.nations.india!.alert = 1;
      x.nations.pakistan!.alert = 1;
    });
    const { state } = run(s, {
      india: [{ kind: "strike", targetId: "karachi", deliveryId: "agni_ii", payload: "nuclear", count: 1 }],
      pakistan: [{ kind: "strike", targetId: "mumbai", deliveryId: "ghauri", payload: "nuclear", count: 1 }],
    }, noTriggers);
    expect(state.nations.india!.nuclear.warheads).toBe(34);
    expect(state.nations.pakistan!.nuclear.warheads).toBe(29);
    expect(state.events.filter((e) => e.type === "wmd_first_use").map((e) => e.actor)).toEqual(["india", "pakistan"]);
    expect(types(state)).toContain("nuclear_exchange");
    expect(state.result).toEqual({ endedAtTurn: 0, outcomes: { india: "loss", pakistan: "loss" } });
    expect(state.turn).toBe(1);
    expect(() => run(state, {})).toThrow(/game ended/);
  });

  it("striking a listed nuclear installation violates the 1988 agreement", () => {
    const s = atLevel(4);
    const { state } = run(s, {
      india: [{ kind: "strike", targetId: "khushab", deliveryId: "mirage_2000_in", payload: "conventional", count: 30 }],
    }, noTriggers);
    const strike = state.events.find((e) => e.type === "strike")!;
    expect(strike.data.hits).toBeGreaterThan(0);
    expect(state.events.find((e) => e.type === "treaty_violated")?.actor).toBe("india");
    expect(tension(state).level).toBe(5); // onViolation raises by 2
  });
});

describe("step 7: triggers", () => {
  it("kargil fires at most once and runs the Lahore violation hook", () => {
    const content = withTriggerChance(10_000);
    // Keep parliament_attack out of the way: its condition needs Pakistan stability <= 70.
    const s = newGame();
    s.nations.pakistan!.stability = 90;
    const s1 = run(s, {}, content).state;
    expect(s1.flags.kargil_happened).toBe(true);
    expect(s1.triggerFires.kargil_infiltration).toEqual({ count: 1, lastTurn: 0 });
    expect(tension(s1).level).toBe(4);
    expect(s1.nations.india!.modifiers).toEqual([{ stat: "par", delta: 2, untilTurn: 12, source: "lahore_declaration" }]);
    expect(s1.events.find((e) => e.type === "border_infiltration")).toMatchObject({ actor: "pakistan", target: "india" });
    const s2 = run(s1, {}, content).state;
    expect(s2.triggerFires.kargil_infiltration!.count).toBe(1);
  });

  it("parliament attack: shock, unlock and a stat roll", () => {
    const content = withTriggerChance(10_000);
    const s = newGame();
    s.flags.kargil_happened = true; // keep kargil quiet
    const { state } = run(s, {}, content);
    expect(state.triggerFires.parliament_attack!.count).toBe(1);
    expect(state.nations.india!.unlockedActions).toEqual([{ action: "coercive_mobilization", untilTurn: 12 }]);
    expect(types(state)).toEqual(expect.arrayContaining(["terror_attack_capital", "stat_roll"]));
  });
});

describe("steps 9-12: upkeep, intel, end of turn", () => {
  it("quiet pairs lose pressure and eventually de-escalate", () => {
    let s = newGame();
    for (let i = 0; i < 12; i++) s = run(s, {}, noTriggers).state;
    expect(tension(s).level).toBe(1);
  });

  it("posture keeps pressure building", () => {
    const s = newGame();
    s.nations.india!.alert = 2;
    const { state } = run(s, {}, noTriggers);
    expect(tension(state).pressure).toBe(33);
  });

  it("intel focus narrows the band around the truth", () => {
    let s = newGame(9);
    for (let i = 0; i < 6; i++) s = run(s, { pakistan: [{ kind: "intel_focus", target: "india" }] }, noTriggers).state;
    const est = s.beliefs.pakistan!.india!.warheads!;
    expect(est.high - est.low).toBe(2);
    expect(est.low).toBeLessThanOrEqual(s.nations.india!.nuclear.warheads);
    expect(est.high).toBeGreaterThanOrEqual(s.nations.india!.nuclear.warheads);
    expect(est.asOfTurn).toBe(5);
  });

  it("modifiers and unlocks expire at the end of their last turn", () => {
    const s = newGame();
    s.nations.india!.modifiers.push({ stat: "par", delta: 1, untilTurn: 1, source: "x" });
    s.nations.india!.unlockedActions.push({ action: "coercive_mobilization", untilTurn: 2 });
    const s1 = run(s, {}, noTriggers).state;
    expect(s1.nations.india!.modifiers).toEqual([]);
    expect(s1.nations.india!.unlockedActions).toHaveLength(1);
    expect(run(s1, {}, noTriggers).state.nations.india!.unlockedActions).toEqual([]);
  });

  it("the game ends at maxTurns with a final victory check at the new turn number", () => {
    const s = newGame();
    s.turn = scenario().maxTurns - 1;
    s.nations.pakistan!.stability = 30; // below Pakistan's 35 threshold
    const { state } = run(s, {}, noTriggers);
    expect(state.turn).toBe(48);
    expect(state.result).toEqual({ endedAtTurn: 48, outcomes: { india: "win", pakistan: "loss" } });
  });
});

describe("step 8: non-state actors (synthetic content)", () => {
  it("spawns from leakage, climbs the ladder and attacks", () => {
    const b = structuredClone(loadBundle());
    b.nonstate.push({
      id: "test_cell", name: "Test cell", leaderName: "Nobody", alias: "The Cell",
      stats: { agg: 5, esc: 5, par: 5, blf: 5, ctl: 5 },
      operatingRegions: ["jammu_kashmir"],
      spawn: { when: { kind: "always" }, minLeakage: 5 },
      ladder: [{ id: "test_step", label: "Step", leakageCost: 1, failureBp: 0, exposureBp: 10_000 }],
      attackEffects: [{ kind: "stability_shock", nation: "$target", amount: -7 }],
    });
    for (const t of b.triggers) t.chanceBp = 0;
    b.scenarios[0]!.nonStateActors = ["test_cell"];
    const s = createGame(b, b.scenarios[0]!, 1);
    s.leakagePool = 10;
    const s1 = run(s, {}, b).state;
    expect(s1.nonState.test_cell).toEqual({ active: true, stepIndex: 0 });
    const s2 = run(s1, {}, b).state;
    expect(types(s2)).toEqual(expect.arrayContaining(["nonstate_activity_detected", "nonstate_attack"]));
    expect(s2.leakagePool).toBe(9);
    expect(s2.events.find((e) => e.type === "nonstate_attack")?.target).toBe("india");
  });
});
