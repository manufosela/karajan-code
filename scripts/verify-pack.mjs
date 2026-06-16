#!/usr/bin/env node
/**
 * Pre-publish tarball smoke gate (KJC-TSK-0553).
 *
 * WHY: the test suite runs against the linked workspace, where
 * `@karajan/core` and its deps resolve via symlink — so a broken
 * PUBLISHED artifact (bundleDependencies dragging in sqlite-vec without
 * its entry point, KJC-BUG-0082 / 0086) passed CI yet failed on every
 * clean `npm install`. v3.2.0, v3.3.0 and v3.4.1 all shipped unable to
 * run even `kj --version`.
 *
 * WHAT: pack the real tarball, install it into an isolated tmpdir
 * (outside the repo, with CLAUDECODE stripped), and assert the binary
 * actually starts and its native-ish deps resolve. Exit non-zero on any
 * failure so `prepublishOnly` aborts the publish and CI blocks the PR.
 *
 * `npm pack` fires prepack/postpack, NOT prepublishOnly — so invoking
 * this from prepublishOnly does not recurse.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const expectedVersion = pkg.version;

// Subprocess env: strip CLAUDECODE (Claude Code blocks nested non-interactive
// runs otherwise) and force a non-interactive, quiet npm.
const { CLAUDECODE: _omit, ...cleanEnv } = process.env;
const childEnv = { ...cleanEnv, npm_config_yes: "true", CI: "1" };

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function fail(msg, detail) {
  console.error(`\n✗ verify-pack: ${msg}`);
  if (detail) console.error(String(detail).split("\n").slice(0, 20).join("\n"));
  process.exit(1);
}

let tgzPath = null;
let tmpDir = null;
try {
  console.log(`verify-pack: packing karajan-code@${expectedVersion}…`);
  // --json gives us the exact filename without parsing human output.
  const packOut = run("npm", ["pack", "--json", "--silent"], { cwd: repoRoot });
  const filename = JSON.parse(packOut)[0]?.filename;
  if (!filename) fail("npm pack did not report a filename", packOut);
  // npm normalizes scoped names in --json but karajan-code is unscoped;
  // the file lands in cwd under the reported name.
  tgzPath = path.join(repoRoot, filename);
  if (!fs.existsSync(tgzPath)) fail(`packed tarball not found at ${tgzPath}`);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-pack-"));
  console.log(`verify-pack: installing the tarball into ${tmpDir} (clean, isolated)…`);
  run("npm", ["install", tgzPath, "--no-audit", "--no-fund", "--silent", "--prefix", tmpDir], {
    cwd: tmpDir,
  });

  const binPath = path.join(tmpDir, "node_modules", ".bin", "kj");
  if (!fs.existsSync(binPath)) fail(`kj binary missing after install: ${binPath}`);

  // 1. kj --version must start AND report the version we just packed.
  let versionOut;
  try {
    versionOut = run(binPath, ["--version"]).trim();
  } catch (err) {
    fail("`kj --version` crashed on a clean install", err.stderr || err.message);
  }
  if (!versionOut.includes(expectedVersion)) {
    fail(`kj --version returned "${versionOut}", expected ${expectedVersion}`);
  }
  console.log(`verify-pack: kj --version → ${versionOut} ✓`);

  // 2. kj --help must exit 0 (exercises the command tree wiring).
  try {
    run(binPath, ["--help"]);
  } catch (err) {
    fail("`kj --help` failed on a clean install", err.stderr || err.message);
  }
  console.log("verify-pack: kj --help ✓");

  // 3. The deps that broke before must resolve in the installed tree.
  const installedRoot = path.join(tmpDir, "node_modules", "karajan-code");
  const checks = [
    path.join(tmpDir, "node_modules", "sqlite-vec", "index.mjs"),
    path.join(installedRoot, "node_modules", "@karajan", "core", "src", "vec-store.js"),
  ];
  for (const p of checks) {
    if (!fs.existsSync(p)) fail(`expected resolved path missing in install: ${p}`);
  }
  console.log("verify-pack: sqlite-vec + @karajan/core resolve ✓");

  // 4. kj-trash (ai-trash safety binary) must ship + link onto PATH and boot
  // without a module-resolution crash. It was silently absent from the tarball
  // until KJC-BUG-0089 — every npm user got "kj-trash not found".
  const trashBin = path.join(tmpDir, "node_modules", ".bin", "kj-trash");
  if (!fs.existsSync(trashBin)) fail(`kj-trash binary missing after install: ${trashBin}`);
  const trash = spawnSync(trashBin, ["--help"], { encoding: "utf8", env: childEnv });
  // The CLI exits 2 on --help (usage); only a real crash (module not found, or
  // an unexpected non-0/2 exit) is a failure.
  if (![0, 2].includes(trash.status) || /ERR_MODULE_NOT_FOUND|Cannot find/.test(trash.stderr || "")) {
    fail("`kj-trash --help` crashed on a clean install", trash.stderr || `exit ${trash.status}`);
  }
  console.log("verify-pack: kj-trash ships + boots ✓");

  console.log(`\n✓ verify-pack: karajan-code@${expectedVersion} installs clean and runs.`);
} finally {
  if (tgzPath && fs.existsSync(tgzPath)) fs.rmSync(tgzPath, { force: true });
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
}
