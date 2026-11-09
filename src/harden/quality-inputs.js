/**
 * quality-inputs — what the JS Quality workflow assumes about the repo
 * (KJC-BUG-0529, issue #3661): the Node version and the test script.
 * Decided here from the files; the template only renders what it is given.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VERSION_LITERAL = /^[0-9][0-9.x]*$/;
const NODE_VERSION_LINE = /^\s*node-version:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm;

function readPackageJson(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

// node-version values the repo's own workflows use, kj's managed ones skipped.
function workflowVersions(projectDir) {
  const dir = join(projectDir, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith("kj-"))
    .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(NODE_VERSION_LINE)].map((m) => m[1]));
}

/** `{ file }` | `{ version }` for setup-node, or null when nothing usable is found. */
export function detectNodeVersion({ projectDir, appDir, root = "." }) {
  const prefix = root === "." || root === "" ? "" : `${root}/`;
  const pkg = readPackageJson(appDir);
  const file = [".nvmrc", ".node-version"].find((name) => existsSync(join(appDir, name)))
    ?? (pkg?.engines?.node ? "package.json" : null);
  if (file) return { file: `${prefix}${file}` };
  const found = new Set(workflowVersions(projectDir));
  const [only] = found;
  return found.size === 1 && VERSION_LITERAL.test(only) ? { version: only } : null;
}

/** "test" | "test:unit" | null, from the scripts of package.json. */
export function detectTestScript(appDir) {
  const pkg = readPackageJson(appDir);
  if (!pkg) return "test"; // no package.json yet (fresh repo): today's behavior
  const scripts = pkg.scripts;
  return ["test", "test:unit"].find((name) => scripts?.[name]) ?? null;
}

/** The inputs for qualityWorkflowFor's options plus the notes naming what kj assumed. */
export function qualityInputs({ projectDir, appDir, root }) {
  const nodeVersion = detectNodeVersion({ projectDir, appDir, root });
  const testScript = detectTestScript(appDir);
  const notes = [];
  if (!nodeVersion) notes.push("kj-quality: no Node version found in .nvmrc, .node-version, engines or your workflows; using 22");
  if (!testScript) notes.push("kj-quality: no test or test:unit script; the workflow runs no tests");
  return { options: { nodeVersion, testScript }, note: notes.join("; ") };
}
