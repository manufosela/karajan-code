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
let layout; // the folder of the plugin inside the fetched repo
let planted; // whether the fetch checks out a symlink
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-plugin-fetch-"));
  calls = [];
  remote = "";
  layout = "";
  planted = false;
  manifest = { name: "lint-kit", version: "1.2.0" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// strips SAFE, writes a plugin tree on `fetch`, answers `rev-parse` with the fetched commit
const git = (args, cwd) => {
  const [verb, ...rest] = args.slice(SAFE.length);
  calls.push([verb, ...rest]);
  if (verb === "fetch") {
    const at = join(cwd, layout); // where the plugin sits in the repo: "" is the root
    mkdirSync(join(at, ".claude-plugin"), { recursive: true });
    mkdirSync(join(cwd, ".git"), { recursive: true });
    if (manifest) writeFileSync(join(at, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
    if (layout) {
      mkdirSync(join(cwd, "plugins", "other"), { recursive: true });
      writeFileSync(join(cwd, "plugins", "other", "x.md"), "x");
      writeFileSync(join(cwd, "README.md"), "root");
    }
    if (planted) symlinkSync("/etc/hosts", join(at, "link"));
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

describe("fetchPlugin (pins)", () => {
  const marketplace = { source: "github", repo: "acme/lint-kit", ref: "main", sha: C1 };

  it("takes the marketplace sha as the pin and never resolves the ref beside it", () => {
    expect(fetchIt(marketplace).commit).toBe(C1);
    expect(calls.some(([verb]) => verb === "ls-remote")).toBe(false);
    expect(calls.find(([verb]) => verb === "fetch").at(-1)).toBe(C1);
    expect(JSON.parse(state()).source).toEqual({ type: "github", repo: "acme/lint-kit", ref: "main", commit: C1 });
  });

  it("accepts an opts.commit that agrees with the sha", () => {
    expect(fetchIt(marketplace, { commit: C1 }).status).toBe("fetched");
  });

  it("refuses pins that disagree, listing each, before any git call", () => {
    expect(() => fetchIt(marketplace, { commit: C2 })).toThrow(/pins disagree.*commit b{40}.*sha a{40}/);
    expect(() => fetchIt({ source: "url", url: "https://example.com/x.git", ref: C1, sha: C2 })).toThrow(/pins disagree.*sha b{40}.*ref a{40}/);
    expect(calls).toEqual([]);
  });

  it("still rejects an invalid opts.commit next to a sha before any git call", () => {
    expect(() => fetchIt(marketplace, { commit: "--upload-pack=x" })).toThrow(/pinned commit/);
    expect(calls).toEqual([]);
  });

  it("never calls git again for a marketplace entry cached at its sha", () => {
    fetchIt(marketplace);
    calls.length = 0;
    expect(fetchIt(marketplace, { name: "lint-kit" }).status).toBe("cached");
    expect(calls).toEqual([]);
  });
});

describe("fetchPlugin (git-subdir)", () => {
  const url = "https://github.com/acme/mono.git";
  const sub = { source: "git-subdir", url, path: "plugins/lint-kit", ref: "main", sha: C1 };
  const left = () => readdirSync(join(dir, "store", "plugins"));

  it("caches exactly <path> at the pinned commit", () => {
    layout = "plugins/lint-kit";
    expect(fetchIt(sub)).toEqual({ name: "lint-kit", version: "1.2.0", commit: C1, dir: copy("1.2.0"), status: "fetched" });
    expect(readdirSync(copy("1.2.0"))).toEqual([".claude-plugin"]);
    expect(calls.some(([verb]) => verb === "ls-remote")).toBe(false);
    expect(calls.find(([verb]) => verb === "fetch").at(-2)).toBe(url);
    expect(left()).toEqual(["lint-kit"]);
    expect(JSON.parse(state()).source).toEqual({ type: "git-subdir", url, path: "plugins/lint-kit", ref: "main", commit: C1 });
    calls.length = 0;
    expect(fetchIt(sub, { name: "lint-kit" }).status).toBe("cached");
    expect(calls).toEqual([]);
  });

  it("refuses a path that is missing, naming url and path, and leaves nothing behind", () => {
    layout = "elsewhere";
    expect(() => fetchIt(sub)).toThrow(/mono\.git \(plugins\/lint-kit\): plugins\/lint-kit is not a folder at a{12}$/);
    expect(left()).toEqual([]);
  });

  it("refuses a path that is a plain file, what a repo symlink becomes", () => {
    layout = "plugins/lint-kit";
    expect(() => fetchIt({ ...sub, path: "plugins/lint-kit/.claude-plugin/plugin.json" })).toThrow(/is not a folder/);
    expect(left()).toEqual([]);
  });

  it("never caches git internals: .git is gone before the folder check", () => {
    layout = "plugins/lint-kit";
    expect(() => fetchIt({ ...sub, path: ".git" })).toThrow(/\.git is not a folder/);
    expect(left()).toEqual([]);
  });

  it("refuses a symlink inside the folder and caches nothing", () => {
    layout = "plugins/lint-kit";
    planted = true;
    expect(() => fetchIt(sub)).toThrow(/may not hold symlinks/);
    expect(left()).toEqual([]);
  });

  it("refuses an unsafe path before any git call", () => {
    for (const path of ["../x", "/etc", "a/../b", "a//b", ".", "a\\b"]) expect(() => fetchIt({ ...sub, path })).toThrow(/unknown plugin source/);
    expect(calls).toEqual([]);
  });

  it("names url and path when git fails and leaves the plugins folder empty", () => {
    const broken = () => {
      throw new Error("boom");
    };
    expect(() => fetchPlugin(sub, o(), { git: broken })).toThrow(/mono\.git \(plugins\/lint-kit\).*boom/);
    expect(left()).toEqual([]);
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
