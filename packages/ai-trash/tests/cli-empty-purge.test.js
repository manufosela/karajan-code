import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { runCli } from "../src/cli.js";
import { loadManifest, saveManifest } from "../src/manifest.js";
import { snapshotFile } from "../src/snapshot.js";

class StringSink {
  constructor() { this.text = ""; }
  write(chunk) { this.text += chunk; return true; }
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-cli2-"));
}

async function recordSnapshot(root, contents = "x") {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-cli2-src-"));
  const src = join(dir, "f.txt");
  await writeFile(src, contents);
  const entry = await snapshotFile(root, src);
  const m = await loadManifest(root);
  m.entries.push(entry);
  await saveManifest(root, m);
  return entry;
}

describe("kj-trash purge", () => {
  it("removes a single entry + its store dir", async () => {
    const root = await makeRoot();
    const entry = await recordSnapshot(root);
    const out = new StringSink();
    expect(await runCli(["purge", entry.id], { out, err: new StringSink(), root })).toBe(0);
    expect(out.text).toMatch(/purged/);
    await expect(stat(entry.snapshotPath)).rejects.toThrow();
    const m = await loadManifest(root);
    expect(m.entries).toHaveLength(0);
  });

  it("returns 1 when the id is unknown", async () => {
    const root = await makeRoot();
    const err = new StringSink();
    expect(await runCli(["purge", "ZZZ"], { out: new StringSink(), err, root })).toBe(1);
    expect(err.text).toMatch(/no entry/);
  });
});

describe("kj-trash empty", () => {
  it("drops every snapshot when called without filters", async () => {
    const root = await makeRoot();
    const a = await recordSnapshot(root, "a");
    const b = await recordSnapshot(root, "bb");
    const out = new StringSink();
    expect(await runCli(["empty"], { out, err: new StringSink(), root })).toBe(0);
    expect(out.text).toMatch(/emptied 2/);
    const m = await loadManifest(root);
    expect(m.entries).toHaveLength(0);
    await expect(stat(a.snapshotPath)).rejects.toThrow();
    await expect(stat(b.snapshotPath)).rejects.toThrow();
  });

  it("respects --max-bytes by evicting oldest until the budget fits", async () => {
    const root = await makeRoot();
    const a = await recordSnapshot(root, "x".repeat(100));
    await recordSnapshot(root, "y".repeat(100));
    const out = new StringSink();
    expect(await runCli(["empty", "--max-bytes", "150"], {
      out, err: new StringSink(), root,
    })).toBe(0);
    expect(out.text).toMatch(/emptied 1/);
    const m = await loadManifest(root);
    expect(m.entries.find((e) => e.id === a.id)).toBeUndefined();
    expect(m.entries).toHaveLength(1);
  });
});
