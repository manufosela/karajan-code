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
  if (!existsSync(clPath)) {
    checks.push({ name: "changelog-current", ok: false, detail: "no CHANGELOG.md — the release story must exist before the release" });
  } else {
    const cl = readFileSync(clPath, "utf8");
    const topVersioned = (cl.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1] || null;
    // Content still sitting under [Unreleased] means unpromoted entries —
    // the tarball would ship changes its release notes do not tell.
    const afterUnreleased = cl.split(/^## \[Unreleased\]\s*$/m)[1] ?? "";
    const unreleasedBody = afterUnreleased.split(/^## \[/m)[0] ?? "";
    const pending = /\S/.test(unreleasedBody);
    const ok = topVersioned === version && !pending;
    checks.push({
      name: "changelog-current",
      ok,
      detail: ok
        ? `top section is [${version}], Unreleased empty`
        : pending
          ? `[Unreleased] still carries content — promote it into [${version}] before releasing`
          : `top CHANGELOG section is [${topVersioned ?? "none"}] but the manifest says ${version} — promote Unreleased before releasing`,
    });
  }

  const tagsOut = await runCommand("git", ["-C", projectDir, "tag", "--list", "v[0-9]*"]);
  const tags = (tagsOut.stdout || "").split("\n").map((t) => t.trim().replace(/^v/, "")).filter((t) => /^\d+\.\d+\.\d+$/.test(t));
  const ahead = version ? tags.filter((t) => semverCmp(t, version) > 0) : [];
  checks.push({
    name: "tags",
    ok: ahead.length === 0,
    detail: ahead.length ? `tag(s) ahead of the manifest exist: v${ahead.join(", v")}` : (tags.includes(version) ? `v${version} already tagged` : `tag v${version} pending (created after publish)`),
  });
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

export async function runReleaseCheck({ projectDir = process.cwd(), config = {} } = {}) {
  const { checks, version, pkg } = await genericChecks(projectDir);
  const pack = await packPrivacyCheck(projectDir, pkg);
  if (pack) checks.push(pack);
  checks.push(...await declaredItems(projectDir, config, version));
  return { ok: checks.every((c) => c.ok), version, checks };
}
