import { describe, expect, it } from "vitest";
import {
  checkOrderSet, legalOrders, resolveTurn, stableStringify, type GameState, type Order,
} from "../../src/index.js";
import { bundle, newGame } from "../helpers.js";
import { hawk, play, quiet } from "../scripts.js";

/** States from a quiet and a hawkish game, so menus are checked at every tension level. */
function sampleStates(): GameState[] {
  const q = play(bundle, newGame(11), { india: quiet, pakistan: quiet }, 6).states;
  const h = play(bundle, newGame(1), { india: hawk, pakistan: hawk }).states.filter((s) => s.result === undefined);
  return [newGame(11), ...q, ...h];
}

const NATIONS = ["india", "pakistan"];
const kinds = (os: Order[]) => new Set(os.map((o) => o.kind));
const levelOf = (s: GameState) => s.tensions["india|pakistan"]!.level;

describe("legalOrders", () => {
  const states = sampleStates();

  it("every menu entry, submitted alone, is accepted by resolveTurn", () => {
    // Exhaustive over a few states; resolveTurn per order is the ground truth.
    for (const s of [states[0]!, states.at(-1)!]) {
      for (const id of NATIONS) {
        for (const order of legalOrders(bundle, s, id)) {
          const { events } = resolveTurn(bundle, s, [{ nationId: id, turn: s.turn, orders: [order] }]);
          const rejected = events.filter((e) => e.type === "order_rejected" || e.type === "orders_ignored");
          expect(rejected, stableStringify(order)).toEqual([]);
        }
      }
    }
  });

  it("checkOrderSet predicts step 1 exactly, budgets included", () => {
    for (const s of states) {
      for (const id of NATIONS) {
        const menu = legalOrders(bundle, s, id);
        // A deterministic mixed bag: every 13th entry plus duplicates to hit budgets, capped at 24.
        const picked = menu.filter((_, i) => i % 13 === 0).slice(0, 20);
        const orders = [...picked, ...picked.slice(0, 4)];
        const set = { nationId: id, turn: s.turn, orders };
        const predicted = checkOrderSet(bundle, s, set).orders;
        const { events } = resolveTurn(bundle, s, [set]);
        const actual = orders.map((_, i) => {
          const e = events.find((x) => x.type === "order_rejected" && x.data.index === i);
          return e === undefined ? null : (e.data.reason as string);
        });
        expect(actual).toEqual(predicted);
      }
    }
  });

  it("strike options follow the tension ladder and alert", () => {
    const s = newGame();
    expect(kinds(legalOrders(bundle, s, "india")).has("strike")).toBe(false);

    s.tensions["india|pakistan"]!.level = 4;
    const war = legalOrders(bundle, s, "india").filter((o) => o.kind === "strike");
    expect(war.length).toBeGreaterThan(0);
    expect(war.every((o) => o.kind === "strike" && o.payload === "conventional")).toBe(true);

    s.tensions["india|pakistan"]!.level = 5;
    expect(legalOrders(bundle, s, "india").some((o) => o.kind === "strike" && o.payload === "nuclear")).toBe(false);
    s.nations.india!.alert = 2;
    const nuclear = legalOrders(bundle, s, "india").filter((o) => o.kind === "strike" && o.payload === "nuclear");
    expect(nuclear.length).toBeGreaterThan(0);
    // Agni-II reaches anywhere in Pakistan; Prithvi-II (250 km) does not reach Karachi.
    expect(nuclear).toContainEqual({ kind: "strike", targetId: "karachi", deliveryId: "agni_ii", payload: "nuclear", count: 1 });
    expect(nuclear.some((o) => o.kind === "strike" && o.targetId === "karachi" && o.deliveryId === "prithvi_ii")).toBe(false);
  });

  it("assault options appear only from tension level 3", () => {
    const hostile = (s: GameState) =>
      legalOrders(bundle, s, "india").some((o) => o.kind === "deploy" && o.toRegion === "azad_kashmir_gilgit");
    const s = newGame();
    expect(hostile(s)).toBe(false);
    s.tensions["india|pakistan"]!.level = 3;
    expect(hostile(s)).toBe(true);
  });

  it("never offers kinds that have no legal form yet", () => {
    for (const s of states)
      for (const id of NATIONS) {
        const k = kinds(legalOrders(bundle, s, id));
        for (const never of ["aid", "recruit", "join_pipeline", "use_trait"]) expect(k.has(never as Order["kind"])).toBe(false);
      }
  });

  it("is empty for an unknown nation or a finished game, and does not touch the state", () => {
    const s = newGame();
    const before = stableStringify(s);
    expect(legalOrders(bundle, s, "usa")).toEqual([]);
    legalOrders(bundle, s, "india");
    expect(stableStringify(s)).toBe(before);
    const ended = play(bundle, newGame(1), { india: hawk, pakistan: hawk }).final;
    expect(ended.result).toBeDefined();
    expect(legalOrders(bundle, ended, "india")).toEqual([]);
  });

  it("checkOrderSet reports set-level problems", () => {
    const s = newGame();
    const order: Order = { kind: "set_alert", level: 3 };
    expect(checkOrderSet(bundle, s, { nationId: "india", turn: 2, orders: [order] })).toEqual({
      setError: "orders are for turn 2, not 0",
      orders: ["orders are for turn 2, not 0"],
    });
    expect(checkOrderSet(bundle, s, { nationId: "usa", turn: 0, orders: [] }).setError).toBe("nation is not playing");
  });

  it("menus are deterministic", () => {
    const s = states[3]!;
    expect(stableStringify(legalOrders(bundle, s, "pakistan"))).toBe(stableStringify(legalOrders(bundle, s, "pakistan")));
    expect(levelOf(states.at(-1)!)).toBe(5);
  });
});
