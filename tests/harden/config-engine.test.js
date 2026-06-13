import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installConfigs } from "../../src/harden/config-engine.js";

let dir;
const read = (f) => readFileSync(join(dir, f), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-cfg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("installConfigs", () => {
  it("seeds editorconfig (markered), commitlint (markered) and prettier (json)", () => {
    const res = installConfigs({ projectDir: dir });
    expect(res.configs.every((c) => c.action === "inserted")).toBe(true);

    const ec = read(".editorconfig");
    expect(ec).toContain(">>> kj:managed:editorconfig v1 >>>");
    expect(ec).toContain("root = true");

    expect(read("commitlint.config.js")).toContain("config-conventional");
    expect(JSON.parse(read(".prettierrc.json"))).toMatchObject({ printWidth: 110 });
  });

  it("is idempotent on the markered files", () => {
    installConfigs({ projectDir: dir });
    const res = installConfigs({ projectDir: dir });
    const ec = res.configs.find((c) => c.file === ".editorconfig");
    expect(ec.action).toBe("unchanged");
  });

  it("never overwrites a user-authored config without our marker", () => {
    writeFileSync(join(dir, ".editorconfig"), "root = true\n[*]\nindent_size = 4\n");
    const res = installConfigs({ projectDir: dir });
    expect(res.configs.find((c) => c.file === ".editorconfig").action).toBe("skipped");
    expect(read(".editorconfig")).toContain("indent_size = 4");
    expect(read(".editorconfig")).not.toContain("kj:managed");
  });

  it("leaves a pre-existing prettier json untouched (seed-only)", () => {
    writeFileSync(join(dir, ".prettierrc.json"), '{"printWidth":80}');
    const res = installConfigs({ projectDir: dir });
    expect(res.configs.find((c) => c.file === ".prettierrc.json").action).toBe("skipped");
    expect(JSON.parse(read(".prettierrc.json")).printWidth).toBe(80);
  });

  it("dry-run writes nothing", () => {
    const res = installConfigs({ projectDir: dir, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(existsSync(join(dir, ".editorconfig"))).toBe(false);
    expect(existsSync(join(dir, ".prettierrc.json"))).toBe(false);
  });
});
