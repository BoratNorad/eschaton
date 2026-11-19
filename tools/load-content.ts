import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_SCHEMAS, emptyBundle, type ContentBundle, type ContentKind } from "../packages/engine/src/index.js";

// Node-only loader (uses fs). The engine itself never touches the file system.

export interface LoadResult {
  bundle: ContentBundle;
  errors: string[];
}

export function loadContent(dataDir: string): LoadResult {
  const bundle = emptyBundle();
  const errors: string[] = [];
  for (const kind of Object.keys(CONTENT_SCHEMAS) as ContentKind[]) {
    const dir = join(dataDir, kind);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const path = join(dir, file);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, "utf8"));
      } catch (e) {
        errors.push(`${path}: invalid JSON (${(e as Error).message})`);
        continue;
      }
      const parsed = CONTENT_SCHEMAS[kind].safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) errors.push(`${path} at ${issue.path.join(".") || "(root)"}: ${issue.message}`);
        continue;
      }
      const expectedId = file.replace(/\.json$/, "");
      const id = (parsed.data as { id: string }).id;
      if (id !== expectedId) errors.push(`${path}: id "${id}" must match the file name "${expectedId}"`);
      (bundle[kind] as unknown[]).push(parsed.data);
    }
  }
  return { bundle, errors };
}
