/**
 * KJC-TSK-1255: kj audit --sbom <file>. The CycloneDX SBOM of an npm project's production
 * dependencies, as npm itself builds it from the lockfile (no node_modules needed). Written
 * atomically: a failed run leaves no file, never a half one.
 */
import { existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runGoverned } from "../utils/tool-governor.js";

const TIMEOUT_MS = 60_000;
const firstLine = (text) => String(text ?? "").trim().split("\n")[0];

/** @returns {Promise<{file: string, components: number}>} */
export async function writeSbom({ projectDir, file, run = runGoverned }) {
  if (!existsSync(join(projectDir, "package-lock.json"))) {
    throw new Error("--sbom needs an npm project with package-lock.json; other ecosystems are not covered yet");
  }
  let stdout;
  try {
    ({ stdout } = await run("npm", ["sbom", "--sbom-format", "cyclonedx", "--omit", "dev", "--package-lock-only"], { cwd: projectDir, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    let why = firstLine(err.stderr) || err.message;
    if (err.code === "ENOENT") why = "npm not found in PATH";
    else if (err.killed) why = `timed out after ${TIMEOUT_MS}ms`;
    throw new Error(`npm sbom failed: ${why}`, { cause: err });
  }
  let doc;
  try { doc = JSON.parse(stdout); } catch { doc = null; }
  if (doc?.bomFormat !== "CycloneDX") throw new Error("npm sbom output is not a CycloneDX document");
  const target = resolve(projectDir, file);
  await writeFile(`${target}.tmp`, stdout);
  await rename(`${target}.tmp`, target);
  return { file: target, components: Array.isArray(doc.components) ? doc.components.length : 0 };
}
