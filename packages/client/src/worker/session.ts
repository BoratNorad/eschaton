import {
  checkOrderSet, createGame, legalOrders, resolveTurn, revealAll, viewFor,
  type ContentBundle, type GameEvent, type GameState, type OrderSet, type PlayerView,
} from "@eschaton/engine";
import type { GameInfo, MenuItem, NationInfo, Place, Response, SeatData } from "../protocol.js";
import { describeOrder } from "./labels.js";

// One hotseat game. This object is the ONLY holder of the GameState: it lives
// inside the worker and answers with per-player slices. Plain TypeScript, so
// it is tested in Node.

const COLORS: Record<string, string> = { india: "#f08c2e", pakistan: "#2fa35a" };
const FALLBACK_COLORS = ["#4c8fd6", "#c45bd0", "#d0b13a", "#5bc0be"];

export class Session {
  private state: GameState | undefined;
  private pending = new Map<string, OrderSet>();

  constructor(
    private readonly content: ContentBundle,
    private readonly scenarioId: string,
  ) {}

  newGame(seed: number): Extract<Response, { type: "new" }> {
    const scenario = this.content.scenarios.find((s) => s.id === this.scenarioId);
    if (!scenario) throw new Error(`unknown scenario ${this.scenarioId}`);
    this.state = createGame(this.content, scenario, seed);
    this.pending.clear();
    const map = this.content.maps.find((m) => m.id === scenario.mapId)!;
    const nations: NationInfo[] = [...scenario.nations].sort().map((id, i) => {
      const n = this.content.nations.find((x) => x.id === id)!;
      const l = this.content.leaders.find((x) => x.id === n.leaderId)!;
      return {
        id, name: n.name, leaderAlias: l.alias, leaderName: l.name, leaderTitle: l.title,
        color: COLORS[id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      };
    });
    const info: GameInfo = {
      scenarioName: scenario.name,
      description: scenario.description,
      maxTurns: scenario.maxTurns,
      nations,
      regions: map.regions.map((r) => ({ id: r.id, name: r.name, terrain: r.terrain, lat: r.displayCentroid[0], lon: r.displayCentroid[1] })),
      links: map.links.map((l) => ({ from: l.from, to: l.to, mode: l.mode })),
    };
    return { type: "new", info, turn: this.state.turn, planning: this.planning() };
  }

  /** Nations that still have to submit orders this turn, in planning order. */
  planning(): string[] {
    const s = this.require();
    if (s.result) return [];
    return Object.keys(s.nations)
      .sort()
      .filter((id) => s.nations[id]!.active && !this.pending.has(id));
  }

  seat(nationId: string): SeatData {
    const s = this.require();
    const view = viewFor(this.content, s, nationId);
    const names = this.namesFor(view);
    const name = (id: string) => names[id] ?? id;
    const menu: MenuItem[] = legalOrders(this.content, s, nationId).map((order) => ({
      key: JSON.stringify(order),
      order,
      ...describeOrder(order, name),
    }));
    view.events = view.events.map((e) => prettify(e, names));
    return { view, menu, places: this.placesFor(view), names };
  }

  check(set: OrderSet) {
    return checkOrderSet(this.content, this.require(), set);
  }

  submit(set: OrderSet): Extract<Response, { type: "submit" }> {
    const s = this.require();
    if (s.result) throw new Error("the game is over");
    if (!this.planning().includes(set.nationId)) throw new Error(`${set.nationId} has already submitted or is not playing`);
    this.pending.set(set.nationId, set);
    const waitingFor = this.planning();
    if (waitingFor.length > 0) return { type: "submit", waitingFor };

    const sets = [...this.pending.values()];
    this.pending.clear();
    this.state = resolveTurn(this.content, s, sets).state;
    const next = this.state;
    return {
      type: "submit",
      waitingFor: this.planning(),
      resolved: next.result ? { turn: next.turn, outcomes: next.result.outcomes } : { turn: next.turn },
    };
  }

  /** After-action log with every hidden event shown. Only once the game is over. */
  reveal(): GameEvent[] {
    const s = this.require();
    if (!s.result) throw new Error("the full log opens when the game ends");
    const names = this.allNames();
    return revealAll(s).events.map((e) => prettify(e, names));
  }

  private require(): GameState {
    if (!this.state) throw new Error("no game in progress");
    return this.state;
  }

  /** Names only for what this viewer may know about: no covert site names leak through labels. */
  private namesFor(view: PlayerView): Record<string, string> {
    const names: Record<string, string> = {};
    const s = this.require();
    for (const id of Object.keys(s.nations)) names[id] = this.content.nations.find((n) => n.id === id)?.name ?? id;
    const map = this.mapFor();
    for (const r of map.regions) names[r.id] = r.name;
    for (const t of this.content.treaties) names[t.id] = t.name;
    for (const n of this.content.nations) {
      if (s.nations[n.id] === undefined) continue;
      for (const m of n.metros) names[m.id] = m.name;
      const own = n.id === view.viewer;
      const known = new Set(own ? n.sites.map((x) => x.id) : Object.keys(view.others[n.id]?.sitesKnown ?? {}));
      for (const site of n.sites) if (known.has(site.id)) names[site.id] = site.name;
      if (own) for (const d of n.delivery) names[d.id] = d.name;
    }
    return names;
  }

  private allNames(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const n of this.content.nations) {
      names[n.id] = n.name;
      for (const m of n.metros) names[m.id] = m.name;
      for (const x of n.sites) names[x.id] = x.name;
    }
    return names;
  }

  private placesFor(view: PlayerView): Place[] {
    const s = this.require();
    const places: Place[] = [];
    for (const n of this.content.nations) {
      const st = s.nations[n.id];
      if (st === undefined) continue;
      const own = n.id === view.viewer;
      const metros = own ? view.self.metros : view.others[n.id]?.metros ?? {};
      for (const m of n.metros) {
        const ms = metros[m.id];
        places.push({
          id: m.id, name: m.name, kind: "metro", regionId: m.regionId, owner: n.id, capital: m.isCapital,
          status: ms ? `damage ${ms.damage}%${ms.contaminated ? ", contaminated" : ""}` : "unknown",
        });
      }
      const sites = own ? view.self.sites : view.others[n.id]?.sitesKnown ?? {};
      for (const site of n.sites) {
        const status = sites[site.id];
        if (status === undefined) continue;
        places.push({ id: site.id, name: site.name, kind: "site", regionId: site.regionId, owner: n.id, capital: false, status });
      }
    }
    return places;
  }

  private mapFor() {
    const scenario = this.content.scenarios.find((x) => x.id === this.scenarioId)!;
    return this.content.maps.find((m) => m.id === scenario.mapId)!;
  }
}

/** Replace ids in engine text with display names ("india|pakistan" -> "India-Pakistan"). */
export function prettify(e: GameEvent, names: Record<string, string>): GameEvent {
  const text = e.text.replace(/\b[a-z][a-z0-9_]*(\|[a-z][a-z0-9_]*)?\b/g, (token) => {
    if (token.includes("|")) {
      const [a, b] = token.split("|") as [string, string];
      return names[a] && names[b] ? `${names[a]}-${names[b]}` : token;
    }
    return names[token] ?? token;
  });
  return { ...e, text: text.charAt(0).toUpperCase() + text.slice(1) };
}
