import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadGoldenTasks } from "../../src/golden/loader.js";

const taskJson = (id, overrides = {}) => JSON.stringify({
  id, title: `Task ${id}`, prompt: `Build ${id}`,
  expected_commits_min: 2, expected_audit_status: "pass",
  expected_test_files: ["tests/x.test.js"], allowed_loc_range: [50, 200],
  ...overrides,
});

describe("golden/loader", () => {
  let tmp;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-golden-")); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

  it("returns [] for an empty directory", async () => {
    expect((await loadGoldenTasks(tmp)).tasks).toEqual([]);
  });

  it("loads multiple valid files in deterministic (filename) order", async () => {
    await fs.writeFile(path.join(tmp, "b.json"), taskJson("two"));
    await fs.writeFile(path.join(tmp, "a.json"), taskJson("one"));
    const { tasks } = await loadGoldenTasks(tmp);
    expect(tasks.map((t) => t.id)).toEqual(["one", "two"]);
  });

  it("ignores non-json files", async () => {
    await fs.writeFile(path.join(tmp, "a.json"), taskJson("one"));
    await fs.writeFile(path.join(tmp, "README.md"), "ignore me");
    expect((await loadGoldenTasks(tmp)).tasks).toHaveLength(1);
  });

  it("aggregates errors across multiple bad files", async () => {
    await fs.writeFile(path.join(tmp, "ok.json"), taskJson("ok"));
    await fs.writeFile(path.join(tmp, "broken.json"), "{not json");
    await fs.writeFile(path.join(tmp, "invalid.json"), JSON.stringify({ id: "" }));
    await expect(loadGoldenTasks(tmp)).rejects.toThrow(/broken\.json[\s\S]+invalid\.json/);
  });

  it("rejects duplicate ids across files", async () => {
    await fs.writeFile(path.join(tmp, "a.json"), taskJson("dup"));
    await fs.writeFile(path.join(tmp, "b.json"), taskJson("dup"));
    await expect(loadGoldenTasks(tmp)).rejects.toThrow(/duplicate id "dup"/);
  });

  it("throws a descriptive error when the directory does not exist", async () => {
    await expect(loadGoldenTasks(path.join(tmp, "nope"))).rejects.toThrow(/not readable/);
  });
});
