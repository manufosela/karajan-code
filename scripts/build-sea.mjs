#!/usr/bin/env node

/**
 * build-sea.mjs — Build a Node.js Single Executable Application (SEA) binary.
 *
 * Steps:
 *   1. esbuild bundles src/cli.js -> dist/kj-bundle.cjs (CJS, all deps inlined)
 *   2. Generate SEA preparation blob via node --experimental-sea-config
 *   3. Copy the current node binary to dist/kj (or dist/kj.exe on Windows)
 *   4. Inject the blob into the binary with postject
 *   5. (macOS only) Re-sign the binary with ad-hoc signature
 *
 * Requirements (installed as devDependencies — run `npm ci` first):
 *   - esbuild
 *   - postject
 *
 * Usage:
 *   node scripts/build-sea.mjs
 */

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const binaryName = isWindows ? "kj.exe" : "kj";
const binaryPath = path.join(DIST, binaryName);

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function main() {
  try {
    console.log("\n=== Karajan Code — SEA Build ===\n");

    // ── Step 0: Prepare dist directory ──────────────────────────────
    mkdirSync(DIST, { recursive: true });

    // ── Step 1: Bundle with esbuild ─────────────────────────────────
    console.log("[1/5] Bundling with esbuild...");
    const { seaBuildOptions } = await import("./esbuild-sea.config.mjs");
    const esbuild = await import("esbuild");
    await esbuild.build(seaBuildOptions);
    console.log("      -> dist/kj-bundle.cjs created.\n");

    // ── Step 2: Generate SEA blob ───────────────────────────────────
    console.log("[2/5] Generating SEA preparation blob...");
    // Templates travel as SEA assets (KJC-BUG-0104): the binary ships no
    // templates/ directory, so kj init / role prompts / onboard resolved
    // paths like $HOME/templates/skills and hit ENOENT. The runtime
    // (src/utils/templates-root.js) reads the index asset and extracts
    // the files to ~/.karajan/embedded-templates/<version>/ on first use.
    const { collectTemplateFiles } = await import("./esbuild-sea.config.mjs");
    const pkgVersion = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ).version;
    const templateFiles = collectTemplateFiles();
    writeFileSync(
      path.join(DIST, "templates-index.json"),
      JSON.stringify({ version: pkgVersion, files: templateFiles }),
    );
    // Absolute paths: node resolves asset paths against the CWD (not the
    // config file), so anything relative is ambiguous.
    const assets = { "templates-index.json": path.join(DIST, "templates-index.json") };
    for (const rel of templateFiles) {
      assets[`templates/${rel}`] = path.join(ROOT, "templates", rel);
    }
    console.log(`      -> ${templateFiles.length} template assets embedded.`);
    const seaConfig = {
      main: "dist/kj-bundle.cjs",
      output: "dist/sea-prep.blob",
      disableExperimentalSEAWarning: true,
      assets,
    };
    writeFileSync(
      path.join(DIST, "sea-config.json"),
      JSON.stringify(seaConfig, null, 2),
    );
    run("node --experimental-sea-config dist/sea-config.json");
    console.log("      -> dist/sea-prep.blob created.\n");

    // ── Step 3: Copy node binary ────────────────────────────────────
    console.log("[3/5] Copying node binary...");
    cpSync(process.execPath, binaryPath);
    console.log(`      -> ${binaryName} copied.\n`);

    // ── Step 3.5: Remove signature on macOS (required before postject)
    if (isMac) {
      console.log("[3.5] Removing macOS code signature...");
      run(`codesign --remove-signature ${binaryPath}`);
      console.log("      -> Signature removed.\n");
    }

    // ── Step 4: Inject blob with postject ───────────────────────────
    console.log("[4/5] Injecting SEA blob with postject...");
    // On macOS the blob MUST land as section NODE_SEA_BLOB inside a segment
    // named NODE_SEA. Without --macho-segment-name postject writes it to a
    // default segment the SEA loader never inspects, so the binary segfaults
    // on startup (KJC-BUG-0096, nodejs/postject#76). The flag is Mach-O only —
    // ELF (Linux) and PE (Windows) don't take it — so add it only on macOS.
    const postjectCmd = [
      `npx postject ${binaryPath}`,
      "NODE_SEA_BLOB dist/sea-prep.blob",
      "--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      ...(isMac ? ["--macho-segment-name NODE_SEA"] : []),
    ].join(" ");
    run(postjectCmd);
    console.log("      -> Blob injected.\n");

    // ── Step 4.5: Re-sign on macOS ──────────────────────────────────
    if (isMac) {
      console.log("[4.5] Re-signing binary (ad-hoc)...");
      run(`codesign --sign - ${binaryPath}`);
      console.log("      -> Binary signed.\n");
    }

    // ── Done ────────────────────────────────────────────────────────
    const stat = statSync(binaryPath);
    console.log("[5/5] Done!");
    console.log(`      Binary: ${binaryPath}`);
    console.log(`      Size:   ${formatBytes(stat.size)}`);
    console.log("");
  } catch (err) {
    console.error("\n=== SEA Build FAILED ===\n");
    console.error(err.message || err);
    console.error(
      "\nNote: esbuild may fail to bundle certain ESM-only dependencies",
    );
    console.error(
      "or native modules. Check the error above for details.\n",
    );
    process.exit(1);
  }
}

main();
