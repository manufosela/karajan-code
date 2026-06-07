// End-to-end smoke for @karajan/ai-trash (KJC-TSK-0388 commit 7).
// Walks the full pipeline against a sandbox root: snapshot a file via the
// programmatic API, then drive the CLI dispatcher through list -> inspect ->
// restore -> re-snapshot -> empty, and finally assert the JSONL audit log
// captured every event with redacted paths.

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

import { runCli } from "../src/cli.js";
import { loadManifest, saveManifest } from "../src/manifest.js";
import { snapshotFile } from "../src/snapshot.js";
import { readLog } from "../src/logger.js";

class StringSink {
  constructor() { this.text = ""; }
  write(chunk) { this.text += chunk; return true; }
}

async function recordSnapshot(root, contents) {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-e2e-src-"));
  const src = join(dir, "note.txt");
  await writeFile(src, contents);
  const entry = await snapshotFile(root, src);
  const m = await loadManifest(root);
  m.entries.push(entry);
  await saveManifest(root, m);
  return { entry, src };
}

describe("@karajan/ai-trash end-to-end", () => {
  it("walks snapshot -> list -> inspect -> restore -> empty and audits each step", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-trash-e2e-"));

    const { entry: first, src } = await recordSnapshot(root, "hello world");

    const listOut = new StringSink();
    expect(await runCli(["list"], { out: listOut, err: new StringSink(), root })).toBe(0);
    expect(listOut.text).toContain(first.id);
    expect(listOut.text).toContain(src);

    const inspectOut = new StringSink();
    expect(await runCli(["inspect", first.id], {
      out: inspectOut, err: new StringSink(), root,
    })).toBe(0);
    const parsed = JSON.parse(inspectOut.text);
    expect(parsed.id).toBe(first.id);
    expect(parsed.sourcePath).toBe(src);

    const target = join(dirname(src), "note.restored.txt");
    expect(await runCli(["restore", first.id, "--to", target], {
      out: new StringSink(), err: new StringSink(), root,
    })).toBe(0);
    expect(await readFile(target, "utf8")).toBe("hello world");
    const afterRestore = await loadManifest(root);
    expect(afterRestore.entries.find((e) => e.id === first.id)).toBeUndefined();

    const { entry: second } = await recordSnapshot(root, "ephemeral");

    const emptyOut = new StringSink();
    expect(await runCli(["empty"], { out: emptyOut, err: new StringSink(), root })).toBe(0);
    expect(emptyOut.text).toMatch(/emptied 1/);
    await expect(stat(second.snapshotPath)).rejects.toThrow();
    const afterEmpty = await loadManifest(root);
    expect(afterEmpty.entries).toHaveLength(0);

    const log = await readLog(root);
    const events = log.map((l) => l.event);
    expect(events).toEqual([
      "snapshot.create",
      "snapshot.restore",
      "snapshot.create",
      "snapshot.purge",
    ]);
    for (const line of log) {
      for (const [k, v] of Object.entries(line)) {
        if (typeof v === "string" && (k.includes("Path") || k === "cwd")) {
          expect(v.startsWith("/home/")).toBe(false);
        }
      }
    }
  });
});
