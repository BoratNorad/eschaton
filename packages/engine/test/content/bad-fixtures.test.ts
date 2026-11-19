import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SCHEMAS, validateReferences, type ContentKind } from "../../src/index.js";
import { loadBundle } from "../helpers.js";

// Each file in test/fixtures/bad/ is one broken content object:
//   { description, kind, content, expect }
// It is added to the shipped content; schema parsing or reference validation
// must then report an error containing `expect`.

const DIR = resolve(import.meta.dirname, "../fixtures/bad");

interface BadFixture {
  description: string;
  kind: ContentKind;
  content: unknown;
  expect: string;
}

function errorsFor(f: BadFixture): string[] {
  const parsed = CONTENT_SCHEMAS[f.kind].safeParse(f.content);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const b = structuredClone(loadBundle());
  (b[f.kind] as unknown[]).push(parsed.data);
  return validateReferences(b);
}

describe("negative content fixtures", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const f = JSON.parse(readFileSync(join(DIR, file), "utf8")) as BadFixture;
    it(`${file}: ${f.description}`, () => {
      const errors = errorsFor(f);
      expect(errors.some((e) => e.includes(f.expect)), `errors were:\n${errors.join("\n")}`).toBe(true);
    });
  }
});
