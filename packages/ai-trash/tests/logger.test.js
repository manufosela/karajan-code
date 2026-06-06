import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { appendLogEntry, readLog, redactPath } from "../src/logger.js";
import {
  ensureSecureDir,
  lockdownFile,
  assertOwnedByCurrentUser,
  DIR_MODE,
  FILE_MODE,
} from "../src/permissions.js";

async function tmpRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-log-"));
}

describe("logger", () => {
  it("redacts $HOME to ~ in paths", () => {
    expect(redactPath(homedir())).toBe("~");
    expect(redactPath(join(homedir(), "proj/file.txt"))).toBe("~/proj/file.txt");
    expect(redactPath("/etc/hosts")).toBe("/etc/hosts");
  });

  it("appends JSONL entries with 0o600 permissions and redacted paths", async () => {
    const root = await tmpRoot();
    await appendLogEntry(root, "snapshot.create", {
      sourcePath: join(homedir(), "a.txt"),
      sizeBytes: 4,
    });
    await appendLogEntry(root, "snapshot.purge", { sizeBytes: 4 });
    const log = await readLog(root);
    expect(log).toHaveLength(2);
    expect(log[0].event).toBe("snapshot.create");
    expect(log[0].sourcePath).toBe("~/a.txt");
    expect(log[1].event).toBe("snapshot.purge");
    const info = await stat(join(root, "log.jsonl"));
    expect(info.mode & 0o777).toBe(FILE_MODE);
  });

  it("rejects empty event names", async () => {
    const root = await tmpRoot();
    await expect(appendLogEntry(root, "", {})).rejects.toThrow(/event required/);
  });

  it("returns an empty array when the log does not exist", async () => {
    const root = await tmpRoot();
    expect(await readLog(root)).toEqual([]);
  });
});

describe("permissions", () => {
  it("creates dirs with 0o700 and locks files to 0o600", async () => {
    const root = await tmpRoot();
    const sub = join(root, "store");
    await ensureSecureDir(sub);
    const dirInfo = await stat(sub);
    expect(dirInfo.mode & 0o777).toBe(DIR_MODE);
    const file = join(sub, "x.txt");
    await writeFile(file, "x", { mode: 0o644 });
    await lockdownFile(file);
    const fileInfo = await stat(file);
    expect(fileInfo.mode & 0o777).toBe(FILE_MODE);
  });

  it("accepts files owned by the current user", async () => {
    const root = await tmpRoot();
    await expect(assertOwnedByCurrentUser(root)).resolves.toBeUndefined();
  });
});
