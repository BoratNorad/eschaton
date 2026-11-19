import { writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { summarize, type BalanceReport, type GameRecord } from "../packages/ai/src/harness.js";
import { loadContent } from "./load-content.js";
import { parseOverride } from "./balance-overrides.js";

// Balance harness: AI vs AI, headless, in parallel worker threads.
//
//   npm run balance -- --games 1000
//   npm run balance -- --games 400 --set rules.quietTurnsBeforeDeescalate=4 --label quicker-calm
//
// Prints a report and writes <out>.json and <out>.md (default packages/ai/reports/<scenario>-<label>).
// Seeds are 1..games, so two runs with the same flags give identical results.

interface Args {
  games: number;
  workers: number;
  scenario: string;
  label: string;
  out?: string;
  sets: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { games: 1000, workers: Math.max(1, availableParallelism()), scenario: "indpak_1999", label: "baseline", sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = argv[++i];
    if (val === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--games") a.games = Number(val);
    else if (flag === "--workers") a.workers = Number(val);
    else if (flag === "--scenario") a.scenario = val;
    else if (flag === "--label") a.label = val;
    else if (flag === "--out") a.out = val;
    else if (flag === "--set") a.sets.push(val);
    else throw new Error(`unknown flag ${flag}`);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const overrides = args.sets.map(parseOverride);
const dataDir = resolve("data");
const { bundle, errors } = loadContent(dataDir);
if (errors.length > 0) throw new Error(errors.join("\n"));
const scenario = bundle.scenarios.find((s) => s.id === args.scenario);
if (!scenario) throw new Error(`unknown scenario ${args.scenario}`);

const seeds = Array.from({ length: args.games }, (_, i) => i + 1);
const chunks: number[][] = Array.from({ length: Math.min(args.workers, seeds.length) }, () => []);
seeds.forEach((s, i) => chunks[i % chunks.length]!.push(s));

const started = Date.now();
const records: GameRecord[] = [];
let totalMs = 0;
await Promise.all(
  chunks.map(
    (chunk) =>
      new Promise<void>((done, fail) => {
        const w = new Worker(new URL("./balance-worker.ts", import.meta.url), {
          workerData: { dataDir, scenarioId: args.scenario, seeds: chunk, overrides },
          execArgv: ["--import", "tsx"],
        });
        w.on("message", (m: { record: GameRecord; ms: number }) => {
          records.push(m.record);
          totalMs += m.ms;
          if (records.length % 50 === 0) process.stderr.write(`  ${records.length}/${args.games} games\n`);
        });
        w.on("error", fail);
        w.on("exit", (code) => (code === 0 ? done() : fail(new Error(`worker exited with ${code}`))));
      }),
  ),
);
records.sort((a, b) => a.seed - b.seed);

const report = summarize(records, scenario.maxTurns);
const md = renderMarkdown(report, args, Date.now() - started, totalMs / records.length);
const out = resolve(args.out ?? `packages/ai/reports/${args.scenario}-${args.label}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.json`, JSON.stringify({ args, report }, null, 2) + "\n");
writeFileSync(`${out}.md`, md);
console.log(md);
console.error(`wrote ${out}.md and .json`);

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function renderMarkdown(r: BalanceReport, a: Args, wallMs: number, perGameMs: number): string {
  const nations = Object.keys(r.outcomes);
  const target = r.nuclearUse < 0.15 ? "meets" : "misses";
  const lines = [
    `# Balance: ${a.scenario} (${a.label})`,
    "",
    `${r.games} AI-vs-AI games, seeds 1-${r.games}. ${a.sets.length ? `Overrides: \`${a.sets.join("`, `")}\`.` : "No overrides."}`,
    `Wall time ${(wallMs / 1000).toFixed(0)} s; ${perGameMs.toFixed(0)} ms per game per worker.`,
    "",
    `**Nuclear use: ${pct(r.nuclearUse)}** (target under 15%: ${target}).`,
    "",
    "| Measure | Value |",
    "|---|---|",
    `| Reached Conventional war (4) | ${pct(r.reachedWar)} |`,
    `| Reached WMD threshold (5) | ${pct(r.reachedLevel5)} |`,
    `| Any WMD use | ${pct(r.anyWmd)} |`,
    `| Nuclear use | ${pct(r.nuclearUse)} |`,
    ...nations.map((id) => `| First nuclear user: ${id} | ${pct(r.nuclearFirstUser[id] ?? 0)} |`),
    `| Mutual loss | ${pct(r.mutualLoss)} |`,
    `| Game length (mean / median / p10 / p90) | ${r.length.mean.toFixed(1)} / ${r.length.median} / ${r.length.p10} / ${r.length.p90} |`,
    `| Games reaching the turn limit | ${pct(r.length.fullLength)} |`,
    `| Assaults per game | ${r.meanAssaults.toFixed(1)} |`,
    `| Regions captured per game | ${r.meanCaptures.toFixed(1)} |`,
    `| Conventional strikes per game | ${r.meanConventionalStrikes.toFixed(1)} |`,
    ...Object.keys(r.triggerFireRate).map((t) => `| Trigger fired: ${t} | ${pct(r.triggerFireRate[t]!)} |`),
    "",
    "| Nation | Win | Loss | Draw | Final stability | Plan mix |",
    "|---|---|---|---|---|---|",
    ...nations.map((id) => {
      const o = r.outcomes[id]!;
      const mix = Object.entries(r.planMix[id] ?? {})
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => `${k} ${pct(v)}`)
        .join(", ");
      return `| ${id} | ${pct(o.win)} | ${pct(o.loss)} | ${pct(o.draw)} | ${r.meanFinalStability[id]!.toFixed(0)} | ${mix} |`;
    }),
    "",
    "| Ending | Share |",
    "|---|---|",
    ...Object.entries(r.endings).sort((x, y) => y[1] - x[1]).map(([k, v]) => `| ${k} | ${pct(v)} |`),
    "",
  ];
  return lines.join("\n");
}
