import type { ContentBundle } from "./content/bundle.js";
import type { GameEvent, GameState, Order, OrderSet, PlayerView, Scenario } from "./schema/index.js";

// The engine's public contract. Everything outside packages/engine (client,
// server, AI, tools) goes through these functions. All are PURE: same inputs,
// same outputs, on every machine. Implementations live in src/engine/*.

export interface TurnResult {
  state: GameState;
  /** Events created this turn, in seq order (also appended to state.events). */
  events: GameEvent[];
}

export interface Engine {
  /** Build turn 0 from a validated scenario. Seeds the RNG from `seed`. */
  createGame(content: ContentBundle, scenario: Scenario, seed: number): GameState;

  /**
   * Resolve one turn. Orders from every active nation arrive together (WEGO).
   * Missing nations are treated as submitting no orders. The input state is
   * never mutated.
   */
  resolveTurn(content: ContentBundle, state: GameState, orders: OrderSet[]): TurnResult;

  /** Orders this nation may legally submit this turn. The server rejects anything else. */
  legalOrders(content: ContentBundle, state: GameState, nationId: string): Order[];

  /** Fog-of-war slice for one player. The server sends only this to clients. */
  viewFor(content: ContentBundle, state: GameState, nationId: string): PlayerView;

  /** Full state with hidden events revealed, for the after-action replay. */
  revealAll(state: GameState): GameState;
}
