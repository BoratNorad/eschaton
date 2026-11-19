import { z } from "zod";
import { AlertLevel, CoalitionId, NonNegInt, Params, Pct, Payload, PosInt, Slug } from "./primitives.js";

// Orders are what players and AIs submit each turn. The engine is the only judge
// of legality: the server calls legalOrders() and rejects anything else.

export const InvestTrack = z.enum([
  "nuclear", "chemical", "biological", "missile",
  "cbrn_detection", "cbrn_protection", "cbrn_decontamination", "cbrn_medical", "missile_defense",
  "conventional", "intel", "stability",
]);

export const Order = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_alert"), level: AlertLevel }).strict(),
  z.object({ kind: z.literal("mobilize"), level: Pct }).strict(),
  z.object({ kind: z.literal("deploy"), fromRegion: Slug, toRegion: Slug, strength: z.number().int().min(1).max(100) }).strict(),
  z
    .object({
      kind: z.literal("signal"),
      to: Slug,
      signal: z.enum(["reassurance", "warning", "threat", "ultimatum"]),
      /** Hidden: whether the sender intends to follow through. Revealed in the replay. */
      sincere: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("propose_treaty"), treatyId: Slug, to: z.array(Slug).min(1) }).strict(),
  z.object({ kind: z.literal("sign_treaty"), treatyId: Slug }).strict(),
  z.object({ kind: z.literal("withdraw_treaty"), treatyId: Slug }).strict(),
  /** Secretly break a treaty you are party to (build, test, transfer). Detection rolls apply. */
  z.object({ kind: z.literal("covert_violation"), treatyId: Slug, activity: Slug }).strict(),
  z.object({ kind: z.literal("sanction"), target: Slug, severity: Pct }).strict(),
  z.object({ kind: z.literal("aid"), target: Slug, amount: PosInt }).strict(),
  z.object({ kind: z.literal("invest"), track: InvestTrack, amount: PosInt }).strict(),
  z.object({ kind: z.literal("intel_focus"), target: Slug }).strict(),
  z.object({ kind: z.literal("join_pipeline"), pipelineId: Slug, role: z.enum(["supplier", "recipient"]) }).strict(),
  z.object({ kind: z.literal("recruit"), target: Slug }).strict(),
  z
    .object({
      kind: z.literal("strike"),
      /** A site id or a metro id. */
      targetId: Slug,
      deliveryId: Slug,
      payload: Payload,
      count: PosInt,
    })
    .strict(),
  z.object({ kind: z.literal("propose_ceasefire"), with: z.union([CoalitionId, Slug]) }).strict(),
  z.object({ kind: z.literal("accept_ceasefire"), with: z.union([CoalitionId, Slug]) }).strict(),
  /** Activate a leader trait that has an active ability (final_warning, peace_initiative). */
  z.object({ kind: z.literal("use_trait"), traitId: Slug, params: Params.default({}) }).strict(),
]);
export type Order = z.infer<typeof Order>;

export const OrderSet = z
  .object({
    nationId: Slug,
    turn: NonNegInt,
    orders: z.array(Order).max(24),
  })
  .strict();
export type OrderSet = z.infer<typeof OrderSet>;
