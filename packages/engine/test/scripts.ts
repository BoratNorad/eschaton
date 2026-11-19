import { getTension, resolveTurn, type ContentBundle, type GameState, type Order, type OrderSet } from "../src/index.js";

// Deterministic scripted players for replay tests. They read only the state
// they are given, so a replay is fully defined by (seed, script).

export type Script = (state: GameState, nationId: string) => Order[];

const RIVAL: Record<string, string> = { india: "pakistan", pakistan: "india" };

/** Mostly peaceful: invest, watch, reassure. */
export const quiet: Script = (s, id) => {
  const orders: Order[] = [{ kind: "intel_focus", target: RIVAL[id]! }];
  if (s.turn % 2 === 0) orders.push({ kind: "invest", track: "stability", amount: 4 });
  else orders.push({ kind: "invest", track: "cbrn_protection", amount: 3 }, { kind: "invest", track: "nuclear", amount: 5 });
  if (s.turn % 6 === 3) orders.push({ kind: "signal", to: RIVAL[id]!, signal: "reassurance", sincere: true });
  return orders;
};

/** Escalates every turn; tries orders before they are legal so rejections are exercised too. */
export const hawk: Script = (s, id) => {
  const rival = RIVAL[id]!;
  const level = getTension(s, "india", "pakistan").level;
  const me = s.nations[id]!;
  const orders: Order[] = [
    { kind: "signal", to: rival, signal: "ultimatum", sincere: id === "india" },
    { kind: "mobilize", level: 100 },
    { kind: "set_alert", level: Math.max(1, me.alert - 1) },
    { kind: "intel_focus", target: rival },
    { kind: "invest", track: "nuclear", amount: 6 },
  ];
  if (id === "india") orders.push({ kind: "deploy", fromRegion: "jammu_kashmir", toRegion: "azad_kashmir_gilgit", strength: 10 });
  else orders.push({ kind: "deploy", fromRegion: "azad_kashmir_gilgit", toRegion: "jammu_kashmir", strength: 10 });
  if (level >= 4) {
    orders.push(
      id === "india"
        ? { kind: "strike", targetId: "sargodha_air_base", deliveryId: "jaguar_in", payload: "conventional", count: 12 }
        : { kind: "strike", targetId: "ambala_air_base", deliveryId: "f16_pk", payload: "conventional", count: 8 },
    );
  }
  if (level >= 5 && me.alert <= 2) {
    orders.push(
      id === "india"
        ? { kind: "strike", targetId: "kahuta", deliveryId: "agni_i", payload: "nuclear", count: 2 }
        : { kind: "strike", targetId: "northern_command", deliveryId: "shaheen_i", payload: "nuclear", count: 2 },
    );
  }
  return orders;
};

export interface Replay {
  /** hashState after each resolved turn. */
  states: GameState[];
  final: GameState;
}

export function play(
  content: ContentBundle,
  start: GameState,
  scripts: Record<string, Script>,
  maxTurns = 1000,
): Replay {
  const states: GameState[] = [];
  let state = start;
  for (let i = 0; i < maxTurns && state.result === undefined; i++) {
    const orders: OrderSet[] = Object.keys(scripts)
      .sort()
      .map((id) => ({ nationId: id, turn: state.turn, orders: scripts[id]!(state, id) }));
    state = resolveTurn(content, state, orders).state;
    states.push(state);
  }
  return { states, final: state };
}
