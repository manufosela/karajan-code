/**
 * KJC-BUG-0040 — el SEA bundle de esbuild fallaba al intentar resolver
 * `better-sqlite3` (módulo nativo, importado por packages/hu-board/src/db.js).
 * Pre-fix, el workflow `release-binaries.yml` rompía desde v2.12.0 y no
 * publicaba binarios standalone para ninguna release.
 *
 * Este test smokea el flujo entero:
 *  1. `seaBuildOptions` produce un bundle sin errores.
 *  2. El stub de hu-board reemplaza el código real (so the binary does
 *     NOT carry better-sqlite3 / chokidar / etc native deps).
 *  3. Invocar el bundle con `board cleanup` lanza el mensaje del stub
 *     (en lugar de un crash de runtime opaco).
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let outDir;
let bundlePath;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "kj-sea-bundle-"));
  bundlePath = join(outDir, "kj-bundle.cjs");

  const { seaBuildOptions } = await import("../scripts/esbuild-sea.config.mjs");
  const { build } = await import("esbuild");
  const result = await build({ ...seaBuildOptions, outfile: bundlePath, logLevel: "silent" });
  expect(result.errors).toHaveLength(0);
}, 30_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("SEA bundle (KJC-BUG-0040)", () => {
  it("bundles without resolving better-sqlite3 (native dep)", () => {
    const code = readFileSync(bundlePath, "utf8");
    // better-sqlite3 is marked external + reached only via the hu-board
    // stub, so the bundled CJS source must NOT contain its native binding.
    expect(code).not.toMatch(/require\(["']better-sqlite3["']\)/);
  });

  it("embeds the hu-board stub message so the binary fails loudly when board cleanup is invoked", () => {
    const code = readFileSync(bundlePath, "utf8");
    expect(code).toContain("The HU Board is not available in this standalone binary");
  });

  it("runs --version end-to-end without crashing", () => {
    const out = execFileSync("node", [bundlePath, "--version"], { encoding: "utf8" }).trim();
    expect(out).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("dispatches `kj run` without a missing-symbol crash (KJC-BUG-0097)", () => {
    // src/rag/auto-update.js lives under src/rag/ so the rag stub swallows it,
    // yet run.js calls maybeAutoUpdate() on every `kj run`. If the stub omits
    // that export the whole command dies with "maybeAutoUpdate is not a
    // function" — while --version/--help stay green. No agent is configured
    // here, so the command is expected to fail LATER; we only assert it does
    // not die on a missing bundled symbol.
    const repo = mkdtempSync(join(tmpdir(), "kj-sea-run-"));
    // CI runners have no global git identity, so pin one per-invocation
    // (-c) — otherwise the seed commit dies with "Author identity unknown".
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", [
      "-C", repo,
      "-c", "user.email=kj@test.local",
      "-c", "user.name=kj",
      "commit", "-q", "--allow-empty", "-m", "seed",
    ]);
    let combined = "";
    try {
      combined = execFileSync("node", [bundlePath, "run", "smoke probe"], {
        encoding: "utf8", cwd: repo, input: "", timeout: 30_000,
      });
    } catch (err) {
      combined = `${String(err.stdout || "")}\n${String(err.stderr || "")}`;
    }
    rmSync(repo, { recursive: true, force: true });
    expect(combined).not.toMatch(/is not a function|is not defined/);
  });

  it("emits the stub message (not a stack trace) when `board cleanup` is invoked", () => {
    // The child node process inherits process.env.VITEST, which routes
    // KARAJAN_HOME to a fresh tmp dir without a global kj.config.yml. The
    // repo's .karajan/kj.config.yml then trips loadConfig's local-without-
    // global guard. Pre-seed an empty global config for the child.
    const childHome = mkdtempSync(join(tmpdir(), "kj-sea-home-"));
    writeFileSync(join(childHome, "kj.config.yml"), "");
    const env = { ...process.env, KARAJAN_HOME: childHome };
    let stdout = "";
    let stderr = "";
    try {
      stdout = execFileSync("node", [bundlePath, "board", "cleanup"], { encoding: "utf8", env });
    } catch (err) {
      stdout = String(err.stdout || "");
      stderr = String(err.stderr || "");
    }
    rmSync(childHome, { recursive: true, force: true });
    const combined = `${stdout}\n${stderr}`;
    expect(combined).toContain("The HU Board is not available in this standalone binary");
    expect(combined).toContain("npm install -g karajan-code");
  });
});
