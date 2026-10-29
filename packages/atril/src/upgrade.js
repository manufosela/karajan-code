/** Updates of installed artifacts (ADR 0021, decision 12; step 10c): `catalog update` moves pins, this moves the copies. */
import { dirname, resolve } from "node:path";
import { catalogArtifacts } from "./catalog.js";
import { installArtifact } from "./catalog-install.js";
import { contentHash, readLock } from "./lock.js";
import { keyOf, resolveRoot, scanStore } from "./scan.js";
import { status } from "./status.js";
import { diffOf } from "./update.js";

const folderOf = ({ kind, path }) => (kind === "skill" ? dirname(path) : path);

/** Every lock entry installed from a catalog, with what that catalog offers for it. */
function candidates(opts) {
  const { projectDir = process.cwd(), env = process.env } = opts;
  const byKey = (artifacts) => new Map(artifacts.map((artifact) => [keyOf(artifact), artifact]));
  const held = byKey(scanStore(resolve(projectDir, resolveRoot({ root: opts.root, env }))));
  const offered = byKey(catalogArtifacts(opts));
  const states = new Map(status(opts).map(({ kind, name, state }) => [`${kind}:${name}`, state]));
  return Object.entries(readLock(opts).artifacts)
    .filter(([key, entry]) => entry.origin === "catalog" && states.get(key) !== "missing")
    .map(([key, entry]) => {
      const [kind, name] = key.split(":");
      const listed = offered.get(key);
      // A name another catalog or source now offers first is not this artifact's origin.
      const artifact = listed?.catalog === entry.catalog && listed.pin?.source === entry.source ? listed : undefined;
      const base = { kind, name, catalog: entry.catalog };
      if (!artifact) return { update: { ...base, state: "unavailable" } };
      const folder = folderOf(artifact);
      if (contentHash(folder, kind, { defaultKind: artifact.kindDefaulted ? "skill" : undefined }) === entry.hash) return { update: { ...base, state: "current" }, artifact };
      const state = states.get(key) === "edited" ? "edited" : "outdated";
      const pinned = entry.commit && artifact.pin && { from: entry.commit, to: artifact.pin.commit };
      return { update: { ...base, state, ...pinned, diff: diffOf(projectDir, folderOf(held.get(key)), folder) }, artifact };
    });
}

/** @returns {{ kind: string, name: string, state: "current" | "outdated" | "edited" | "unavailable", catalog: string, from?: string, to?: string, diff?: string }[]} */
export const installedUpdates = (opts = {}) => candidates(opts).map(({ update }) => update);

/** Reinstall `kind:name` from its catalog, replacing the copy atomically; an edited copy is kept unless `discardEdits`. */
export function applyInstalledUpdate(ref, opts = {}, { discardEdits = false } = {}) {
  const found = candidates(opts).find(({ update }) => `${update.kind}:${update.name}` === ref);
  if (!found) throw new Error(`${ref} has no catalog origin in the lock; nothing to update from`);
  const { update, artifact } = found;
  if (update.state === "unavailable") throw new Error(`${ref} is not offered by its catalog now (atril catalog sync fetches the git sources)`);
  if (update.state === "current") return { kind: update.kind, name: update.name, status: "unchanged" };
  if (update.state === "edited" && !discardEdits) throw new Error(`${ref} was edited locally; pass --discard-edits to overwrite it`);
  return installArtifact(artifact, { ...opts, replace: true });
}
