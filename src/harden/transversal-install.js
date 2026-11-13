// ADR 0055 step 4 (KJC-TSK-1558): a marked transversal parent is not a repo, so kj harden wires
// there only the hooks (the same kj-hook guards a repo gets) into its settings.local.json. Each
// child repo keeps its own policy and gates, installed by its own kj harden.
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { HARNESS_WIRING, LOCAL_SETTINGS, mergeClaudeHooks, stripKjHooks, wiringState } from "./harness-hooks.js";
import { GOVERNING_WIRING, SENTINEL_WIRING } from "./sentinel-hooks.js";
import { listChildRepos, transversalRoot } from "./transversal.mjs";

const PARENT_WIRING = [...HARNESS_WIRING, ...SENTINEL_WIRING];
const canonical = (p) => { try { return realpathSync(p); } catch { return p; } };

/** @param {string} dir @returns {boolean} dir itself is the marked parent (not a folder below it). */
export const isTransversalParent = (dir) => transversalRoot(dir) === canonical(resolve(String(dir)));

/** Wire the parent's settings.local.json; nothing repo-only (no git, no .karajan, no exclude). */
export function installTransversalWiring({ parent, logger = console }) {
  const { wired } = mergeClaudeHooks({ projectDir: parent, logger, entries: PARENT_WIRING, moveShared: false, gitIgnore: false });
  if (wired) {
    logger.info?.(`kj harden: padre transversal, Sentinel cableado en ${join(parent, LOCAL_SETTINGS)} (solo los hooks)`);
    logger.info?.("kj harden: cada repo hijo necesita aún su propio kj harden (su política y sus gates viven en el hijo)");
  }
  return { ok: wired, transversal: true, wired };
}

/** Take kj's hook entries out of the parent's settings.local.json, leaving the user's. */
export function uninstallTransversalWiring({ parent, logger = console }) {
  const removed = stripKjHooks(join(parent, LOCAL_SETTINGS), PARENT_WIRING);
  logger.info?.(removed ? `kj harden: hooks de kj retirados de ${join(parent, LOCAL_SETTINGS)}` : "kj harden: el padre no tenía hooks de kj");
  return { ok: true, transversal: true, removed };
}

const governed = (dir, mainOf) => wiringState({ projectDir: dir, entries: GOVERNING_WIRING, ...(mainOf ? { mainOf } : {}) }).missing.length === 0;

/** For kj doctor: the parent's wiring and each child repo's; null when dir is not a marked parent. */
export function transversalWiringReport(dir) {
  if (!isTransversalParent(dir)) return null;
  const parent = canonical(resolve(String(dir)));
  const children = listChildRepos(parent).map((repo) => ({ repo, wired: governed(repo) }));
  return { parent, wired: governed(parent, () => null), children };
}
