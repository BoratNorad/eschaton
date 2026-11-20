// Loading and integrity checks for eschaton_ledger.json.
import { BLOC_CBW_CAP, derive, FORMULA_VERSION } from "./derive.js";
import type { Country, DerivedStats, Ledger, Profile, Segs } from "./types.js";

export class LedgerError extends Error {}

/** Join a segmented prose field back into one string. */
export const joinSegs = (v: Segs | string | null | undefined): string =>
  v == null ? "" : Array.isArray(v) ? v.join(" ") : v;

/** Parse and structurally check a ledger. Throws LedgerError on anything the engine cannot use. */
export function parseLedger(input: string | unknown): Ledger {
  const L = (typeof input === "string" ? JSON.parse(input) : input) as Ledger;
  const fail = (m: string): never => { throw new LedgerError(m); };
  if (!L || typeof L !== "object") fail("ledger is not an object");
  if (L.meta?.formula_version !== FORMULA_VERSION)
    fail(`formula_version ${L.meta?.formula_version} does not match engine ${FORMULA_VERSION}`);
  if (!Array.isArray(L.countries) || L.countries.length !== L.meta.country_count)
    fail("country list missing or count mismatch");
  for (const p of ["PEAK", "CURRENT"] as Profile[]) {
    if (!Array.isArray(L.blocs?.[p])) fail(`blocs.${p} missing`);
    const seen = new Set<string>();
    for (const b of L.blocs[p]) for (const m of b.members) {
      if (seen.has(m)) fail(`${m} is in two ${p} blocs`);
      seen.add(m);
    }
    if (seen.size !== L.countries.length) fail(`${p} blocs do not cover every country`);
  }
  for (const c of L.countries) {
    if (!c.eschaton?.PEAK || !c.eschaton?.CURRENT || !c.eschaton?.zone) fail(`${c.id}: eschaton block incomplete`);
    const z = c.eschaton.zone;
    if (![z.x_m, z.y_m, z.radius_m].every(Number.isFinite)) fail(`${c.id}: zone geometry invalid`);
  }
  return L;
}

const STAT_KEYS: (keyof DerivedStats)[] = [
  "W", "BALLS", "REACH", "CAP_N", "CAP_B", "CAP_C", "CAP_R", "RESTRAINT",
  "RESTRAINT_points", "RESTRAINT_applicable", "SECOND_STRIKE", "CBW_TOKENS", "STAGED",
];

/** Recompute every stored stat and bloc CBW stock. Returns a list of mismatches (empty = clean). */
export function verifyLedger(L: Ledger): string[] {
  const bad: string[] = [];
  const by = new Map(L.countries.map((c) => [c.id, c] as const));
  for (const c of L.countries) for (const p of ["PEAK", "CURRENT"] as Profile[]) {
    const fresh = derive(c, p);
    for (const k of STAT_KEYS) if (fresh[k] !== c.eschaton[p][k]) bad.push(`${c.id}.${p}.${k}: stored ${c.eschaton[p][k]} vs ${fresh[k]}`);
  }
  for (const p of ["PEAK", "CURRENT"] as Profile[]) for (const b of L.blocs[p]) {
    const sum = b.members.reduce((s, m) => s + derive(by.get(m) as Country, p).CBW_TOKENS, 0);
    const stock = b.code === "NONALIGN" ? sum : Math.min(BLOC_CBW_CAP, sum);
    if (sum !== b.cbw_tokens_sum || stock !== b.cbw_stock) bad.push(`bloc ${p}.${b.code}: cbw ${b.cbw_tokens_sum}/${b.cbw_stock} vs ${sum}/${stock}`);
  }
  return bad;
}

/** SHA-256 of the exact file bytes, compared with the hash shipped beside the ledger. Works in browsers and Node 20+. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch, hash-check, parse and verify the ledger in one call (browser or server). */
export async function loadLedger(url: string, expectedSha?: string, fetchFn: typeof fetch = fetch): Promise<Ledger> {
  const res = await fetchFn(url);
  if (!res.ok) throw new LedgerError(`ledger fetch failed: ${res.status}`);
  const text = await res.text();
  if (expectedSha) {
    const got = await sha256Hex(text);
    if (got !== expectedSha.trim()) throw new LedgerError(`ledger sha256 ${got} does not match ${expectedSha.trim()}`);
  }
  const L = parseLedger(text);
  const bad = verifyLedger(L);
  if (bad.length) throw new LedgerError(`ledger stats do not recompute: ${bad.slice(0, 5).join("; ")}`);
  return L;
}
