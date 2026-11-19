// Helpers that keep iteration and keys stable across machines.

/** Canonical key for an unordered pair of sides: sorted, joined by "|". */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Object entries sorted by key. Use this instead of Object.entries in the engine. */
export function sortedEntries<T>(obj: Record<string, T>): Array<[string, T]> {
  return Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k] as T]);
}

/** Stable 32-bit FNV-1a hash of a JSON-serializable value, for determinism tests. */
export function hashState(value: unknown): string {
  const json = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** JSON.stringify with object keys sorted at every level. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
