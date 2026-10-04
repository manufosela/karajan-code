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

import { runCommand } from "../utils/process.js";

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
  // ADR 0016 (KJC-TSK-0947): the rules of the MD files compiled into gates are
  // governance the whole team inherits, like the hooks.
  "!.karajan/rules.yml",
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

/**
 * KJC-BUG-0213 (issue #1734): lo que kj deja en el repo durante una ejecucion
 * es suyo y es local, asi que se excluye donde no molesta a nadie:
 * `.git/info/exclude` no viaja con el repo ni aparece en el diff de otro.
 * La ruta se pregunta a git para que funcione tambien en un worktree, donde
 * `.git` es un fichero y no un directorio.
 */
const LOCAL_ARTIFACTS = [
  ".reviews/", ".kj/", ".kj-ready.json",
  // KJC-BUG-0220: lo que kj escribe DENTRO de .karajan/ y NO viaja. Sin esto
  // se quedaba en tierra de nadie (ni versionado ni ignorado) y salia como `??`
  // en cada git status del equipo. Se enumera en vez de ignorar .karajan/
  // entero a proposito: kj.config.yml y las reglas del agente son del equipo, y
  // esconderselas seria decidir por ellos. Los ficheros del supervisor viajan
  // por su cauce sellado (ADR 0009) y tampoco entran aqui.
  ".karajan/harness/",            // el arnes del anfitrion: cada maquina lo regenera
  ".karajan/policy-decisions.jsonl",
  ".karajan/policy-exceptions.jsonl",
  ".karajan/identity.local.yml",  // identidad por clon (ADR 0005)
  ".karajan/sentinel-state.json",
  ".karajan/rag.db",
  ".karajan/audit-history.db",
  ".karajan/update-check.json",
  ".karajan/karajan.env",
  ".karajan/agent-skills/",
  ".karajan/audits/",
  ".karajan/reviews/",
  ".karajan/steward/",
  ".karajan/plans/",
];

export async function excludeLocalArtifacts(projectDir, run = runCommand) {
  let file = path.join(projectDir, ".git", "info", "exclude");
  try {
    const res = await run("git", ["-C", projectDir, "rev-parse", "--git-path", "info/exclude"]);
    const out = res?.stdout?.trim();
    if (res?.exitCode === 0 && out) file = path.isAbsolute(out) ? out : path.join(projectDir, out);
  } catch { /* sin git utilizable: se intenta la ruta por defecto */ }
  let text = "";
  try { text = (await fs.readFile(file, "utf8")) || ""; } catch { /* aun no existe */ }
  const lines = new Set(text.split("\n").map((l) => l.trim()));
  const missing = LOCAL_ARTIFACTS.filter((a) => !lines.has(a));
  if (missing.length === 0) return { changed: false, added: [] };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const sep = text && !text.endsWith("\n") ? "\n" : "";
    await fs.appendFile(file, `${sep}# Karajan run artifacts (local only, never shared)\n${missing.join("\n")}\n`, "utf8");
    return { changed: true, added: missing };
  } catch {
    return { changed: false, added: [] };
  }
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
