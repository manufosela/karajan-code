/**
 * Gate trackability (KJC-TSK-0646) — a `.karajan/` dir-exclude in
 * .gitignore silently keeps the v4 contract (review-gate marker, hooks)
 * out of git: git cannot re-include children of an excluded DIRECTORY.
 * Reproduced three times in the field before this existed.
 *
 * `kj review --install-gate` calls this: when the exact `.karajan/`
 * (or `.karajan/*`) exclude is present, it is rewritten to the
 * star-pattern with re-includes for the contract, keeping everything
 * else in the file byte-identical. No mention of .karajan → no-op.
 */
import fs from "node:fs/promises";
import path from "node:path";

// KJC-BUG-0123 (issue #1268): exported as the SINGLE source of truth — kj
// init and the orchestrator's autoInit write this same block instead of a
// bare `.karajan/` exclude (which git cannot re-include children of).
export const CONTRACT_BLOCK = [
  ".karajan/*",
  "# …except the v4 environment contract, which the whole team inherits:",
  "!.karajan/review-gate",
  "!.karajan/hooks/",
  ".karajan/hooks/*",
  "!.karajan/hooks/pre-commit",
  "!.karajan/hooks/commit-msg",
  "!.karajan/hooks/pre-push",
  "!.karajan/hooks/post-merge",
  "!.karajan/hooks/prepare-commit-msg",
  "!.karajan/adrs/",
  // ADR 0009 (KJC-BUG-0161): la procedencia del supervisor VIAJA con el
  // repo — es lo que CI verifica. Cazado en el primer harden --commit real.
  "!.karajan/supervisor-provenance.json",
];

/**
 * KJC-BUG-0123: append the canonical contract block to .gitignore when the
 * file has no `.karajan` mention at all (fresh projects — `kj init` path).
 * Files that already mention .karajan are left to ensureGateTrackable,
 * which rewrites legacy root excludes without touching anything else.
 */
export async function ensureContractBlockPresent(projectDir) {
  const file = path.join(projectDir, ".gitignore");
  let text = "";
  try { text = (await fs.readFile(file, "utf8")) || ""; } catch { /* no .gitignore yet */ }
  if (text.includes(".karajan")) return { changed: false };
  const sep = text && !text.endsWith("\n") ? "\n" : "";
  await fs.writeFile(file, `${text}${sep}# Karajan environment (verdicts stay local; the contract is tracked)\n${CONTRACT_BLOCK.join("\n")}\n`);
  return { changed: true };
}

export async function ensureGateTrackable(projectDir) {
  const file = path.join(projectDir, ".gitignore");
  let text;
  try { text = await fs.readFile(file, "utf8"); } catch { return { changed: false }; }

  // Already migrated only when EVERY re-include of the contract is present —
  // a partial state (e.g. a hand-written marker re-include without the hook
  // ones) must still be completed, not silently accepted.
  const reIncludes = CONTRACT_BLOCK.filter((l) => l.startsWith("!"));
  if (reIncludes.every((l) => text.includes(l))) return { changed: false };

  const isRootExclude = (l) => {
    const t = l.trim();
    return t === ".karajan/" || t === ".karajan" || t === ".karajan/*";
  };
  const lines = text.split("\n");
  const idx = lines.findIndex(isRootExclude);
  if (idx === -1) return { changed: false };

  // Drop EVERY .karajan root exclude (a later duplicate would override the
  // re-includes — last match wins in gitignore) and every pre-existing
  // partial contract line, then insert the canonical block once at the
  // position of the first exclude. Exactly one coherent block, idempotent.
  const partials = new Set(CONTRACT_BLOCK);
  const marker = "@@kj-contract-block@@";
  const cleaned = lines.map((l, i) => (i === idx ? marker : l))
    .filter((l) => l === marker || (!isRootExclude(l) && !partials.has(l.trim())));
  const result = cleaned.flatMap((l) => (l === marker ? CONTRACT_BLOCK : [l]));
  await fs.writeFile(file, result.join("\n"));
  return { changed: true };
}
