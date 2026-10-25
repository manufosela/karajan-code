/**
 * atril sync (ADR 0021, decision 11; plan step 9b): write the persistent pieces into `.rulesync/`
 * through the ownership ledger of ADR 0022. Every piece is judged before anything is written, so
 * a hand edit, a user's file or another writer's entry stops the whole sync with nothing changed.
 * A piece no longer wanted is removed when it is still as atril wrote it.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { MARKER, persistentPieces } from "./bridge.js";
import { hashContent, OWNER, withLedger } from "./ledger.js";

const RULESYNC = ".rulesync";
// A key atril writes: a whole file under one of rulesync's kind folders, never `..` nor a block.
const OWN_KEY = /^(commands|rules|skills|subagents)\/[^#]+$/;
const ownKey = (key) => OWN_KEY.test(key) && !key.split("/").some((part) => part === "" || part === "." || part === "..");

/** What happens to one key; throws on anything atril must not touch. */
function judge(key, entry, current, wanted) {
  const file = join(RULESYNC, key);
  if (!ownKey(key)) throw new Error(`"${key}" is not a path atril writes; fix .rulesync/.owners.json`);
  if (entry && entry.owner !== OWNER) throw new Error(`${file}: belongs to ${entry.owner}; atril will not touch it`);
  // Already gone and no longer wanted: only its entry is left to drop.
  if (entry && current === null && wanted === undefined) return "removed";
  if (entry && (current === null || hashContent(current) !== entry.hash)) {
    throw new Error(`${file}: edited by hand (or deleted) since atril wrote it; atril will not overwrite it. `
      + "Restore it as it was, or move your change into atril's store");
  }
  if (!entry && current !== null && !current.includes(MARKER)) {
    throw new Error(`${file}: not written by atril; atril will not write over it`);
  }
  if (wanted === undefined) return "removed";
  if (!entry) return current === null ? "written" : "claimed";
  return current === wanted ? "unchanged" : "written";
}

const readOrNull = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);

// A symlink anywhere below .rulesync/ would carry a write outside it: refused before any write.
function refuseSymlinks(projectDir, key) {
  let at = join(projectDir, RULESYNC);
  for (const part of key.split("/")) {
    at = join(at, part);
    if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`${join(RULESYNC, key)}: ${at} is a symlink; atril writes only inside .rulesync/`);
    }
  }
}

/** Every step of a sync, judged and nothing written. */
export function plan(projectDir, ledger, wanted) {
  const stale = Object.entries(ledger.entries).filter(([key, { owner }]) => owner === OWNER && !wanted.has(key));
  return [...wanted.keys(), ...stale.map(([key]) => key)].map((key) => {
    if (ownKey(key)) refuseSymlinks(projectDir, key);
    const current = readOrNull(join(projectDir, RULESYNC, key));
    return { path: key, action: judge(key, ledger.entries[key], current, wanted.get(key)) };
  });
}

// After removing a skill's file, its folders go too while empty, up to the kind folder.
function pruneEmpty(start, stop) {
  for (let at = start; at !== stop && existsSync(at) && readdirSync(at).length === 0; at = dirname(at)) rmdirSync(at);
}

/**
 * @param {{ projectDir?: string, root?: string, userRoot?: string, env?: object }} [opts]
 * @returns {{ path: string, action: "written"|"claimed"|"removed"|"unchanged" }[]}
 */
export function sync(opts = {}) {
  const projectDir = opts.projectDir ?? process.cwd();
  if (!existsSync(join(projectDir, RULESYNC))) {
    throw new Error(`${projectDir}: no .rulesync/; atril installs nothing persistent without rulesync (run rulesync init)`);
  }
  const wanted = new Map(persistentPieces({ ...opts, projectDir }).map(({ path, content }) => [path, content]));
  let steps;
  withLedger(projectDir, (ledger) => {
    steps = plan(projectDir, ledger, wanted);
    for (const { path, action } of steps) {
      const target = join(projectDir, RULESYNC, path);
      if (action === "removed") {
        rmSync(target, { force: true });
        pruneEmpty(dirname(target), join(projectDir, RULESYNC, path.split("/")[0]));
        delete ledger.entries[path];
      } else if (action !== "unchanged") {
        mkdirSync(dirname(target), { recursive: true });
        writeAtomic(target, wanted.get(path));
        ledger.entries[path] = { owner: OWNER, hash: hashContent(wanted.get(path)) };
      }
    }
  });
  return steps;
}
