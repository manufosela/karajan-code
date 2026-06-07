import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

import { runCli } from "../src/cli.js";
import { loadManifest, saveManifest } from "../src/manifest.js";
import { snapshotFile } from "../src/snapshot.js";
import { snapshotGitBundle } from "../src/git-snapshot.js";

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeGitRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-cli-repo-"));
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.invalid"], dir);
  git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README"), "v1");
  git(["add", "README"], dir);
  git(["commit", "-q", "-m", "initial"], dir);
  return dir;
}

class StringSink {
  constructor() {
    this.text = "";
  }
  write(chunk) {
    this.text += chunk;
    return true;
  }
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
      out,
      err: new StringSink(),
      root,
    });
    expect(code).toBe(0);
    expect(await readFile(target, "utf8")).toBe("data");
    const m = await loadManifest(root);
    expect(m.entries.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it("restore on a git-bundle entry fetches refs into refs/remotes/restore/* and keeps the entry", async () => {
    const root = await makeRoot();
    const repo = await makeGitRepo();
    const headBefore = git(["rev-parse", "HEAD"], repo);
    const entry = await snapshotGitBundle(root, repo);
    const m = await loadManifest(root);
    m.entries.push(entry);
    await saveManifest(root, m);

    await writeFile(join(repo, "README"), "v2");
    git(["add", "README"], repo);
    git(["commit", "-q", "-m", "second"], repo);
    git(["reset", "--hard", "HEAD~1"], repo);

    const out = new StringSink();
    const code = await runCli(["restore", entry.id], {
      out,
      err: new StringSink(),
      root,
    });
    expect(code).toBe(0);
    expect(out.text).toMatch(/fetched bundle/);
    expect(git(["rev-parse", "refs/remotes/restore/main"], repo)).toBe(headBefore);
    const post = await loadManifest(root);
    expect(post.entries.find((e) => e.id === entry.id)).toBeDefined();
  });

  it("no args prints usage with non-zero exit", async () => {
    const root = await makeRoot();
    const out = new StringSink();
    expect(await runCli([], { out, err: new StringSink(), root })).toBe(2);
    expect(out.text).toContain("usage: kj-trash");
  });
});
