/**
 * Install from a catalog (ADR 0021, decision 12; plan step 11c): `atril install kind:name`
 * takes an available artifact into the store, through the same validated install as a local
 * path. A fetched source's artifact comes from its pinned commit in the cache. An OpenSkills
 * skill declares no kind; the store needs one, so the installed SKILL.md gets `kind: skill`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { availableArtifacts } from "./catalog.js";
import { keyOf, scan } from "./scan.js";
import { install } from "./store.js";

const BOM = String.fromCodePoint(0xfeff);

/** A catalog reference, as opposed to a local path. */
export const isCatalogRef = (ref) => /^(skill|command|agent):[a-z0-9][a-z0-9._-]*$/.test(ref);

/**
 * @param {string} ref kind:name of an available artifact
 * @param {{ projectDir?: string, root?: string, userRoot?: string, env?: object }} [opts]
 * @returns {{ kind: string, name: string, path: string, status: string, catalog: string }}
 */
export function installFromCatalog(ref, opts = {}) {
  const artifact = availableArtifacts(opts).find((candidate) => keyOf(candidate) === ref);
  if (!artifact) {
    const held = scan(opts).artifacts.some((candidate) => keyOf(candidate) === ref);
    throw new Error(held ? `${ref} is already installed` : `${ref} is not in any catalog (atril catalog sync fetches the git sources)`);
  }
  const source = artifact.kind === "skill" ? dirname(artifact.path) : artifact.path;
  if (!artifact.kindDefaulted) return { ...install(source, { ...opts, kind: artifact.kind }), catalog: artifact.catalog };
  const stage = mkdtempSync(join(tmpdir(), "atril-install-"));
  try {
    const folder = join(stage, basename(source));
    cpSync(source, folder, { recursive: true });
    const file = join(folder, "SKILL.md");
    const text = readFileSync(file, "utf8");
    const bom = text.startsWith(BOM) ? BOM : "";
    writeFileSync(file, bom + text.slice(bom.length).replace(/^(---(\r?\n))/, "$1kind: skill$2"));
    return { ...install(folder, { ...opts, kind: "skill" }), catalog: artifact.catalog };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
