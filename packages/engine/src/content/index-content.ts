import type { Coalition, Leader, Nation, NonStateActor, Scenario, Treaty, Trigger, WorldMap } from "../schema/index.js";
import type { ContentBundle } from "./bundle.js";

/**
 * Id lookups over a ContentBundle. Built fresh by each engine entry point
 * (no module-level cache: the engine keeps no mutable globals). Read-only.
 */
export interface ContentIndex {
  readonly bundle: ContentBundle;
  readonly nations: ReadonlyMap<string, Nation>;
  readonly leaders: ReadonlyMap<string, Leader>;
  readonly coalitions: ReadonlyMap<string, Coalition>;
  readonly treaties: ReadonlyMap<string, Treaty>;
  readonly triggers: ReadonlyMap<string, Trigger>;
  readonly nonstate: ReadonlyMap<string, NonStateActor>;
  readonly maps: ReadonlyMap<string, WorldMap>;
  readonly scenarios: ReadonlyMap<string, Scenario>;
  /** site id -> owning nation id */
  readonly siteOwner: ReadonlyMap<string, string>;
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((x) => [x.id, x]));
}

export function indexContent(bundle: ContentBundle): ContentIndex {
  const siteOwner = new Map<string, string>();
  for (const n of bundle.nations) for (const s of n.sites) siteOwner.set(s.id, n.id);
  return {
    bundle,
    nations: byId(bundle.nations),
    leaders: byId(bundle.leaders),
    coalitions: byId(bundle.coalitions),
    treaties: byId(bundle.treaties),
    triggers: byId(bundle.triggers),
    nonstate: byId(bundle.nonstate),
    maps: byId(bundle.maps),
    scenarios: byId(bundle.scenarios),
    siteOwner,
  };
}
