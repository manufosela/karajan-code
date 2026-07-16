import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSea, getAsset } from "node:sea";
import { getKarajanHome } from "./paths.js";

// npm install / source tree: the real templates/ directory next to src/.
const SOURCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

const INDEX_ASSET = "templates-index.json";

/**
 * Root directory of the built-in templates (KJC-BUG-0104).
 *
 * The SEA binary ships only the JS bundle — templates/ never travels as
 * files, and `import.meta.dirname`-relative resolution lands on the
 * binary's own directory (e.g. `$HOME/templates/skills` → ENOENT). In SEA
 * builds the templates travel as SEA assets (see scripts/build-sea.mjs);
 * they are extracted once per version into ~/.karajan/embedded-templates/
 * and served from there, so every fs-based consumer keeps working.
 */
export function getTemplatesRoot() {
  if (!isSeaRuntime()) return SOURCE_ROOT;
  const index = JSON.parse(getAsset(INDEX_ASSET, "utf8"));
  const destRoot = path.join(getKarajanHome(), "embedded-templates", index.version);
  return extractEmbeddedTemplates({
    destRoot,
    files: index.files,
    readAsset: (rel) => getAsset(`templates/${rel}`, "utf8"),
  });
}

function isSeaRuntime() {
  try {
    return isSea();
  } catch {
    // isSea() unexpectedly threw ⇒ treat as npm / source tree, never block.
    return false;
  }
}

/**
 * Extract the embedded template files into destRoot (idempotent: a
 * .complete marker skips re-extraction). Exported for unit testing.
 */
export function extractEmbeddedTemplates({ destRoot, files, readAsset }) {
  const marker = path.join(destRoot, ".complete");
  if (fs.existsSync(marker)) return destRoot;
  for (const rel of files) {
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, readAsset(rel));
  }
  fs.writeFileSync(marker, "");
  return destRoot;
}
