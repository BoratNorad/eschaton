import type { Order } from "@eschaton/engine";

// Plain-language labels for orders. Short sentences, plain words.

const TRACKS: Record<string, string> = {
  nuclear: "nuclear arsenal",
  chemical: "chemical program",
  biological: "biological program",
  missile: "missiles",
  cbrn_detection: "CBRN detection",
  cbrn_protection: "CBRN protection",
  cbrn_decontamination: "decontamination",
  cbrn_medical: "medical countermeasures",
  missile_defense: "missile defense",
  conventional: "conventional readiness",
  intel: "intelligence",
  stability: "domestic stability",
};

export interface Labeled {
  label: string;
  group: string;
  sub?: string;
}

export function describeOrder(o: Order, name: (id: string) => string): Labeled {
  switch (o.kind) {
    case "set_alert":
      return { group: "Posture", label: `Set alert level ${o.level}${o.level === 5 ? " (peacetime)" : o.level === 1 ? " (war imminent)" : ""}` };
    case "mobilize":
      return { group: "Posture", label: `Mobilize to ${o.level}%` };
    case "invest":
      return { group: "Invest", sub: TRACKS[o.track] ?? o.track, label: `Invest ${o.amount} in ${TRACKS[o.track] ?? o.track}` };
    case "intel_focus":
      return { group: "Intelligence", label: `Focus intelligence on ${name(o.target)}` };
    case "deploy":
      return {
        group: "Move forces",
        sub: `From ${name(o.fromRegion)}`,
        label: `Move ${o.strength} from ${name(o.fromRegion)} to ${name(o.toRegion)}`,
      };
    case "signal":
      return {
        group: "Signals",
        sub: `To ${name(o.to)}`,
        label: `Send ${name(o.to)} a ${o.signal} (${o.sincere ? "meant" : "bluff"})`,
      };
    case "propose_treaty":
      return { group: "Treaties", label: `Propose ${name(o.treatyId)} to ${o.to.map(name).join(", ")}` };
    case "sign_treaty":
      return { group: "Treaties", label: `Sign or ratify ${name(o.treatyId)}` };
    case "withdraw_treaty":
      return { group: "Treaties", label: `Withdraw from ${name(o.treatyId)}` };
    case "covert_violation":
      return { group: "Treaties", label: `Secretly break ${name(o.treatyId)}` };
    case "sanction":
      return { group: "Diplomacy", label: `Sanction ${name(o.target)} (severity ${o.severity})` };
    case "aid":
      return { group: "Diplomacy", label: `Send ${o.amount} aid to ${name(o.target)}` };
    case "propose_ceasefire":
      return { group: "Diplomacy", label: `Propose a ceasefire to ${name(o.with)}` };
    case "accept_ceasefire":
      return { group: "Diplomacy", label: `Accept ${name(o.with)}'s ceasefire` };
    case "join_pipeline":
      return { group: "Diplomacy", label: `Join ${name(o.pipelineId)} as ${o.role}` };
    case "recruit":
      return { group: "Diplomacy", label: `Recruit ${name(o.target)}` };
    case "use_trait":
      return { group: "Leader", label: `Use ${name(o.traitId)}` };
    case "strike":
      return {
        group: "Strikes",
        sub: name(o.targetId),
        label: `Strike ${name(o.targetId)}: ${o.count} x ${name(o.deliveryId)}, ${o.payload}`,
      };
  }
}
