import { CONTENT_SCHEMAS, emptyBundle, type ContentBundle, type ContentKind } from "./bundle.js";

// Pure content assembly: takes already-read JSON files and builds a bundle.
// Node tools read files with fs; the browser client imports them through the
// bundler. Both end here, so both apply the same rules.

export interface ContentFile {
  /** Folder name under /data, e.g. "nations". */
  kind: string;
  /** File name, e.g. "india.json". */
  file: string;
  /** Parsed JSON, or a string that failed to parse (reported as invalid JSON). */
  json: unknown;
  /** For messages; defaults to kind/file. */
  path?: string;
}

export interface ParseResult {
  bundle: ContentBundle;
  errors: string[];
}

const KINDS = Object.keys(CONTENT_SCHEMAS) as ContentKind[];

function isKind(k: string): k is ContentKind {
  return (KINDS as string[]).includes(k);
}

/** Files are processed in (kind, file) order regardless of input order. */
export function parseContentFiles(files: readonly ContentFile[]): ParseResult {
  const bundle = emptyBundle();
  const errors: string[] = [];
  const sorted = [...files].sort((a, b) =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
  );
  for (const f of sorted) {
    const path = f.path ?? `${f.kind}/${f.file}`;
    if (!isKind(f.kind)) {
      errors.push(`${path}: unknown content folder "${f.kind}"`);
      continue;
    }
    const parsed = CONTENT_SCHEMAS[f.kind].safeParse(f.json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${path} at ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      continue;
    }
    const expectedId = f.file.replace(/\.json$/, "");
    const id = (parsed.data as { id: string }).id;
    if (id !== expectedId) errors.push(`${path}: id "${id}" must match the file name "${expectedId}"`);
    (bundle[f.kind] as unknown[]).push(parsed.data);
  }
  return { bundle, errors };
}
