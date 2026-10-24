// KJC-TSK-1183: over a configurable size, a document reaches the roles as its index, not whole.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexFirstView } from "../../src/docs/index-first.js";
import { readTaskFile, resolveTaskInput } from "../../src/utils/task-file.js";
import { buildCoderPromptLayout } from "../../src/prompts/coder.js";

const LONG = `# Spec\nThe task in one line.\n\n## Billing\n${"b".repeat(300)}\n## Shipping\n${"s".repeat(300)}\n`;

describe("indexFirstView", () => {
  it("is null under the limit or without headings to index, and the preamble plus index over it", () => {
    expect(indexFirstView({ path: "/d/spec.md", text: LONG, limit: 10_000 })).toBeNull();
    expect(indexFirstView({ path: "/d/a.md", text: `# Only one\n${"x".repeat(500)}`, limit: 100 })).toBeNull();
    expect(indexFirstView({ path: "/d/a.md", text: "x".repeat(500), limit: 100 })).toBeNull();
    const view = indexFirstView({ path: "/d/my spec.md", text: LONG, limit: 200 });
    expect(view).toContain("# Spec\nThe task in one line.");
    expect(view).toContain(`${LONG.length} characters, over the 200`);
    expect(view).toContain("- Spec\n  - Billing\n  - Shipping");
    expect(view).toContain(String.raw`kj doc section '/d/my spec.md' "<heading>"`);
    expect(view).not.toContain("bbbb");
  });
});

describe("the task file and the ADRs read by index", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-index-first-")); writeFileSync(join(dir, "task.md"), LONG); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("readTaskFile hands the index over the limit and says so; whole under it or without the option", async () => {
    const said = [];
    const logger = { info: (m) => said.push(m) };
    const view = await readTaskFile("task.md", { projectDir: dir, indexFirstBytes: 200, logger });
    expect(view).toContain("kj doc section");
    expect(said[0]).toMatch(/task\.md read by index/);
    expect(await readTaskFile("task.md", { projectDir: dir, indexFirstBytes: 10_000 })).toBe(LONG.trim());
    expect(await readTaskFile("task.md", { projectDir: dir })).toBe(LONG.trim());
    expect(await resolveTaskInput({ taskFile: "task.md", projectDir: dir, indexFirstBytes: 200 })).toContain("- Billing");
  });

  it("the coder prompt carries a long ADR as its index, and a short one whole", async () => {
    const adrs = [{ id: "0001-long", path: join(dir, "0001-long.md"), markdown: LONG }, { id: "0002-short", path: join(dir, "0002-short.md"), markdown: "# Short\n## A\nkeep\n## B\nall\n" }];
    const layout = await buildCoderPromptLayout({ task: "t", adrs, indexFirstBytes: 200 });
    const text = JSON.stringify(layout);
    expect(text).toContain("kj doc section");
    expect(text).not.toContain("bbbb");
    expect(text).toContain("keep");
  });
});
