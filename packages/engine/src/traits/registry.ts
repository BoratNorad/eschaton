import type { RegisteredTrait } from "./define.js";
import { coerciveRestraint } from "./coercive_restraint.js";
import { khanNetwork } from "./khan_network.js";
import { noFirstUse } from "./no_first_use.js";
import { stabilityInstabilityParadox } from "./stability_instability_paradox.js";
import { statedThresholds } from "./stated_thresholds.js";
import { thirdPartyBrokers } from "./third_party_brokers.js";

/** Every trait the engine implements. Content referencing any other id fails validation. */
export const TRAITS: ReadonlyMap<string, RegisteredTrait> = new Map(
  [coerciveRestraint, khanNetwork, noFirstUse, stabilityInstabilityParadox, statedThresholds, thirdPartyBrokers].map(
    (t) => [t.id, t],
  ),
);
