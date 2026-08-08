import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installConfigs } from "../../src/harden/config-engine.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-eslint-"));
  // KJC-BUG-0137: the seeded eslint config demands the tool be present.
  writeFileSync(join(dir, "package.json"), '{"devDependencies":{"eslint":"^9","prettier":"^3"}}');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function lint(code) {
  installConfigs({ projectDir: dir });
  const eslint = new ESLint({ overrideConfigFile: join(dir, "eslint.config.js"), cwd: dir });
  const [result] = await eslint.lintText(code, { filePath: join(dir, "sample.js") });
  return result;
}

describe("seeded eslint.config.js (ES2025 deprecated-API blacklist)", () => {
  it("is seeded with a managed marker", () => {
    installConfigs({ projectDir: dir });
    expect(readFileSync(join(dir, "eslint.config.js"), "utf8")).toContain(">>> kj:managed:eslint v1 >>>");
  });

  it("flags document.write, escape, substr and var", async () => {
    const result = await lint("document.write('x'); var y = escape('z'); 'a'.substr(1);");
    const rules = result.messages.map((m) => m.ruleId);
    expect(rules).toContain("no-restricted-properties"); // document.write + substr
    expect(rules).toContain("no-restricted-globals"); // escape
    expect(rules).toContain("no-var");
    expect(result.errorCount).toBeGreaterThanOrEqual(3);
  });

  it("passes clean modern code with zero errors", async () => {
    const result = await lint("const url = encodeURIComponent('z');\ndocument.body.append(url);\n");
    expect(result.errorCount).toBe(0);
  });
});
