import { resolve } from "node:path";
import { validateReferences } from "../packages/engine/src/index.js";
import { loadContent } from "./load-content.js";

// Usage: npm run validate   (exits 1 on any error)
const dataDir = resolve(process.argv[2] ?? "data");
const { bundle, errors } = loadContent(dataDir);
const refErrors = errors.length === 0 ? validateReferences(bundle) : [];
const all = [...errors, ...refErrors];

const counts = Object.entries(bundle).map(([k, v]) => `${k}: ${v.length}`).join(", ");
if (all.length > 0) {
  console.error(`Content INVALID (${all.length} error${all.length === 1 ? "" : "s"})`);
  for (const e of all) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Content OK (${counts})`);
