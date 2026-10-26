/**
 * Install from a catalog (ADR 0021, decision 12; plan step 11c): `atril install kind:name`
 * takes an available artifact into the store, through the same validated install as a local
 * path. A fetched source's artifact comes from its pinned commit in the cache. An OpenSkills
 * skill declares no kind; the store needs one, so the installed SKILL.md gets `kind: skill`.
 */
import { cpSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (artifact.kind === "skill") return { ...installSkillFolder(dirname(artifact.path), opts, artifact.kindDefaulted), catalog: artifact.catalog };
  return { ...install(artifact.path, { ...opts, kind: artifact.kind }), catalog: artifact.catalog };
}

/**
 * A skill folder that is a symlink, or holds one, is refused without following any link: run
 * before reading, copying or rewriting anything in it, a link could reach outside the folder.
 */
export function refuseLinks(source) {
  if (lstatSync(source).isSymbolicLink()) throw new Error(`${source}: an artifact may not be a symlink`);
  const link = readdirSync(source, { recursive: true, withFileTypes: true }).find((entry) => entry.isSymbolicLink());
  if (link) throw new Error(`${join(link.parentPath, link.name)}: a skill may not hold symlinks`);
}

/**
 * Install a skill folder. One whose SKILL.md declares no kind (OpenSkills' format) is copied to
 * a temporary folder whose SKILL.md gets `kind: skill` first, because the store needs a kind.
 * @param {string} source the skill folder
 * @param {object} opts install()'s options
 * @param {boolean} [kindDefaulted] the SKILL.md declares no kind
 */
export function installSkillFolder(source, opts, kindDefaulted = false) {
  refuseLinks(source);
  if (!kindDefaulted) return install(source, { ...opts, kind: "skill" });
  const stage = mkdtempSync(join(tmpdir(), "atril-install-"));
  try {
    const folder = join(stage, basename(source));
    cpSync(source, folder, { recursive: true });
    const file = join(folder, "SKILL.md");
    const text = readFileSync(file, "utf8");
    const bom = text.startsWith(BOM) ? BOM : "";
    writeFileSync(file, bom + text.slice(bom.length).replace(/^(---(\r?\n))/, "$1kind: skill$2"));
    return install(folder, { ...opts, kind: "skill" });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
