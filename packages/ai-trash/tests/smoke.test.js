// Smoke test for @karajan/ai-trash skeleton (KJC-TSK-0388 commit 1).
// Confirms the package can be imported, exposes `version` + `name`, and that
// its package.json registers the `kj-trash` bin entry. Real behaviour (snapshot,
// restore, list, manifest) lands in later commits.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

import * as aiTrash from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

describe("@karajan/ai-trash skeleton", () => {
  it("exposes version + name matching package.json", () => {
    expect(aiTrash.version).toBe(pkg.version);
    expect(aiTrash.name).toBe(pkg.name);
    expect(aiTrash.name).toBe("@karajan/ai-trash");
  });

  it("registers the kj-trash bin entry", () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin["kj-trash"]).toBe("bin/kj-trash.js");
  });

  // Floor aligned with KJC-BUG-0111 (#1213): 22.12.0 is the runtime-real
  // minimum — the old >=22.22.1 silently pushed installers to an ancient kj.
  it("declares AGPL-3.0 license and the runtime-real node floor", () => {
    expect(pkg.license).toBe("AGPL-3.0");
    expect(pkg.engines?.node).toBe(">=22.12.0");
  });
});
