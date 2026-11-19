import { emitEvent } from "../../logic/events.js";
import { clamp } from "../../logic/values.js";
import { RULES } from "../rules.js";
import { activeNations, ordersOf, type Turn } from "../turn.js";

// Step 3. Alerts, mobilization, investment, intel focus; then readiness drift.

export function resolvePosture(t: Turn): void {
  const { state } = t;

  for (const { nationId, order } of ordersOf(t, "set_alert")) {
    const n = state.nations[nationId]!;
    if (n.alert === order.level) continue;
    const from = n.alert;
    n.alert = order.level;
    // Alert posture is observable: rivals see it in their view.
    emitEvent(state, {
      type: "alert_changed", visibility: "public", actor: nationId,
      text: `${nationId} moves to alert level ${order.level}.`, data: { from, to: order.level },
    });
  }

  for (const { nationId, order } of ordersOf(t, "mobilize")) {
    const n = state.nations[nationId]!;
    const step = clamp(order.level - n.mobilization, -RULES.mobilizationStep, RULES.mobilizationStep);
    n.mobilization += step;
  }

  for (const { nationId, order } of ordersOf(t, "invest")) {
    const n = state.nations[nationId]!;
    const a = order.amount;
    switch (order.track) {
      case "nuclear":
        n.nuclear.progressBp = Math.min(10_000, n.nuclear.progressBp + a * 100);
        break;
      case "conventional":
        n.readiness = Math.min(100, n.readiness + a * 2);
        break;
      case "stability":
        n.stability = Math.min(100, n.stability + Math.floor(a / 2));
        break;
      case "cbrn_detection":
        n.cbrn.detection = Math.min(100, n.cbrn.detection + a);
        break;
      case "cbrn_protection":
        n.cbrn.protection = Math.min(100, n.cbrn.protection + a);
        break;
      case "cbrn_decontamination":
        n.cbrn.decontamination = Math.min(100, n.cbrn.decontamination + a);
        break;
      case "cbrn_medical":
        n.cbrn.medical = Math.min(100, n.cbrn.medical + a);
        break;
      case "missile_defense":
        n.cbrn.missileDefense = Math.min(100, n.cbrn.missileDefense + a);
        break;
      default:
        break; // rejected in step 1
    }
  }

  for (const { nationId, order } of ordersOf(t, "intel_focus")) t.intelFocus.set(nationId, order.target);

  // Readiness drifts toward the level its alert implies: alert 5 -> 20 ... alert 1 -> 100.
  for (const [, n] of activeNations(state)) {
    const target = 20 + (5 - n.alert) * 20;
    n.readiness += clamp(target - n.readiness, -RULES.readinessStep, RULES.readinessStep);
  }
}
