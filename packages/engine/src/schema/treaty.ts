import { z } from "zod";
import { Effect } from "./logic.js";
import { Bp, PartyStatus, PhaseId, Slug, Year } from "./primitives.js";

export const TreatyCovers = z.enum([
  "cw_use", "bw_use", "cw_possession", "bw_possession",
  "nuclear_test_atmospheric", "nuclear_test_all", "nuclear_proliferation", "nuclear_free_zone",
  "launcher_limits", "missile_defense_limits", "intermediate_missiles",
  "space_wmd", "seabed_wmd", "nuclear_facility_attack",
  "export_controls", "security_assurance", "confidence_building", "water_sharing",
]);

export const Verification = z.enum([
  "none", "national_means", "list_exchange", "regional_agency",
  "iaea_safeguards", "on_site", "challenge_inspection", "global_monitoring",
]);

export const Treaty = z
  .object({
    id: Slug,
    name: z.string().min(1),
    year: Year,
    covers: z.array(TreatyCovers).min(1),
    verification: Verification,
    /** Per-turn chance a covert violation is detected. */
    detectionBpPerTurn: Bp,
    /** Single source of truth for membership. Nations not listed are non-parties. */
    parties: z.record(Slug, PartyStatus),
    inForce: z.boolean(),
    entersForceAtPhase: PhaseId.optional(),
    /** Bindings: $actor = the nation signing, violating or withdrawing. */
    onSign: z.array(Effect).default([]),
    onViolation: z.array(Effect).default([]),
    onWithdrawal: z.array(Effect).default([]),
    notes: z.string().optional(),
  })
  .strict();
export type Treaty = z.infer<typeof Treaty>;
