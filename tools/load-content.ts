import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_SCHEMAS, parseContentFiles, type ContentBundle, type ContentFile } from "../packages/engine/src/index.js";

// Node-only loader (uses fs). The engine itself never touches the file system;
// parsing and checks live in the engine's parseContentFiles.

export interface LoadResult {
  bundle: ContentBundle;
  errors: string[];
}

export function loadContent(dataDir: string): LoadResult {
  const files: ContentFile[] = [];
  const errors: string[] = [];
  for (const kind of Object.keys(CONTENT_SCHEMAS).sort()) {
    const dir = join(dataDir, kind);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const path = join(dir, file);
      try {
        files.push({ kind, file, path, json: JSON.parse(readFileSync(path, "utf8")) });
      } catch (e) {
        errors.push(`${path}: invalid JSON (${(e as Error).message})`);
      }
    }
  }
  const result = parseContentFiles(files);
  return { bundle: result.bundle, errors: [...errors, ...result.errors] };
}
