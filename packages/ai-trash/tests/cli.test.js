import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

import { runCli } from "../src/cli.js";
import { loadManifest, saveManifest } from "../src/manifest.js";
import { snapshotFile } from "../src/snapshot.js";

class StringSink {
  constructor() { this.text = ""; }
  write(chunk) { this.text += chunk; return true; }
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-cli-"));
}

async function makeSnapshot(root, contents = "data") {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-cli-src-"));
  const src = join(dir, "file.txt");
  await writeFile(src, contents);
  const entry = await snapshotFile(root, src);
  const m = await loadManifest(root);
  m.entries.push(entry);
  await saveManifest(root, m);
  return { entry, src };
}

describe("kj-trash CLI", () => {
  it("list reports (empty) when nothing is stored", async () => {
    const root = await makeRoot();
    const out = new StringSink();
    const code = await runCli(["list"], { out, err: new StringSink(), root });
    expect(code).toBe(0);
    expect(out.text).toContain("(empty)");
  });

  it("list prints stored entries with id and source", async () => {
    const root = await makeRoot();
    const { entry, src } = await makeSnapshot(root);
    const out = new StringSink();
    const code = await runCli(["list"], { out, err: new StringSink(), root });
    expect(code).toBe(0);
    expect(out.text).toContain(entry.id);
    expect(out.text).toContain(src);
  });

  it("inspect prints JSON for a known id and 1 for unknown", async () => {
    const root = await makeRoot();
    const { entry } = await makeSnapshot(root);
    const out = new StringSink();
    const err = new StringSink();
    expect(await runCli(["inspect", entry.id], { out, err, root })).toBe(0);
    expect(JSON.parse(out.text).id).toBe(entry.id);
    out.text = "";
    expect(await runCli(["inspect", "ZZZ"], { out, err, root })).toBe(1);
    expect(err.text).toMatch(/no entry/);
  });

  it("restore drops the entry from the manifest and writes the file", async () => {
    const root = await makeRoot();
    const { entry, src } = await makeSnapshot(root);
    const target = join(dirname(src), "restored.txt");
    const out = new StringSink();
    const code = await runCli(["restore", entry.id, "--to", target], {
      out, err: new StringSink(), root,
    });
    expect(code).toBe(0);
    expect(await readFile(target, "utf8")).toBe("data");
    const m = await loadManifest(root);
    expect(m.entries.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it("no args prints usage with non-zero exit", async () => {
    const root = await makeRoot();
    const out = new StringSink();
    expect(await runCli([], { out, err: new StringSink(), root })).toBe(2);
    expect(out.text).toContain("usage: kj-trash");
  });
});
