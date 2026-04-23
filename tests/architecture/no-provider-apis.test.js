/**
 * Architecture regression guard — Karajan does NOT call provider APIs.
 *
 * Karajan's contract is: every active role spawns its provider's CLI binary
 * as a subprocess (claude / codex / gemini / opencode / aider). The CLIs
 * handle their own auth (OAuth, on-disk tokens). Karajan must never:
 *   1. Add a provider SDK to package.json `dependencies`.
 *   2. Import a provider SDK anywhere under src/.
 *   3. Read provider API keys from process.env in agent / orchestrator
 *      code (only the preflight layer is allowed to *detect* them — and
 *      since v2.7.4 even that no longer reads them).
 *
 * Pre-v2.7.4 the preflight check used to FAIL when ANTHROPIC_API_KEY /
 * OPENAI_API_KEY were missing — even though Karajan never used them — and
 * blocked legitimate runs from Claude Code MCP (where `apiKeySource: "none"`
 * is the norm). This test fails loudly if any future change reintroduces
 * a runtime dependency on the provider APIs.
 *
 * Touch this test only if Karajan's contract changes (e.g. an explicit
 * decision to support a direct-API mode). In that case open a discussion
 * first; this is an architectural invariant, not a style preference.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");

// Provider SDK package names. Anything Karajan should NEVER `import`.
const FORBIDDEN_PACKAGES = [
  "@anthropic-ai/sdk",
  "@anthropic-ai/bedrock-sdk",
  "@anthropic-ai/vertex-sdk",
  "anthropic",
  "openai",
  "@openai/api",
  "@google/generative-ai",
  "@google-cloud/vertexai",
  "google-genai",
  "groq-sdk",
  "@mistralai/mistralai",
  "cohere-ai",
];

// Provider API key env var names. Code may DETECT them (preflight), but
// runtime/agent code should never READ them as the source of truth.
const PROVIDER_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
];

// Files allowed to mention provider keys (preflight-only zone).
const ENV_VAR_ALLOWLIST = new Set([
  "src/utils/provider-env.js",  // metadata: which env vars *would* satisfy a check
  "src/checks/tokens.js",        // post-v2.7.4 still references env names in fix hints
]);

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(p, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

describe("architecture/no-provider-apis — Karajan uses CLIs, not APIs", () => {
  it("package.json `dependencies` contains no provider SDK", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies || {});
    const offenders = deps.filter((d) => FORBIDDEN_PACKAGES.includes(d));
    expect(offenders, `runtime deps must not include provider SDKs: ${offenders.join(", ")}`).toEqual([]);
  });

  it("package.json `devDependencies` also contains no provider SDK", () => {
    // Even devDeps trip people up: a test or build script using the SDK
    // suggests Karajan can/should use it. If you really need it for a one-off
    // script (mocking provider responses), put it in scripts/devtools/ and
    // explicitly opt out below.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.devDependencies || {});
    const offenders = deps.filter((d) => FORBIDDEN_PACKAGES.includes(d));
    expect(offenders, `devDeps must not include provider SDKs: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no source file under src/ imports a provider SDK", () => {
    const files = listJsFiles(SRC_DIR);
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const pkg of FORBIDDEN_PACKAGES) {
        // Match `from "pkg"` and `require("pkg")`. Allow occurrences inside
        // string literals that are not import paths (e.g. comments, error
        // messages) by scoping to import/require contexts.
        const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const importRe = new RegExp(`(?:from|import|require)\\s*\\(?\\s*["']${escaped}["']`);
        if (importRe.test(text)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} imports ${pkg}`);
        }
      }
    }
    expect(offenders, `Karajan must not import provider SDKs:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no source file under src/ reads a provider API key env var (outside the preflight allowlist)", () => {
    const files = listJsFiles(SRC_DIR);
    const offenders = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      if (ENV_VAR_ALLOWLIST.has(rel)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const envVar of PROVIDER_KEY_ENV_VARS) {
        // Match `process.env.NAME` and `process.env["NAME"]`.
        const re = new RegExp(`process\\.env\\.${envVar}\\b|process\\.env\\[\\s*["']${envVar}["']`);
        if (re.test(text)) {
          offenders.push(`${rel} reads process.env.${envVar}`);
        }
      }
    }
    expect(
      offenders,
      `Provider API key env vars are off-limits outside the preflight layer.\n` +
      `If a new file legitimately needs to detect (NOT consume) an env var, add it to ENV_VAR_ALLOWLIST in this test and document why.\n\n` +
      `Offenders:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("checks/tokens.js wires CLI-availability checks, not env-var checks (post-v2.7.4 contract)", async () => {
    // Sanity check on the public function: every check it produces for a
    // provider must be a `cli:<provider>` check, not `token:<provider>`.
    const tokens = await import("../../src/checks/tokens.js");
    const checks = tokens.getTokenChecks({
      roles: { coder: { provider: "claude" }, reviewer: { provider: "openai" } },
    });
    const providerChecks = checks.filter((c) => c.name.startsWith("cli:") || c.name.startsWith("token:"));
    const tokenStyle = providerChecks.filter((c) => c.name.startsWith("token:") && c.name !== "token:gh");
    expect(
      tokenStyle.map((c) => c.name),
      "Provider checks must be CLI-based (`cli:<provider>`), not env-var-based (`token:<provider>`). " +
      "The single legitimate `token:` check is `token:gh` for the auto_pr flow.",
    ).toEqual([]);
    expect(checks.find((c) => c.name === "cli:anthropic")).toBeDefined();
    expect(checks.find((c) => c.name === "cli:openai")).toBeDefined();
  });
});
