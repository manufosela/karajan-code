// KJC-TSK-0681 (issue #1306) — the generated rules teach environment
// isolation for parallel lanes, and worktree_setup is documented where it
// is declared. Pins the templates so a future rewrite can't drop them.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(root, "templates", f), "utf8");

describe("environment isolation templates (KJC-TSK-0681)", () => {
  it("coder-rules teach lane isolation via KJ_LANE_SLOT/KJ_PORT_OFFSET", () => {
    const text = read("coder-rules.md");
    expect(text).toMatch(/Environment isolation/);
    expect(text).toMatch(/KJ_LANE_SLOT/);
    expect(text).toMatch(/\.env\.example/);
  });

  it("review-rules reject hardcoded resources and committed .env", () => {
    const text = read("review-rules.md");
    expect(text).toMatch(/Environment isolation/);
    expect(text).toMatch(/hardcode ports/i);
  });

  it("worktree_setup is documented inline in the example config", () => {
    const text = read("kj.config.yml");
    expect(text).toMatch(/worktree_setup: null/);
    expect(text).toMatch(/KJ_LANE_SLOT/);
  });
});
