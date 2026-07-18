// KJC-TSK-0632: @karajan/hu-board is decoupled from the CLI src tree —
// everything it shares with kj resolves through the karajan-core package.
// A relative import climbing into <repo>/src reintroduces the coupling
// this epic removed, so this test rejects it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const CLI_IMPORT = /import\s*\(?\s*['"](?:\.\.\/)+src\//;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

describe("hu-board decoupling (KJC-TSK-0632)", () => {
  it("no source file imports the CLI src tree", () => {
    const offenders = walk(SRC).filter((f) => CLI_IMPORT.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
