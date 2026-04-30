/**
 * Counterpart to `adr-generator.js`: reads back the persisted ADRs
 * for a given plan so the coder / reviewer can pull them into their
 * prompt context. PR F of the v2.7.5 multi-step planning roadmap.
 *
 * ADRs live at `~/.kj/plans/<slug>/<planId>/adrs/<id>.md` (per
 * `adr-generator.js::writeAdrsToDisk`). On read we surface the raw
 * markdown to the caller — they decide how much of it to render.
 *
 * Returns an empty array (not an error) when the directory doesn't
 * exist: not every plan has ADRs (architect role is optional).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { plansDir } from "./plan-store.js";

/**
 * @typedef {Object} Adr
 * @property {string} id           - "0001-use-vitest"
 * @property {string} markdown     - full file contents
 */

/**
 * @param {string} projectDir
 * @param {string|null} planId  - null falls back to the "_loose" bucket
 *                                used by `kj architect` standalone
 * @returns {Promise<Adr[]>}
 */
export async function loadActiveAdrs(projectDir, planId) {
  if (!projectDir) return [];
  const slug = planId || "_loose";
  const dir = join(plansDir(projectDir), slug, "adrs");
  let files;
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return [];
    files = await readdir(dir);
  } catch {
    return [];
  }
  // Audit follow-up: was a sequential `for ... await readFile(...)`. ADRs
  // are independent files; the loop has no inter-iteration state. Parallel
  // reads cut typical 5-ADR loads from ~5 ms (sequential FS RTT) to a
  // single ~1 ms burst, and the cost grows with ADR count. Filter the
  // markdown files first so we don't fire reads against junk.
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const settled = await Promise.all(
    mdFiles.map(async (file) => {
      try {
        const md = await readFile(join(dir, file), "utf-8");
        return { id: file.replace(/\.md$/, ""), markdown: md };
      } catch { return null; /* skip unreadable file */ }
    })
  );
  const adrs = settled.filter(Boolean);
  // Numeric prefix in id ("0001-…") sorts naturally.
  adrs.sort((a, b) => a.id.localeCompare(b.id));
  return adrs;
}
