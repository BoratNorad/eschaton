import type { ContentBundle } from "../packages/engine/src/index.js";

// What-if overrides for the balance harness, e.g.
//   --set rules.quietTurnsBeforeDeescalate=4
//   --set triggers.kargil_infiltration.chanceBp=150
//   --set leaders.musharraf.stats.esc=5
// They patch the in-memory copy inside a harness worker only: nothing in the
// repo changes, and the engine's own code is untouched. Values must be integers
// (the engine's rule) or true/false.

export interface Override {
  path: string[];
  value: number | boolean;
}

export function parseOverride(spec: string): Override {
  const eq = spec.indexOf("=");
  if (eq < 0) throw new Error(`--set needs path=value, got "${spec}"`);
  const raw = spec.slice(eq + 1);
  const value = raw === "true" ? true : raw === "false" ? false : Number(raw);
  if (typeof value === "number" && !Number.isInteger(value)) throw new Error(`--set ${spec}: values must be integers`);
  return { path: spec.slice(0, eq).split("."), value };
}

export function applyOverrides(overrides: readonly Override[], bundle: ContentBundle, rules: Record<string, unknown>): void {
  for (const o of overrides) {
    const [root, ...rest] = o.path;
    let target: unknown;
    let path = rest;
    if (root === "rules") target = rules;
    else if (root !== undefined && root in bundle) {
      // Content: the first segment after the kind is an object id.
      const [id, ...more] = rest;
      target = (bundle[root as keyof ContentBundle] as Array<{ id: string }>).find((x) => x.id === id);
      if (target === undefined) throw new Error(`--set ${o.path.join(".")}: no ${root} with id "${id}"`);
      path = more;
    } else throw new Error(`--set ${o.path.join(".")}: must start with rules or a content kind`);
    setPath(target, path, o.value, o.path.join("."));
  }
}

function setPath(obj: unknown, path: string[], value: number | boolean, label: string): void {
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]!];
    if (next === null || typeof next !== "object") throw new Error(`--set ${label}: "${path[i]}" is not an object`);
    cur = next as Record<string, unknown>;
  }
  const key = path[path.length - 1];
  if (key === undefined || !(key in cur)) throw new Error(`--set ${label}: unknown field "${key}"`);
  if (typeof cur[key] !== typeof value) throw new Error(`--set ${label}: expected a ${typeof cur[key]}`);
  cur[key] = value;
}
