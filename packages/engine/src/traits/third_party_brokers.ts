import { z } from "zod";
import { defineTrait } from "./define.js";

/**
 * INDPAK. Compendium: "AMNAT, REDCHI and SOVWAR can each spend influence to
 * de-escalate or inflame the theater."
 *
 * Deliberately inert until those coalitions and an influence resource exist
 * (slice 4). Registered so content can reference it and validation passes.
 */
export const thirdPartyBrokers = defineTrait({
  id: "third_party_brokers",
  scope: "coalition",
  summary: "Outside powers can spend influence to calm or inflame the theater (not active yet).",
  params: z.object({}).strict(),
});
