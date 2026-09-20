// KJC-BUG-0184 (issue #1753): the harness kj writes into .karajan/harness must
// pass a stock ESLint flat config — `@eslint/js` recommended, ES2025 modules,
// no Node globals declared — so `eslint .` stays green right after `kj init`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ESLint } from "eslint";
import js from "@eslint/js";
import globals from "globals";

import { installHarnessHooks } from "../../src/harden/harness-hooks.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

const quiet = { info() {}, warn() {}, error() {} };

describe("generated harness is lint-clean", () => {
  let tmp;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-harness-lint-"));
    installHarnessHooks({ projectDir: tmp, logger: quiet });
    installSentinelHooks({ projectDir: tmp, logger: quiet });
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // With and without Node globals declared: the scripts import process/console
  // explicitly, which must not clash (no-redeclare) where the env IS declared.
  it.each([
    ["no env", {}],
    ["node env", globals.node],
  ])("reports zero ESLint problems under @eslint/js recommended (%s)", async (_label, declared) => {
    const eslint = new ESLint({
      cwd: tmp,
      overrideConfigFile: true,
      overrideConfig: [js.configs.recommended, { languageOptions: { ecmaVersion: 2025, sourceType: "module", globals: declared } }],
    });
    const results = await eslint.lintFiles([".karajan/harness/*.mjs"]);
    expect(results.map((r) => path.basename(r.filePath)).sort()).toEqual(
      ["posttooluse.mjs", "pretooluse-sentinel.mjs", "pretooluse.mjs", "sentinel-lib.mjs", "stop.mjs"],
    );
    const problems = results.flatMap((r) =>
      r.messages.map((m) => `${path.basename(r.filePath)}:${m.line} ${m.ruleId} ${m.message}`),
    );
    expect(problems).toEqual([]);
  });
});
