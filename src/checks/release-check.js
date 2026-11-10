/**
 * release-check (KJC-TSK-0712) — the release checklist made verifiable:
 * a note loses salience; a check fails RED with the exact list. Generics
 * fit any karajan project; each project extends via `release_check.items`
 * (file_contains with {version}, or command with exit-0 semantics).
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { runCommand } from "../utils/process.js";
import { loadPrivacyList, scanPaths } from "../privacy/scan.js";
import { checkStagedDiff, loadPolicy } from "../policy/engine.js";
import { liftSealedSupervisorViolations } from "../policy/supervisor-verify.js";
import { npmTokenAgeCheck } from "./supply-chain-check.js";
import { claudeContractCheck } from "./claude-contract-check.js";

// KJC-TSK-0769 — the effect boundary: what ships is re-evaluated against the
// policy IN FORCE now, not the one each PR was merged under. Artifact rules
// only: diff-threshold invariants are PR-scoped by definition — skipped, and
// said — so no line metric is needed (without a tag, the whole tree counts).
/** The commit that introduced the kj pre-commit hook (kj setup), or null. */
async function setupCommitOf(projectDir) {
  const res = await runCommand("git", ["-C", projectDir, "log", "--diff-filter=A", "--format=%H", "--", ".karajan/hooks/pre-commit"]);
  if (res.exitCode !== 0) return null;
  return res.stdout.trim().split("\n").filter(Boolean).at(-1) ?? null;
}

/** Supervisor violations on files the setup commit added and nothing changed since. */
async function withoutSetupInstalls(projectDir, setup, violations) {
  const added = await runCommand("git", ["-C", projectDir, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "--diff-filter=A", setup]);
  const installed = new Set(added.exitCode === 0 ? added.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : []);
  const kept = [];
  for (const v of violations) {
    if ((v.rule_id === "defaults.supervisor.write" || v.rule_id === "defaults.governance.write") && installed.has(v.file)) {
      const changed = await runCommand("git", ["-C", projectDir, "diff", "--quiet", setup, "HEAD", "--", v.file]);
      if (changed.exitCode === 0) continue;
    }
    kept.push(v);
  }
  return kept;
}

async function policyRangeCheck(projectDir) {
  const { policy, errors } = loadPolicy({ projectDir });
  if (errors.length > 0) return { name: "policy", ok: false, detail: `policy.yml invalid — ${errors[0]}` };
  const described = await runCommand("git", ["-C", projectDir, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  const tag = described.exitCode === 0 ? described.stdout.trim() : null;
  // KJC-BUG-0342 (#2105): with no tag the whole tree is judged, and the supervisor
  // files the human's kj setup commit installed read as writes. Only those, and only
  // while unchanged since that commit, are the setup and not judged.
  const setup = tag ? null : await setupCommitOf(projectDir);
  const scope = tag ? `${tag}..HEAD` : "whole history (no previous tag)";
  const prScoped = new Set((policy.invariants ?? []).filter((i) => i.kind === "diff-threshold").map((i) => i.id));
  try {
    const listed = await runCommand("git", tag
      ? ["-C", projectDir, "diff", `${tag}..HEAD`, "--name-only"]
      : ["-C", projectDir, "ls-tree", "-r", "--name-only", "HEAD"]);
    if (listed.exitCode !== 0) throw new Error((listed.stderr || "git failed").trim());
    const files = listed.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const raw = checkStagedDiff(policy, { role: "coder", files, netLinesAdded: null }).filter((v) => !prScoped.has(v.rule_id));
    // KJC-BUG-0178 (ADR 0009): the supervisor seal trips the very rule that
    // protects the supervisor. `kj review` and `kj policy check` already lift
    // what the sealed provenance backs; without this the release check blocked
    // every version cut after a human `kj harden --commit`, by its own seal.
    // KJC-BUG-0259: the history is judged on what is versioned (hooks, provenance);
    // the machine-local guards were verified when the seal was reviewed.
    const sup = liftSealedSupervisorViolations({ projectDir, violations: raw, trackedOnly: true });
    const violations = setup ? await withoutSetupInstalls(projectDir, setup, sup.violations) : sup.violations;
    const hard = violations.filter((v) => v.enforcement === "deny");
    const skipped = prScoped.size > 0 ? `; ${prScoped.size} diff-threshold invariant(s) skipped (PR-scoped)` : "";
    if (hard.length > 0) {
      const list = hard.map((v) => `[${v.rule_id}]${v.file ? ` ${v.file}` : ""}`).join(", ");
      // KJC-BUG-0374: supervisor files the seal does not back (an older kj's seal, or an
      // unsealed edit) are fixed by regenerating and resealing, never by a tag or a grant.
      const why = sup.note ? ` (${sup.note})` : "";
      const reseal = hard.some((v) => v.rule_id === "defaults.supervisor.write")
        ? ` — the supervisor seal does not back these files${why}: run kj harden, then ask your user for kj harden --commit`
        : "";
      return { name: "policy", ok: false, detail: `${hard.length} deny violation(s) in ${scope} against the current policy: ${list}${reseal}` };
    }
    return { name: "policy", ok: true, detail: `${scope} clean against the current policy (${violations.length} warning(s))${skipped}` };
  } catch (err) {
    return { name: "policy", ok: false, detail: `could not evaluate ${scope}: ${err.message}` };
  }
}

const semverCmp = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

async function genericChecks(projectDir) {
  const checks = [];
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) {
    checks.push({ name: "manifest", ok: true, detail: "no package.json — generic version checks skipped (declared items still run)" });
    return { checks, version: null, pkg: null };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const version = pkg.version;
  checks.push({ name: "manifest", ok: Boolean(version), detail: version ? `version ${version}` : "package.json has no version" });

  const clPath = join(projectDir, "CHANGELOG.md");
  if (existsSync(clPath)) {
    const cl = readFileSync(clPath, "utf8");
    const topVersioned = (cl.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1] || null;
    // Content still sitting under [Unreleased] means unpromoted entries —
    // the tarball would ship changes its release notes do not tell.
    const afterUnreleased = cl.split(/^## \[Unreleased\]\s*$/m)[1] ?? "";
    const unreleasedBody = afterUnreleased.split(/^## \[/m)[0] ?? "";
    const pending = /\S/.test(unreleasedBody);
    const ok = topVersioned === version && !pending;
    let detail = `top section is [${version}], Unreleased empty`;
    if (pending) detail = `[Unreleased] still carries content — promote it into [${version}] before releasing`;
    else if (!ok) detail = `top CHANGELOG section is [${topVersioned ?? "none"}] but the manifest says ${version} — promote Unreleased before releasing`;
    checks.push({ name: "changelog-current", ok, detail });
  } else {
    checks.push({ name: "changelog-current", ok: false, detail: "no CHANGELOG.md — the release story must exist before the release" });
  }

  const tagsOut = await runCommand("git", ["-C", projectDir, "tag", "--list", "v[0-9]*"]);
  const tags = (tagsOut.stdout || "").split("\n").map((t) => t.trim().replace(/^v/, "")).filter((t) => /^\d+\.\d+\.\d+$/.test(t));
  const ahead = version ? tags.filter((t) => semverCmp(t, version) > 0) : [];
  let tagDetail = tags.includes(version) ? `v${version} already tagged` : `tag v${version} pending (created after publish)`;
  if (ahead.length > 0) tagDetail = `tag(s) ahead of the manifest exist: v${ahead.join(", v")}`;
  checks.push({ name: "tags", ok: ahead.length === 0, detail: tagDetail });
  return { checks, version, pkg };
}

async function packPrivacyCheck(projectDir, pkg) {
  // Every non-private named package is publishable (exports/files-based
  // packages carry no main/bin) — they all get the scan.
  if (!pkg || pkg.private === true || !pkg.name || !pkg.version) return null;
  try {
    const out = await runCommand("npm", ["pack", "--dry-run", "--json", "--silent"], { cwd: projectDir });
    // Fail closed: a broken or empty pack must never read as "clean".
    if (out.exitCode !== 0) return { name: "pack-privacy", ok: false, detail: `npm pack exited ${out.exitCode}` };
    const files = (JSON.parse(out.stdout || "[]")[0]?.files || []).map((f) => join(projectDir, f.path));
    if (files.length === 0) return { name: "pack-privacy", ok: false, detail: "npm pack listed no files" };
    const blocks = scanPaths(files, { list: loadPrivacyList() }).filter((f) => f.severity === "block");
    return { name: "pack-privacy", ok: blocks.length === 0, detail: blocks.length ? `${blocks.length} personal-data/secret hit(s) in the publishable files` : `${files.length} publishable file(s) clean` };
  } catch (err) {
    return { name: "pack-privacy", ok: false, detail: `npm pack --dry-run failed: ${err.message}` };
  }
}

/**
 * KJC-BUG-0204 — an item may declare WHICH command repairs it (`remedied_by`),
 * so the gate stops blocking the one action that would turn it green. It was
 * the landing: the check demanded a deployed site and the guard blocked the
 * deploy, leaving `KJ_ALLOW_RELEASE=1` — switching the gate off entirely — as
 * the only way to reach the publish that came next.
 */
const remedy = (item) => (typeof item?.remedied_by === "string" && item.remedied_by.trim() ? { remediedBy: item.remedied_by.trim() } : {});

/**
 * The words of a verb must appear in the command IN ORDER, as whole words:
 * `firebase deploy` covers `firebase --account a@b --project p deploy --only x`,
 * and `deploy firebase` is a different command. Separators (`;`, `|`, `&`,
 * parentheses) split words, so `(npm publish)` is still a publication.
 * A word is read by its basename, so `/usr/bin/npm publish` is the same
 * publication as `npm publish` (review catch: an absolute path hid one).
 */
const wordsOf = (text) => String(text).split(/[^A-Za-z0-9_.@:/-]+/).filter(Boolean).map((w) => w.slice(w.lastIndexOf("/") + 1)).filter(Boolean);

export function remediesCommand(remediedBy, command) {
  const want = wordsOf(remediedBy);
  if (want.length === 0) return false;
  let i = 0;
  for (const word of wordsOf(command)) if (word === want[i] && ++i === want.length) return true;
  return false;
}

/**
 * A publication is irreversible: no declared item may excuse one. Detected with
 * the SAME tolerance as a remedy (review catch): matching only adjacent words
 * left `npm --registry https://r.example publish` undetected, so an item could
 * have lifted a red check while the publication went ahead.
 */
const PUBLICATION_VERBS = ["npm publish", "gh release create"];
const isPublication = (command) => PUBLICATION_VERBS.some((verb) => remediesCommand(verb, command));

async function declaredItems(projectDir, config, version) {
  const items = config?.release_check?.items;
  if (!Array.isArray(items)) return [];
  const checks = [];
  for (const item of items) {
    const name = item?.name || "unnamed item";
    if (item?.file_contains?.path && item.file_contains.pattern != null) {
      const p = isAbsolute(item.file_contains.path) ? item.file_contains.path : join(projectDir, item.file_contains.path);
      const needle = String(item.file_contains.pattern).replaceAll("{version}", version ?? "");
      const ok = existsSync(p) && readFileSync(p, "utf8").includes(needle);
      checks.push({ name, ok, ...remedy(item), detail: ok ? `"${needle}" found in ${item.file_contains.path}` : `"${needle}" NOT found in ${item.file_contains.path}` });
    } else if (item?.command) {
      try {
        const res = await runCommand("sh", ["-c", String(item.command).replaceAll("{version}", version ?? "")], { cwd: projectDir });
        checks.push({ name, ok: res.exitCode === 0, ...remedy(item), detail: res.exitCode === 0 ? "command exited 0" : `command exited ${res.exitCode}` });
      } catch (err) {
        // El remedio viaja tambien cuando el item no se pudo ni ejecutar
        // (catch de la review): si no, el comando que lo repara queda
        // bloqueado justo cuando el check no ha podido comprobar nada.
        checks.push({ name, ok: false, ...remedy(item), detail: `command failed to run: ${err.message}` });
      }
    } else {
      checks.push({ name, ok: false, detail: "unknown item shape — use file_contains {path, pattern} or command" });
    }
  }
  return checks;
}

/**
 * MIG-B (KJC-TSK-0752, ADR 0004): while a package dual-publishes under two npm
 * names, their `latest` dist-tags must move in LOCKSTEP. A torn dual-publish —
 * one name released, the other not — is invisible from the repo (both installs
 * "work") and every surface that teaches one name silently diverges from the
 * other. The pair is read from scripts/dual-publish.mjs, which is the one
 * place that knows it; no dual script, no check.
 */
export async function dualPublishCheck(projectDir, pkg, run = runCommand) {
  const script = join(projectDir, "scripts", "dual-publish.mjs");
  if (!pkg?.name || !existsSync(script)) return null;
  const src = readFileSync(script, "utf8");
  const legacy = (src.match(/LEGACY_NAME = "([^"]+)"/) || [])[1];
  const scoped = (src.match(/SCOPED_NAME = "([^"]+)"/) || [])[1];
  if (!legacy || !scoped || pkg.name !== legacy) return null;
  const latest = async (name) => {
    const out = await run("npm", ["view", name, "dist-tags.latest"], { cwd: projectDir });
    if (out.exitCode !== 0) throw new Error(`npm view ${name} failed`);
    return (out.stdout || "").trim();
  };
  try {
    const [a, b] = await Promise.all([latest(legacy), latest(scoped)]);
    const ok = Boolean(a) && a === b;
    return { name: "dual-publish", ok, detail: ok ? `${legacy} and ${scoped} both at ${a}` : `dist-tags diverge: ${legacy}@${a || "?"} vs ${scoped}@${b || "?"} — a torn dual-publish; publish the missing name before releasing on top` };
  } catch (err) {
    return { name: "dual-publish", ok: false, detail: `could not read npm dist-tags (${err.message}) — the lockstep cannot be verified, and unverified is not ok` };
  }
}

/**
 * QS-A3 (KJC-TSK-1028): a project that carries a scenario battery
 * (`test:scenarios`) ships only with it green. Gate clashes and holes in the
 * plan path only show end to end, and the unit suite never runs them.
 */
export async function scenarioBatteryCheck(projectDir, pkg, run = runCommand) {
  if (!pkg?.scripts?.["test:scenarios"]) return null;
  try {
    const res = await run("npm", ["run", "test:scenarios"], { cwd: projectDir });
    return { name: "scenarios", ok: res.exitCode === 0, detail: res.exitCode === 0 ? "scenario battery green" : `npm run test:scenarios exited ${res.exitCode}` };
  } catch (err) {
    return { name: "scenarios", ok: false, detail: `npm run test:scenarios failed to run: ${err.message}` };
  }
}

export async function runReleaseCheck({ projectDir = process.cwd(), config = {}, forCommand = null } = {}) {
  const { checks, version, pkg } = await genericChecks(projectDir);
  const pack = await packPrivacyCheck(projectDir, pkg);
  const dual = await dualPublishCheck(projectDir, pkg);
  const scenarios = await scenarioBatteryCheck(projectDir, pkg);
  // KJC-TSK-1059: what publishes to npm also says how old its long-lived tokens are (a warning).
  const tokens = pkg?.name && !pkg.private ? await npmTokenAgeCheck({ maxDays: config?.supply_chain?.npm_token_max_days }) : null;
  // KJC-TSK-1063: kj never ships unchecked against the claude installed here.
  const claudeContract = await claudeContractCheck(projectDir);
  checks.push(...[pack, dual, scenarios, tokens, claudeContract].filter(Boolean), await policyRangeCheck(projectDir), ...await declaredItems(projectDir, config, version));
  if (forCommand === null) return { ok: checks.every((c) => c.ok), version, checks };
  // A lifted check stays RED in the report: the fact is not falsified, it just
  // stops blocking the command that exists to repair it. The mark travels ON
  // the check (review catch): two items may share a name, and a name-keyed
  // list would have exempted a red check nothing remedies.
  const liftable = !isPublication(forCommand);
  const marked = checks.map((c) => (liftable && !c.ok && c.remediedBy && remediesCommand(c.remediedBy, forCommand) ? { ...c, lifted: true } : c));
  return { ok: marked.every((c) => c.ok || c.lifted === true), version, checks: marked, lifted: marked.filter((c) => c.lifted).map((c) => c.name) };
}
