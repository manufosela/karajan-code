// ADR 0021, plan step 13a2-i: fetchPlugin puts a plugin at a pinned commit into the cache and
// records it in state.json. Git is always a fake: no real git, no network.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAFE } from "../src/fetch.js";
import { fetchPlugin } from "../src/plugin-fetch.js";

const C1 = "a".repeat(40);
const C2 = "b".repeat(40);
let dir;
let calls;
let manifest;
let remote; // what `ls-remote` answers
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-plugin-fetch-"));
  calls = [];
  remote = "";
  manifest = { name: "lint-kit", version: "1.2.0" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// strips SAFE, writes a plugin tree on `fetch`, answers `rev-parse` with the fetched commit
const git = (args, cwd) => {
  const [verb, ...rest] = args.slice(SAFE.length);
  calls.push([verb, ...rest]);
  if (verb === "fetch") {
    mkdirSync(join(cwd, ".claude-plugin"), { recursive: true });
    mkdirSync(join(cwd, ".git"), { recursive: true });
    if (manifest) writeFileSync(join(cwd, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(cwd, "commit"), rest.at(-1));
  }
  if (verb === "ls-remote") {
    // like git: a line is answered only when a pattern is its ref name or a tail of it
    const patterns = rest.slice(1);
    return remote.split("\n").filter((line) => patterns.some((p) => line.split("\t")[1] === p || line.split("\t")[1]?.endsWith(`/${p}`))).map((line) => `${line}\n`).join("");
  }
  return verb === "rev-parse" ? `${readFileSync(join(cwd, "commit"), "utf8")}\n` : "";
};
const o = (extra) => ({ projectDir: dir, root: "store", ...extra });
const fetchIt = (spec, extra) => fetchPlugin(spec, o(extra), { git });
const copy = (version) => join(dir, "store", "plugins", "lint-kit", version);
const state = () => readFileSync(join(dir, "store", "plugins", "lint-kit", "state.json"), "utf8");

describe("fetchPlugin (git sources)", () => {
  it("fetches a pinned github plugin into plugins/<name>/<version>/ and records its state", () => {
    const result = fetchIt("acme/lint-kit", { commit: C1 });
    expect(result).toEqual({ name: "lint-kit", version: "1.2.0", commit: C1, dir: copy("1.2.0"), status: "fetched" });
    expect(existsSync(join(copy("1.2.0"), ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(copy("1.2.0"), ".git"))).toBe(false);
    expect(calls.find(([verb]) => verb === "fetch")).toEqual(["fetch", "--quiet", "--depth", "1", "https://github.com/acme/lint-kit.git", C1]);
    expect(JSON.parse(state())).toEqual({ name: "lint-kit", version: "1.2.0", commit: C1, source: { type: "github", repo: "acme/lint-kit" } });
    expect(Object.keys(JSON.parse(state()))).toEqual(["commit", "name", "source", "version"]);
    expect(readdirSync(join(dir, "store", "plugins"))).toEqual(["lint-kit"]);
  });

  it("takes a 40-hex ref as the pin, and a git url as is", () => {
    const result = fetchIt({ source: "url", url: "https://example.com/x.git", ref: C2 });
    expect(result.commit).toBe(C2);
    expect(calls.find(([verb]) => verb === "fetch").at(-2)).toBe("https://example.com/x.git");
  });

  it("never calls git again for a name already cached at that commit", () => {
    fetchIt("acme/lint-kit", { commit: C1 });
    calls.length = 0;
    expect(fetchIt("acme/lint-kit", { commit: C1, name: "lint-kit" }).status).toBe("cached");
    expect(calls).toEqual([]);
  });

  it("drops the staging copy when the target already holds that commit", () => {
    fetchIt("acme/lint-kit", { commit: C1 });
    expect(fetchIt("acme/lint-kit", { commit: C1 }).status).toBe("cached");
    expect(readdirSync(join(dir, "store", "plugins"))).toEqual(["lint-kit"]);
  });

  it("refuses the same version at another commit and leaves the old copy intact", () => {
    fetchIt("acme/lint-kit", { commit: C1 });
    expect(() => fetchIt("acme/lint-kit", { commit: C2 })).toThrow(`lint-kit@1.2.0 is cached at ${C1}, not ${C2}`);
    expect(JSON.parse(state()).commit).toBe(C1);
    expect(readFileSync(join(copy("1.2.0"), "commit"), "utf8")).toBe(C1);
  });

  it("falls back to the first 12 characters of the commit when the manifest has no version", () => {
    manifest = { name: "lint-kit" };
    expect(fetchIt("acme/lint-kit", { commit: C1 }).dir).toBe(copy("a".repeat(12)));
  });

  it("rejects a commit that is not 40 hex characters before any git call", () => {
    for (const commit of ["--upload-pack=x", "abc123", "A".repeat(40), "a".repeat(41), [C1]]) expect(() => fetchIt("acme/lint-kit", { commit })).toThrow(/pinned commit/);
    expect(calls).toEqual([]);
  });

  it("will not name another version's commit it does not know, nor take state.json as a version", () => {
    fetchIt("acme/lint-kit", { commit: C1 });
    manifest = { name: "lint-kit", version: "1.3.0" };
    fetchIt("acme/lint-kit", { commit: C2 });
    manifest = { name: "lint-kit", version: "1.2.0" };
    expect(() => fetchIt("acme/lint-kit", { commit: C1 })).toThrow(`lint-kit@1.2.0 is cached at an unknown commit, not ${C1}`);
    manifest = { name: "lint-kit", version: "state.json" };
    expect(() => fetchIt("acme/lint-kit", { commit: C1 })).toThrow(/invalid plugin version/);
  });

  it("fails on a name that is unsafe or differs from the manifest's, leaving no staging folder", () => {
    expect(() => fetchIt("acme/lint-kit", { commit: C1, name: "../../x" })).toThrow(/invalid plugin name/);
    expect(() => fetchIt("acme/lint-kit", { commit: C1, name: "other" })).toThrow('the plugin is named "lint-kit", not "other"');
    expect(readdirSync(join(dir, "store", "plugins"))).toEqual([]);
  });

  it("names the source and removes staging when git or the manifest fails", () => {
    const broken = () => {
      throw new Error("boom");
    };
    expect(() => fetchPlugin("acme/lint-kit", o({ commit: C1 }), { git: broken })).toThrow(/acme\/lint-kit.*boom/);
    manifest = null;
    expect(() => fetchIt("acme/lint-kit", { commit: C1 })).toThrow(/acme\/lint-kit.*no plugin manifest/);
    expect(readdirSync(join(dir, "store", "plugins"))).toEqual([]);
  });

  it("refuses a marketplace", () => {
    expect(() => fetchIt("https://example.com/marketplace.json")).toThrow(/is a marketplace, not a plugin/);
  });
});

describe("fetchPlugin (ls-remote)", () => {
  it("resolves a ref or HEAD through ls-remote and fetches that commit", () => {
    remote = `${C1}\trefs/heads/main\n`;
    expect(fetchIt("acme/lint-kit#main").commit).toBe(C1);
    expect(calls[0]).toEqual(["ls-remote", "https://github.com/acme/lint-kit.git", "main", "main^{}"]);
    expect(calls.find(([verb]) => verb === "fetch").at(-1)).toBe(C1);
    calls.length = 0;
    remote = `${C2}\tHEAD\n`;
    manifest = { name: "lint-kit", version: "2.0.0" };
    expect(fetchIt("acme/other-kit").commit).toBe(C2);
    expect(calls[0].slice(-2)).toEqual(["HEAD", "HEAD^{}"]);
  });

  it("takes the commit an annotated tag points at", () => {
    remote = `${C2}\trefs/tags/v1\n${C1}\trefs/tags/v1^{}\n`;
    expect(fetchIt("acme/lint-kit#v1").commit).toBe(C1);
  });

  it("does not ask the remote when the commit is already pinned", () => {
    fetchIt("acme/lint-kit#main", { commit: C1 });
    manifest = { name: "lint-kit", version: "2.0.0" };
    fetchIt({ source: "url", url: "https://example.com/x.git", ref: C2 });
    expect(calls.some(([verb]) => verb === "ls-remote")).toBe(false);
  });

  it("fails on no match, several matches or an answer that is not a commit, before any fetch", () => {
    for (const [answer, message] of [["", /no commit matches "main"/], [`${C1}\trefs/heads/main\n${C2}\trefs/tags/main\n`, /matches 2 refs/], ["--upload-pack=x\trefs/heads/main\n", /not a commit/]]) {
      remote = answer;
      expect(() => fetchIt("acme/lint-kit#main")).toThrow(message);
    }
    expect(calls.some(([verb]) => verb === "fetch")).toBe(false);
  });
});

describe("fetchPlugin (local path)", () => {
  const plugin = (at = "local-plugin") => {
    mkdirSync(join(dir, at, ".claude-plugin"), { recursive: true });
    mkdirSync(join(dir, at, ".git"), { recursive: true });
    writeFileSync(join(dir, at, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, at, "rule.md"), "v1");
  };

  it("copies it without .git or git, with no commit, and copies it again on every call", () => {
    plugin();
    expect(fetchIt("./local-plugin")).toEqual({ name: "lint-kit", version: "1.2.0", commit: null, dir: copy("1.2.0"), status: "fetched" });
    expect(existsSync(join(copy("1.2.0"), ".git"))).toBe(false);
    writeFileSync(join(dir, "local-plugin", "rule.md"), "v2");
    expect(fetchIt("./local-plugin", { name: "lint-kit" }).status).toBe("fetched");
    expect(readFileSync(join(copy("1.2.0"), "rule.md"), "utf8")).toBe("v2");
    expect(calls).toEqual([]);
    expect(readdirSync(join(dir, "store", "plugins"))).toEqual(["lint-kit"]);
  });

  it("records the path relative to the project, or `local` outside it, never an absolute one", () => {
    manifest = { name: "lint-kit" };
    plugin();
    fetchIt("./local-plugin");
    expect(JSON.parse(state())).toEqual({ name: "lint-kit", version: "local", commit: null, source: { type: "path", path: "local-plugin" } });
    plugin("elsewhere");
    mkdirSync(join(dir, "proj"));
    fetchPlugin(join(dir, "elsewhere"), o({ projectDir: join(dir, "proj") }), { git });
    const text = readFileSync(join(dir, "proj", "store", "plugins", "lint-kit", "state.json"), "utf8");
    expect(JSON.parse(text).source).toEqual({ type: "path", path: "local" });
    expect(text).not.toContain(dir);
  });

  it("never replaces a git copy of the same name and version, nor leaves a backup behind", () => {
    fetchIt("acme/lint-kit", { commit: C1 });
    plugin();
    expect(() => fetchIt("./local-plugin")).toThrow("lint-kit@1.2.0 is cached and is not a local copy");
    expect(readFileSync(join(copy("1.2.0"), "commit"), "utf8")).toBe(C1);
    expect(readdirSync(join(dir, "store", "plugins"))).toEqual(["lint-kit"]);
  });

  it("refuses a symlink anywhere in it before copying", () => {
    plugin();
    symlinkSync("/etc/hosts", join(dir, "local-plugin", "link"));
    expect(() => fetchIt("./local-plugin")).toThrow(/may not hold symlinks/);
    expect(existsSync(join(dir, "store", "plugins"))).toBe(false);
  });
});
