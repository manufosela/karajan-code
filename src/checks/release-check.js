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

// KJC-TSK-0769 — the effect boundary: what ships is re-evaluated against the
// policy IN FORCE now, not the one each PR was merged under. Artifact rules
// only: diff-threshold invariants are PR-scoped by definition — skipped, and
// said — so no line metric is needed (without a tag, the whole tree counts).
async function policyRangeCheck(projectDir) {
  const { policy, errors } = loadPolicy({ projectDir });
  if (errors.length > 0) return { name: "policy", ok: false, detail: `policy.yml invalid — ${errors[0]}` };
  const described = await runCommand("git", ["-C", projectDir, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  const tag = described.exitCode === 0 ? described.stdout.trim() : null;
  const scope = tag ? `${tag}..HEAD` : "whole history (no previous tag)";
  const prScoped = new Set((policy.invariants ?? []).filter((i) => i.kind === "diff-threshold").map((i) => i.id));
  try {
    const listed = await runCommand("git", tag
      ? ["-C", projectDir, "diff", `${tag}..HEAD`, "--name-only"]
      : ["-C", projectDir, "ls-tree", "-r", "--name-only", "HEAD"]);
    if (listed.exitCode !== 0) throw new Error((listed.stderr || "git failed").trim());
    const files = listed.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const violations = checkStagedDiff(policy, { role: "coder", files, netLinesAdded: null }).filter((v) => !prScoped.has(v.rule_id));
    const hard = violations.filter((v) => v.enforcement === "deny");
    const skipped = prScoped.size > 0 ? `; ${prScoped.size} diff-threshold invariant(s) skipped (PR-scoped)` : "";
    if (hard.length > 0) {
      const list = hard.map((v) => `[${v.rule_id}]${v.file ? ` ${v.file}` : ""}`).join(", ");
      return { name: "policy", ok: false, detail: `${hard.length} deny violation(s) in ${scope} against the current policy: ${list}` };
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
    const files = (JSON.parse(out.stdout || "[]")[0]?.files || []).map((f) => join(projectDir, f.path));
    const blocks = scanPaths(files, { list: loadPrivacyList() }).filter((f) => f.severity === "block");
    return { name: "pack-privacy", ok: blocks.length === 0, detail: blocks.length ? `${blocks.length} personal-data/secret hit(s) in the publishable files` : `${files.length} publishable file(s) clean` };
  } catch (err) {
    return { name: "pack-privacy", ok: false, detail: `npm pack --dry-run failed: ${err.message}` };
  }
}

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
      checks.push({ name, ok, detail: ok ? `"${needle}" found in ${item.file_contains.path}` : `"${needle}" NOT found in ${item.file_contains.path}` });
    } else if (item?.command) {
      try {
        const res = await runCommand("sh", ["-c", String(item.command).replaceAll("{version}", version ?? "")], { cwd: projectDir });
        checks.push({ name, ok: res.exitCode === 0, detail: res.exitCode === 0 ? "command exited 0" : `command exited ${res.exitCode}` });
      } catch (err) {
        checks.push({ name, ok: false, detail: `command failed to run: ${err.message}` });
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

export async function runReleaseCheck({ projectDir = process.cwd(), config = {} } = {}) {
  const { checks, version, pkg } = await genericChecks(projectDir);
  const pack = await packPrivacyCheck(projectDir, pkg);
  const dual = await dualPublishCheck(projectDir, pkg);
  checks.push(...(pack ? [pack] : []), ...(dual ? [dual] : []), await policyRangeCheck(projectDir), ...await declaredItems(projectDir, config, version));
  return { ok: checks.every((c) => c.ok), version, checks };
}
