/**
 * harden-engine — installs kj-managed git hooks idempotently (KJC-TSK-0555).
 *
 * Hooks live under `.karajan/hooks/` and are activated via `core.hooksPath`,
 * so harden never fights husky/simple-git-hooks nor touches `.git/hooks/`.
 * Each hook is a shebang + a kj:managed block; re-running is a no-op and any
 * content outside the block is preserved. A managed block edited by hand since
 * the sealed provenance leaves its hook as it is (HU-4997).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { runCommand } from "../utils/process.js";
import { predates } from "./critical-seal.js";
import { bodyDigest, handEditDetector, recordWrittenHooks } from "./hand-edit.js";
import { hookBody, PROFILE_HOOKS, SHEBANG, TEMPLATE_SINCE } from "./hook-templates.js";

const BLOCK_VERSION = 1;
const HOOKS_DIR = join(".karajan", "hooks");
const HOOK_PREAMBLE = `${SHEBANG}\nset -e\n`;

export function isGitRepo(projectDir) {
  return existsSync(join(projectDir, ".git"));
}

/**
 * KJC-BUG-0161 / ADR 0009: el contenido CANÓNICO de un hook para una
 * generación dada — exactamente lo que installHooks escribiría partiendo
 * de cero. La verificación estructural del supervisor recomputa esto y
 * compara por hash: un fichero con una sola coma manual ya no coincide.
 */
export function renderCanonicalHook(hook, generation = {}) {
  // KJC-BUG-0538: a provenance sealed before commitConvention existed renders it as conventional, as it was.
  const { cmds = {}, baseBranch = null, commitConvention = "conventional" } = generation;
  // HU-5032: a hook written with its previous template, for the base's older judges, renders as it was written.
  const previousTemplate = generation.previousTemplate?.[hook] === true;
  const { content } = upsertManagedBlock({
    source: HOOK_PREAMBLE,
    blockId: `hook:${hook}`,
    version: BLOCK_VERSION,
    body: hookBody(hook, cmds, { baseBranch, commitConvention, previousTemplate }),
    style: "hash",
  });
  return content;
}

/**
 * One hook's upsert: kj's block over what is there, kept-edited when that block was edited by hand
 * (HU-4997), or deferred when it is written with its previous template (HU-5032) and its bytes change.
 */
function upsertHook({ target, hook, body, editedByHand, previousTemplate }) {
  const exists = existsSync(target);
  const source = exists ? readFileSync(target, "utf8") : HOOK_PREAMBLE;
  const upsert = upsertManagedBlock({ source, blockId: `hook:${hook}`, version: BLOCK_VERSION, body, style: "hash" });
  const kept = exists && upsert.action !== "unchanged" && editedByHand(hook, source);
  if (kept) return { content: upsert.content, action: "kept-edited" };
  const deferred = previousTemplate && upsert.action !== "unchanged";
  return { content: upsert.content, action: deferred ? "deferred" : upsert.action };
}

/** HU-5032: whether a judge on kj `judgeVersion` ([major, minor, patch] or null) predates a hook's template. */
const predatesTemplate = (judgeVersion) => (hook) =>
  typeof TEMPLATE_SINCE[hook] === "string" && predates(judgeVersion, TEMPLATE_SINCE[hook].split(".").map(Number));

const LEFT_AS_IS = new Set(["unchanged", "kept-edited"]);

/**
 * Install (or refresh) the profile's hooks under `.karajan/hooks/` and point
 * `core.hooksPath` there. Idempotent. `dryRun` computes actions without
 * touching disk or git config. `cmds` supplies stack-aware lint/format/test
 * commands (npm-script defaults). Returns a per-hook action report.
 */
export async function installHooks({
  projectDir = process.cwd(),
  profile = "standard",
  cmds = {},
  dryRun = false,
  baseBranch = null,
  commitConvention = "conventional",
  judgeVersion = null,
} = {}) {
  if (!isGitRepo(projectDir)) throw new Error(`Not a git repository: ${projectDir}`);
  const hooks = PROFILE_HOOKS[profile];
  if (!hooks) throw new Error(`Unknown harden profile: ${profile}`);

  const absHooksDir = join(projectDir, HOOKS_DIR);
  const results = [];
  const bodySha256 = {};
  const written = {};
  const editedByHand = handEditDetector(projectDir, renderCanonicalHook, HOOK_PREAMBLE);
  // HU-5032 (ADR 0069): a hook whose template is newer than the base's judges is written with its
  // previous template and the current settings, what those judges render; the generation says so.
  const previousTemplate = hooks.filter(predatesTemplate(judgeVersion));
  for (const hook of hooks) {
    const target = join(absHooksDir, hook);
    const previous = previousTemplate.includes(hook);
    const body = hookBody(hook, cmds, { baseBranch, commitConvention, previousTemplate: previous });
    bodySha256[hook] = bodyDigest(body);
    const { content, action } = upsertHook({ target, hook, body, editedByHand, previousTemplate: previous });
    results.push({ hook, target, action, ...(action === "deferred" ? { judgeVersion: judgeVersion.join(".") } : {}) });
    if (!dryRun && !LEFT_AS_IS.has(action)) {
      mkdirSync(absHooksDir, { recursive: true });
      writeFileSync(target, content);
      chmodSync(target, 0o755);
      written[hook] = content;
    }
  }

  if (!dryRun) {
    recordWrittenHooks(projectDir, written);
    await runCommand("git", ["config", "core.hooksPath", HOOKS_DIR], { cwd: projectDir });
  }

  // KJC-BUG-0161: los parámetros con los que SE GENERÓ — lo que la
  // provenance necesita registrar para que CI pueda recomputar y comparar.
  // HU-4997: and the digest of each managed body, for a kj that cannot re-render this template.
  return { profile, hooksPath: HOOKS_DIR, dryRun, hooks: results, generation: { profile, cmds, baseBranch, commitConvention, bodySha256, ...(previousTemplate.length ? { previousTemplate: Object.fromEntries(previousTemplate.map((h) => [h, true])) } : {}) } };
}
