import { parseContentFiles, validateReferences, type ContentBundle, type ContentFile } from "@eschaton/engine";

// Bundles every /data JSON file into the worker at build time. Content is
// validated here too, so a bad build fails loudly instead of misbehaving.

const modules = import.meta.glob("../../../../data/**/*.json", { eager: true, import: "default" });

export function loadBundledContent(): ContentBundle {
  const files: ContentFile[] = Object.entries(modules).map(([path, json]) => {
    const parts = path.split("/");
    return { kind: parts[parts.length - 2]!, file: parts[parts.length - 1]!, json, path };
  });
  const { bundle, errors } = parseContentFiles(files);
  const all = errors.length > 0 ? errors : validateReferences(bundle);
  if (all.length > 0) throw new Error(`content is invalid:\n${all.join("\n")}`);
  return bundle;
}
