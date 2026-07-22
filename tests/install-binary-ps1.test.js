// KJC-TSK-0667 — the Windows installer must match the sh installer's
// npm-first contract: full product by default, SEA binary as explicit opt-in.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(`${process.cwd()}/scripts/install-binary.ps1`, "utf8");

describe("install-binary.ps1 npm-first parity — KJC-TSK-0667", () => {
  it("defaults to the npm route (full product)", () => {
    expect(script).toMatch(/npm install -g/);
    expect(script).toMatch(/full product/i);
  });

  it("gates the standalone binary behind KJ_STANDALONE and states its limits", () => {
    expect(script).toMatch(/KJ_STANDALONE/);
    expect(script).toMatch(/NO native-module features/i);
  });

  it("provisions the official Node LTS checksum-verified when Node is missing", () => {
    expect(script).toMatch(/SHASUMS256\.txt/);
    expect(script).toMatch(/node-v\[0-9\.\]\+-win-x64\\\.zip/);
    expect(script).toMatch(/Get-FileHash/);
    expect(script).toMatch(/checksum mismatch/i);
  });

  it("stages the install and keeps the previous one recoverable (backup + restore)", () => {
    expect(script).toMatch(/\.staging\./);
    expect(script).toMatch(/\.old\./);
    expect(script).toMatch(/previous install restored/i);
  });

  it("requires Node >= 22.12, same floor as the sh installer", () => {
    expect(script).toMatch(/nodeMajor = 22/);
    expect(script).toMatch(/nodeMinMinor = 12/);
  });

  it("stays Windows PowerShell 5.1 compatible (no pwsh-7-only ternary)", () => {
    expect(script).not.toMatch(/\?\s[^:]+\s:/); // `cond ? a : b` is pwsh 7+
  });

  it("ends pointing at doctor + install-tools, like the sh installer", () => {
    expect(script).toMatch(/kj doctor/);
    expect(script).toMatch(/kj install-tools/);
  });
});
