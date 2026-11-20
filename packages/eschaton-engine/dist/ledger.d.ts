import type { Ledger, Segs } from "./types.js";
export declare class LedgerError extends Error {
}
/** Join a segmented prose field back into one string. */
export declare const joinSegs: (v: Segs | string | null | undefined) => string;
/** Parse and structurally check a ledger. Throws LedgerError on anything the engine cannot use. */
export declare function parseLedger(input: string | unknown): Ledger;
/** Recompute every stored stat and bloc CBW stock. Returns a list of mismatches (empty = clean). */
export declare function verifyLedger(L: Ledger): string[];
/** SHA-256 of the exact file bytes, compared with the hash shipped beside the ledger. Works in browsers and Node 20+. */
export declare function sha256Hex(text: string): Promise<string>;
/** Fetch, hash-check, parse and verify the ledger in one call (browser or server). */
export declare function loadLedger(url: string, expectedSha?: string, fetchFn?: typeof fetch): Promise<Ledger>;
