import { describe, expect, it } from "vitest";
import { validateReferences, type ContentBundle } from "../../src/index.js";
import { loadBundle } from "../helpers.js";

function mutated(fn: (b: ContentBundle) => void): string[] {
  const b = structuredClone(loadBundle());
  fn(b);
  return validateReferences(b);
}

describe("binding validation", () => {
  it("shipped content is clean", () => {
    expect(validateReferences(loadBundle())).toEqual([]);
  });

  it("rejects $target in a treaty hook (only $actor is bound)", () => {
    const errors = mutated((b) => {
      b.treaties.find((t) => t.id === "lahore_declaration")!.onViolation.push({
        kind: "stability_shock", nation: "$target", amount: -5,
      });
    });
    expect(errors).toEqual(["treaty lahore_declaration: uses $target, but only $actor bound here"]);
  });

  it("rejects a trigger binding it does not declare, including inside stat_roll and *_side refs", () => {
    const errors = mutated((b) => {
      const t = b.triggers.find((x) => x.id === "parliament_attack")!;
      t.bindings = { actor: "pakistan" };
      t.effects.push({
        kind: "stat_roll", nation: "india", stat: "esc", difficulty: 5,
        onPass: [{ kind: "add_pressure", pair: ["$self_side", "india"], points: 5 }], onFail: [],
      });
    });
    expect(errors).toEqual([
      "trigger parliament_attack: uses $self, but only $actor bound here",
      "trigger parliament_attack: uses $target, but only $actor bound here",
    ]);
  });

  it("rejects bindings in victory conditions and accepts $self in objectives", () => {
    const errors = mutated((b) => {
      b.scenarios[0]!.victory[0]!.when = { kind: "metric_at_least", nation: "$self", metric: "stability", value: 1 };
    });
    expect(errors).toEqual(["scenario indpak_1999 victory mutual_catastrophe: uses $self, but nothing is bound here"]);
  });
});
