import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { WorldMap, pairKey } from "../packages/engine/src/index.js";

// Fills each map's greatCircleKm table from region centroids. Floats are fine
// HERE (build time); the engine only ever reads the rounded integers.
// Usage: npm run build:distances

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

function haversineKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R_KM * Math.asin(Math.sqrt(a)));
}

const dir = resolve(process.argv[2] ?? "data/maps");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(dir, file);
  const map = WorldMap.parse(JSON.parse(readFileSync(path, "utf8")));
  const table: Record<string, number> = {};
  const regions = [...map.regions].sort((x, y) => (x.id < y.id ? -1 : 1));
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i]!;
      const b = regions[j]!;
      table[pairKey(a.id, b.id)] = haversineKm(a.displayCentroid, b.displayCentroid);
    }
  const out = { ...map, greatCircleKm: table };
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(`${file}: ${Object.keys(table).length} distances`);
}
