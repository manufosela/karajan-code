// KJC-BUG-0472 (#3072): the docs site loads the analytics script with async. With defer, the
// docs' own deferred scripts wait in order behind it, so a blocked or hung analytics host
// (Cloudflare IPs blocked in Spain on match days) left the docs without their scripts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = readFileSync(fileURLToPath(new URL("../../apps/landing/docs/astro.config.mjs", import.meta.url)), "utf8");

describe("docs analytics — KJC-BUG-0472", () => {
  it("loads the analytics script async, never defer", () => {
    const line = config.split("\n").find((l) => l.includes("analytics.manulitics.com"));
    expect(line).toMatch(/async: true/);
    expect(line).not.toMatch(/defer/);
  });
});
