import { z } from "zod";
import {
  Coalition, Leader, NonStateActor, Nation, Pipeline, Scenario, Treaty, Trigger, WorldMap,
} from "../schema/index.js";

/**
 * Every content folder under /data maps to one schema. The loader parses each
 * JSON file with the schema for its folder, then validateReferences() checks ids.
 */
export const CONTENT_SCHEMAS = {
  leaders: Leader,
  nations: Nation,
  coalitions: Coalition,
  treaties: Treaty,
  triggers: Trigger,
  pipelines: Pipeline,
  nonstate: NonStateActor,
  maps: WorldMap,
  scenarios: Scenario,
} as const;

export type ContentKind = keyof typeof CONTENT_SCHEMAS;

export type ContentBundle = {
  [K in ContentKind]: Array<z.infer<(typeof CONTENT_SCHEMAS)[K]>>;
};

export function emptyBundle(): ContentBundle {
  return {
    leaders: [], nations: [], coalitions: [], treaties: [], triggers: [],
    pipelines: [], nonstate: [], maps: [], scenarios: [],
  };
}
