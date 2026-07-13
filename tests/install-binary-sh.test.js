// KJC-BUG-0101 — the standalone installer must let macOS (darwin-arm64)
// through the normal download flow now that the binary ships in the release.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(`${process.cwd()}/scripts/install-binary.sh`, "utf8");

describe("install-binary.sh macOS gating — KJC-BUG-0101", () => {
  it("no longer degrades macOS to the npm path", () => {
    expect(script).not.toMatch(/not available yet/i);
  });

  it("allows darwin-arm64 through the download flow", () => {
    expect(script).toMatch(/darwin-arm64\)\s*;;/);
  });

  it("lists darwin-arm64 as an available prebuilt target", () => {
    expect(script).toMatch(/Available: linux-x64, darwin-arm64/);
  });
});
