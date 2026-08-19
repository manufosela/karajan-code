#!/usr/bin/env node
/**
 * Pre-publish tarball smoke gate (KJC-TSK-0553).
 *
 * WHY: the test suite runs against the linked workspace, where
 * `karajan-core` and its deps resolve via symlink — so a broken
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
// MIG-A (KJC-TSK-0751): el nombre sale del manifest — el MISMO verify-pack
// valida el tarball unscoped y el @karajan-family/* del dual-publish.
const pkgName = pkg.name;

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
let gTmp = null;
let pnpmTmp = null;
let qsTmp = null;
try {
  console.log(`verify-pack: packing ${pkgName}@${expectedVersion}…`);
  // --json gives us the exact filename without parsing human output.
  const packOut = run("npm", ["pack", "--json", "--silent"], { cwd: repoRoot });
  const filename = JSON.parse(packOut)[0]?.filename;
  if (!filename) fail("npm pack did not report a filename", packOut);
  // npm --json reports the exact filename (scoped names normalized to
  // scope-name-x.y.z.tgz); the file lands in cwd under that name.
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

  // 1.5 Privacy boundary (KJC-TSK-0706): nothing personal or secret-shaped
  // ships inside the tarball. Scans the INSTALLED package with the same
  // engine as the pre-commit gate: denylist + token shapes abort the
  // publish; generic PII only counts (code trees always carry a few
  // pattern lookalikes).
  const { scanPaths, loadPrivacyList } = await import(
    path.join(repoRoot, "src", "privacy", "scan.js")
  );
  const shippedDir = path.join(tmpDir, "node_modules", ...pkgName.split("/"));
  const pFindings = scanPaths([shippedDir], { list: loadPrivacyList() });
  const pBlocks = pFindings.filter((f) => f.severity === "block");
  if (pBlocks.length > 0) {
    for (const f of pBlocks) console.error(`✗ [${f.type}] ${path.relative(shippedDir, f.source)}:${f.line} → ${f.masked}`);
    fail(`${pBlocks.length} personal-data/secret hit(s) INSIDE the tarball — this must not publish`);
  }
  console.log(`verify-pack: tarball privacy scan ✓ (${pFindings.length} generic warning(s))`);

  // 2. kj --help must exit 0 (exercises the command tree wiring).
  try {
    run(binPath, ["--help"]);
  } catch (err) {
    fail("`kj --help` failed on a clean install", err.stderr || err.message);
  }
  console.log("verify-pack: kj --help ✓");

  // 3. The deps that broke before must resolve in the installed tree.
  // karajan-core is a registry dep since KJC-BUG-0103 (no bundling), so it
  // hoists to the consumer's top-level node_modules like everything else.
  const checks = [
    path.join(tmpDir, "node_modules", "sqlite-vec", "index.mjs"),
    path.join(tmpDir, "node_modules", "karajan-core", "src", "vec-store.js"),
  ];
  for (const p of checks) {
    if (!fs.existsSync(p)) fail(`expected resolved path missing in install: ${p}`);
  }
  console.log("verify-pack: sqlite-vec + karajan-core resolve ✓");

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

  // 5. GLOBAL install smoke (KJC-BUG-0103). `npm install -g` nests every dep
  // under karajan-code/node_modules; with bundleDependencies present, npm
  // treated that whole subtree as "already in the tarball" and skipped
  // fetching better-sqlite3 & friends — EMPTY dirs whose install scripts then
  // crashed. Local installs hoist and never hit it, which is exactly why the
  // check above stayed green for ~15 broken releases. A fresh global install
  // must succeed and kj must boot.
  gTmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-g-"));
  console.log(`verify-pack: installing the tarball GLOBALLY into ${gTmp}…`);
  try {
    run("npm", ["install", "-g", tgzPath, "--no-audit", "--no-fund", "--silent", "--prefix", gTmp]);
  } catch (err) {
    fail("`npm install -g` of the tarball failed (KJC-BUG-0103 class)", err.stderr || err.message);
  }
  const gBin = process.platform === "win32"
    ? path.join(gTmp, "kj.cmd")
    : path.join(gTmp, "bin", "kj");
  if (!fs.existsSync(gBin)) fail(`kj binary missing after global install: ${gBin}`);
  let gVersion;
  try {
    gVersion = run(gBin, ["--version"]).trim();
  } catch (err) {
    fail("`kj --version` crashed on a fresh GLOBAL install", err.stderr || err.message);
  }
  if (!gVersion.includes(expectedVersion)) {
    fail(`kj --version (global) returned "${gVersion}", expected ${expectedVersion}`);
  }
  console.log(`verify-pack: global install + kj --version → ${gVersion} ✓`);

  // 5.5 Quickstart smoke (KJC-TSK-0635) — the landing's Getting Started
  // sequence against the INSTALLED tarball, no LLM involved. Born from
  // 2026-07-19: following the docs to the letter caught 3 field bugs
  // (silent 2.34.0 install, Solomon loop on no-remote repos, retired
  // gemini CLI) that 6000 unit tests never saw. Aux bootstraps (ollama,
  // rtk, squeezr, qmd, harden) are skipped — this validates kj's own
  // init + config on the canonical no-remote scenario, not the network.
  qsTmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-qs-"));
  console.log(`verify-pack: quickstart smoke (init on a no-remote repo) in ${qsTmp}…`);
  run("git", ["init", "-q", "-b", "main"], { cwd: qsTmp });
  // KARAJAN_HOME points at an isolated dir: faithful to a brand-new user
  // (no pre-existing global config — `--local` without one is rejected by
  // design, which is exactly what this smoke caught on its first CI run)
  // AND hermetic (never touches the real ~/.karajan).
  const qsEnv = { ...childEnv, KARAJAN_HOME: path.join(qsTmp, "karajan-home") };
  delete qsEnv.CLAUDECODE;
  const initRes = spawnSync(gBin, ["init", "--no-interactive", "--no-ollama", "--no-rtk", "--no-squeezr", "--no-qmd", "--no-harden"], {
    encoding: "utf8", cwd: qsTmp, env: qsEnv, timeout: 180000,
  });
  if (initRes.status !== 0) {
    fail("`kj init --no-interactive` failed on a fresh no-remote repo", (initRes.stderr || initRes.stdout || "").slice(-800));
  }
  const qsCfgLocal = path.join(qsTmp, ".karajan", "kj.config.yml");
  const qsCfgGlobal = path.join(qsTmp, "karajan-home", "kj.config.yml");
  const qsCfg = fs.existsSync(qsCfgLocal) ? qsCfgLocal : qsCfgGlobal;
  if (!fs.existsSync(qsCfg)) fail(`kj init did not write ${qsCfg}`);
  if (!/coder:\s*\S+/.test(fs.readFileSync(qsCfg, "utf8"))) {
    fail("generated kj.config.yml has no coder assignment");
  }
  const reportRes = spawnSync(gBin, ["report"], { encoding: "utf8", cwd: qsTmp, env: qsEnv, timeout: 60000 });
  const reportOut = `${reportRes.stdout || ""}${reportRes.stderr || ""}`;
  if (reportRes.status !== 0 && !/no session|sin sesi|not found/i.test(reportOut)) {
    fail("`kj report` crashed on a project with no sessions", reportOut.slice(-400));
  }
  console.log("verify-pack: quickstart smoke (init + report, no-remote repo) ✓");

  // 6. pnpm install smoke (KJC-TSK-0580). pnpm's layout differs from npm's
  // (a symlinked virtual store), so it can break resolution of the bundled
  // karajan-core the way npm packaging breakage did before (KJC-BUG-0082/0086).
  // Verify a pnpm install resolves the JS tree and `kj --version` boots — every
  // release catches a pnpm packaging regression. (pnpm also blocks
  // better-sqlite3's native build by default, so DB-backed commands need
  // `pnpm approve-builds`; that's surfaced as a doctor warning, KJC-BUG-0092 —
  // not a gate failure, since it's inherent to pnpm.) Auto-skips without pnpm.
  // KJC-BUG-0135: `npm run` leaks npm_config_* into the child env, and pnpm
  // maps those variables onto its own config — which can re-anchor it to THIS
  // repo (7-aug incident: the repo's node_modules converted to pnpm layout,
  // native bindings wiped, and simple-git-hooks' hook overwrote
  // .karajan/hooks). The smoke runs with a scrubbed env and a pinned --dir,
  // and the tripwire below turns any host contamination into a loud gate
  // failure instead of a silent green.
  const pnpmEnv = Object.fromEntries(Object.entries(childEnv).filter(([k]) => !/^npm_config_/i.test(k)));
  const HOST_MARKERS = ["pnpm-lock.yaml", "pnpm-workspace.yaml", path.join("node_modules", ".pnpm")];
  const hostMarkersBefore = new Set(HOST_MARKERS.filter((m) => fs.existsSync(path.join(repoRoot, m))));
  const hasPnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", env: pnpmEnv }).status === 0;
  if (!hasPnpm) {
    console.log("verify-pack: pnpm not installed — skipping pnpm smoke (npm path covered above) ⚠");
  } else {
    pnpmTmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-pnpm-"));
    fs.writeFileSync(
      path.join(pnpmTmp, "package.json"),
      JSON.stringify({ name: "kj-verify-pnpm", private: true }),
    );
    console.log(`verify-pack: installing the tarball with pnpm into ${pnpmTmp}…`);
    // pnpm exits non-zero on ERR_PNPM_IGNORED_BUILDS (it skips native build
    // scripts by default) — expected here, so don't treat the exit as failure.
    // minimum-release-age=0: modern pnpm quarantines freshly published
    // versions (supply-chain protection), so right after publishing
    // karajan-core it silently resolves an OLD one and this smoke fails on
    // missing subpaths. The gate verifies packaging, not release-age policy.
    spawnSync(
      "pnpm",
      ["add", tgzPath, "--dir", pnpmTmp, "--ignore-workspace", "--store-dir", path.join(pnpmTmp, ".store"), "--config.minimum-release-age=0"],
      { encoding: "utf8", env: pnpmEnv, cwd: pnpmTmp },
    );
    const pnpmBin = path.join(pnpmTmp, "node_modules", ".bin", "kj");
    if (!fs.existsSync(pnpmBin)) fail(`kj binary missing after pnpm install: ${pnpmBin}`);
    let pnpmVersion;
    try {
      pnpmVersion = run(pnpmBin, ["--version"], { cwd: pnpmTmp }).trim();
    } catch (err) {
      fail("`kj --version` crashed under a pnpm install (packaging regression)", err.stderr || err.message);
    }
    if (!pnpmVersion.includes(expectedVersion)) {
      fail(`kj --version under pnpm returned "${pnpmVersion}", expected ${expectedVersion}`);
    }
    console.log(`verify-pack: pnpm install + kj --version → ${pnpmVersion} ✓ (DB build needs \`pnpm approve-builds\`)`);
  }
  // Tripwire (KJC-BUG-0135): the smoke must NEVER touch the host repo. If a
  // pnpm artifact appeared at the repo root during this run, the gate fails
  // naming it — never a green over a contaminated tree.
  const contaminated = HOST_MARKERS.filter(
    (m) => !hostMarkersBefore.has(m) && fs.existsSync(path.join(repoRoot, m)),
  );
  if (contaminated.length > 0) {
    fail(
      `pnpm smoke contaminated the host repo: ${contaminated.join(", ")} appeared at the repo root`,
      "remove the listed files and run `npm ci` to restore the npm layout; then verify .karajan/hooks with `git status`",
    );
  }

  console.log(`\n✓ verify-pack: ${pkgName}@${expectedVersion} installs clean and runs.`);
} finally {
  if (tgzPath && fs.existsSync(tgzPath)) fs.rmSync(tgzPath, { force: true });
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  if (gTmp && fs.existsSync(gTmp)) fs.rmSync(gTmp, { recursive: true, force: true });
  if (pnpmTmp && fs.existsSync(pnpmTmp)) fs.rmSync(pnpmTmp, { recursive: true, force: true });
  if (qsTmp && fs.existsSync(qsTmp)) fs.rmSync(qsTmp, { recursive: true, force: true });
}
