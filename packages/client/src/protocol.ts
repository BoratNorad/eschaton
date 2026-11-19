import type { GameEvent, Order, OrderSet, OrderSetCheck, PlayerView } from "@eschaton/engine";

// Messages between the UI thread and the engine worker. The UI never receives
// a GameState: only PlayerViews, order menus, check results and display names
// for things the current player is allowed to know about.

export interface NationInfo {
  id: string;
  name: string;
  /** Leader shown by default: the fictional alias. */
  leaderAlias: string;
  /** Historical name; shown only when the player turns on historical names. */
  leaderName: string;
  leaderTitle: string;
  color: string;
}

export interface RegionInfo {
  id: string;
  name: string;
  terrain: string;
  lat: number;
  lon: number;
}

export interface LinkInfo {
  from: string;
  to: string;
  mode: "land" | "sea" | "air";
}

export interface GameInfo {
  scenarioName: string;
  description: string;
  maxTurns: number;
  nations: NationInfo[];
  regions: RegionInfo[];
  links: LinkInfo[];
}

/** A site or metro the current player may see on the map. */
export interface Place {
  id: string;
  name: string;
  kind: "site" | "metro";
  regionId: string;
  owner: string;
  /** Site status, or for metros "damage N%". */
  status: string;
  capital: boolean;
}

export interface MenuItem {
  /** Stable key: the order's JSON. */
  key: string;
  order: Order;
  label: string;
  group: string;
  /** Optional sub-heading inside the group (target, origin region...). */
  sub?: string;
}

export interface SeatData {
  view: PlayerView;
  menu: MenuItem[];
  places: Place[];
  /** Display names for ids this player may see (nations, regions, places, treaties, own delivery systems). */
  names: Record<string, string>;
}

export interface TurnOutcome {
  /** The turn number now being planned. */
  turn: number;
  /** Set when the game has ended. */
  outcomes?: Record<string, "win" | "loss" | "draw">;
}

export type Request =
  | { type: "new"; seed: number }
  | { type: "seat"; nationId: string }
  | { type: "check"; set: OrderSet }
  | { type: "submit"; set: OrderSet }
  | { type: "reveal" };

export type Response =
  | { type: "new"; info: GameInfo; turn: number; planning: string[] }
  | { type: "seat"; data: SeatData }
  | { type: "check"; result: OrderSetCheck }
  | { type: "submit"; waitingFor: string[]; resolved?: TurnOutcome }
  | { type: "reveal"; events: GameEvent[] }
  | { type: "error"; message: string };

export interface Envelope<T> {
  id: number;
  body: T;
}
