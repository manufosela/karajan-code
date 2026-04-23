import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readTaskFile, resolveTaskInput, DEFAULT_TASK_FILE_MAX_BYTES } from "../../src/utils/task-file.js";

const cleanups = [];
afterEach(async () => {
  for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
  cleanups.length = 0;
});

async function mkTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-tf-"));
  cleanups.push(dir);
  return dir;
}

describe("utils/task-file — readTaskFile", () => {
  it("reads a .md file and returns its trimmed content", async () => {
    const dir = await mkTmpDir();
    const file = path.join(dir, "task.md");
    await fs.writeFile(file, "\n\n# Feature\n\nAdd a counter.\n\n");
    const text = await readTaskFile(file);
    expect(text).toBe("# Feature\n\nAdd a counter.");
  });

  it("resolves relative paths against projectDir", async () => {
    const dir = await mkTmpDir();
    await fs.writeFile(path.join(dir, "my-task.md"), "relative ok");
    const text = await readTaskFile("my-task.md", { projectDir: dir });
    expect(text).toBe("relative ok");
  });

  it("resolves relative paths against process.cwd() when no projectDir is given", async () => {
    const dir = await mkTmpDir();
    await fs.writeFile(path.join(dir, "t.md"), "cwd relative");
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const text = await readTaskFile("t.md");
      expect(text).toBe("cwd relative");
    } finally {
      process.chdir(prev);
    }
  });

  it("throws a readable error when the file does not exist", async () => {
    await expect(readTaskFile("/nope/nowhere/missing.md")).rejects.toThrow(/not found/i);
  });

  it("throws when the file is empty (or whitespace-only)", async () => {
    const dir = await mkTmpDir();
    const file = path.join(dir, "blank.md");
    await fs.writeFile(file, "\n   \n\t\n");
    await expect(readTaskFile(file)).rejects.toThrow(/empty/i);
  });

  it("throws when the file exceeds the maxBytes cap", async () => {
    const dir = await mkTmpDir();
    const file = path.join(dir, "huge.md");
    await fs.writeFile(file, "x".repeat(200));
    await expect(readTaskFile(file, { maxBytes: 100 })).rejects.toThrow(/too large/i);
  });

  it("rejects non-string paths", async () => {
    await expect(readTaskFile("")).rejects.toThrow(/non-empty string/);
    await expect(readTaskFile(null)).rejects.toThrow(/non-empty string/);
  });

  it("exposes DEFAULT_TASK_FILE_MAX_BYTES constant", () => {
    expect(DEFAULT_TASK_FILE_MAX_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_TASK_FILE_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe("utils/task-file — resolveTaskInput", () => {
  it("returns the positional task untouched when only it is given", async () => {
    const t = await resolveTaskInput({ task: "quick task" });
    expect(t).toBe("quick task");
  });

  it("reads taskFile when only it is given", async () => {
    const dir = await mkTmpDir();
    const file = path.join(dir, "t.md");
    await fs.writeFile(file, "from file");
    const t = await resolveTaskInput({ taskFile: file });
    expect(t).toBe("from file");
  });

  it("prefers positional task over taskFile when both are given (warns the user)", async () => {
    const dir = await mkTmpDir();
    const file = path.join(dir, "t.md");
    await fs.writeFile(file, "from file");
    const warnings = [];
    const t = await resolveTaskInput({
      task: "inline task",
      taskFile: file,
      logger: { warn: (m) => warnings.push(m) },
    });
    expect(t).toBe("inline task");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/ignoring file/i);
  });

  it("throws when neither task nor taskFile is given", async () => {
    await expect(resolveTaskInput({})).rejects.toThrow(/no task/i);
  });

  it("trims whitespace from the positional task", async () => {
    const t = await resolveTaskInput({ task: "  padded task  \n" });
    expect(t).toBe("padded task");
  });

  it("treats whitespace-only task as absent and falls through to taskFile", async () => {
    const dir = await mkTmpDir();
    const file = path.join(dir, "t.md");
    await fs.writeFile(file, "from file");
    const t = await resolveTaskInput({ task: "   \n  ", taskFile: file });
    expect(t).toBe("from file");
  });
});
