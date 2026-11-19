import { parentPort, workerData } from "node:worker_threads";
import { resolve } from "node:path";
import { RULES } from "../packages/engine/src/index.js";
import { playGame } from "../packages/ai/src/harness.js";
import { loadContent } from "./load-content.js";
import { applyOverrides, type Override } from "./balance-overrides.js";

// One harness worker: plays the seeds it is given and posts back records.
// Overrides (what-if experiments) apply only inside this process.

interface Job {
  dataDir: string;
  scenarioId: string;
  seeds: number[];
  overrides: Override[];
}

const job = workerData as Job;
const { bundle, errors } = loadContent(resolve(job.dataDir));
if (errors.length > 0) throw new Error(errors.join("\n"));
applyOverrides(job.overrides, bundle, RULES as unknown as Record<string, unknown>);
const scenario = bundle.scenarios.find((s) => s.id === job.scenarioId);
if (!scenario) throw new Error(`unknown scenario ${job.scenarioId}`);

for (const seed of job.seeds) {
  const t0 = Date.now();
  const record = playGame(bundle, scenario, seed);
  parentPort!.postMessage({ record, ms: Date.now() - t0 });
}
