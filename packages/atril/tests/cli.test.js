// HU-0006 (ADR 0021, plan step 1): atril runs on its own and says its version.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("atril CLI", () => {
  it("is published as @karajan-family/atril with the bin atril", () => {
    expect(PKG.name).toBe("@karajan-family/atril");
    expect(PKG.bin).toEqual({ atril: "bin/atril.js" });
  });

  it("--version prints the package version", () => {
    expect(VERSION).toBe(PKG.version);
    expect(execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf8" }).trim()).toBe(PKG.version);
  });

  it("an unknown command fails loudly with the usage", () => {
    const res = spawnSync(process.execPath, [BIN, "nope"], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/unknown command "nope"/);
    expect(res.stderr).toMatch(/Usage: atril/);
  });
});
