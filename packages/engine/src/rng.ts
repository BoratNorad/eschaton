import type { RngState } from "./schema/state.js";

// sfc32: small, fast, and identical on every JS engine because it uses only
// 32-bit integer operations. This is the ONLY source of randomness in the engine.
// Functions mutate the RngState in place; call them only on the draft state
// inside resolveTurn/createGame, never on a state you were handed.

export function seedRng(seed: number): RngState {
  const r: RngState = { a: 0x9e3779b9, b: 0x243f6a88, c: 0xb7e15162, d: seed >>> 0 };
  for (let i = 0; i < 15; i++) nextU32(r); // warm up
  return r;
}

export function nextU32(r: RngState): number {
  const t = (((r.a + r.b) >>> 0) + r.d) >>> 0;
  r.d = (r.d + 1) >>> 0;
  r.a = (r.b ^ (r.b >>> 9)) >>> 0;
  r.b = (r.c + (r.c << 3)) >>> 0;
  r.c = ((r.c << 21) | (r.c >>> 11)) >>> 0;
  r.c = (r.c + t) >>> 0;
  return t;
}

/** Uniform integer in [0, n). n must be a positive integer <= 2^21. */
export function nextInt(r: RngState, n: number): number {
  // x * n < 2^53, so the product is exact; dividing by 2^32 is exact too.
  return Math.floor((nextU32(r) * n) / 4294967296);
}

/** True with probability bp / 10000. Always consumes exactly one draw. */
export function rollBp(r: RngState, bp: number): boolean {
  return nextInt(r, 10_000) < bp;
}

/** 1d10. */
export function rollD10(r: RngState): number {
  return nextInt(r, 10) + 1;
}
