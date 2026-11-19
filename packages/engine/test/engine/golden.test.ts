import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hashState } from "../../src/index.js";
import { bundle, newGame } from "../helpers.js";
import { hawk, play, quiet, type Script } from "../scripts.js";

// Golden replays: fixed seed + scripted orders -> committed hashState per turn.
// A change that moves these hashes must be intentional and noted in the commit
// message. Regenerate with:  UPDATE_GOLDEN=1 npx vitest run golden

const FILE = resolve(import.meta.dirname, "../golden/indpak_1999.json");

interface Golden {
  turns: number;
  result: unknown;
  perTurn: string[];
}

const CASES: Array<{ id: string; seed: number; scripts: Record<string, Script> }> = [
  { id: "quiet_seed1", seed: 1, scripts: { india: quiet, pakistan: quiet } },
  { id: "quiet_seed777", seed: 777, scripts: { india: quiet, pakistan: quiet } },
  { id: "hawk_seed1", seed: 1, scripts: { india: hawk, pakistan: hawk } },
  { id: "hawk_vs_quiet_seed42", seed: 42, scripts: { india: quiet, pakistan: hawk } },
];

function compute(): Record<string, Golden> {
  const out: Record<string, Golden> = {};
  for (const c of CASES) {
    const r = play(bundle, newGame(c.seed), c.scripts);
    out[c.id] = { turns: r.states.length, result: r.final.result, perTurn: r.states.map(hashState) };
  }
  return out;
}

describe("golden replays: indpak_1999", () => {
  const actual = compute();

  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(FILE, JSON.stringify(actual, null, 2) + "\n");
  // A missing file fails every case below instead of silently regenerating.
  const expected = (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}) as Record<string, Golden>;

  for (const c of CASES) {
    it(`${c.id} matches the committed hashes`, () => {
      const exp = expected[c.id];
      expect(exp, `no golden entry for ${c.id}; run with UPDATE_GOLDEN=1`).toBeDefined();
      const act = actual[c.id]!;
      // Report the first diverging turn rather than a wall of hashes.
      const firstDiff = act.perTurn.findIndex((h, i) => h !== exp!.perTurn[i]);
      expect(firstDiff, `first divergence after turn ${firstDiff}`).toBe(-1);
      expect(act.turns).toBe(exp!.turns);
      expect(act.result).toEqual(exp!.result);
    });
  }
});
