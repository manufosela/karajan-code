// ADR 0021, plan step 13g1-i: plugin dependencies are read from a manifest and put in install
// order. Pure: plain objects in, names out. No disk, git or network.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dependencyOrder, installNpmDeps, npmLockfile, pluginDependencies } from "../src/plugin-deps.js";

const plugin = (name, dependencies) => ({ name, manifest: { name, ...(dependencies && { dependencies }) } });

describe("pluginDependencies", () => {
  it("is empty when the manifest declares none", () => {
    expect(pluginDependencies({ name: "a" })).toEqual([]);
  });

  it("reads the string, name@marketplace and object forms", () => {
    const deps = pluginDependencies({ dependencies: ["b", "c@market", { name: "d", marketplace: "m", version: "^1.2" }] });
    expect(deps).toEqual([{ name: "b" }, { name: "c", marketplace: "market" }, { name: "d", marketplace: "m", version: "^1.2" }]);
  });

  it("splits on the last @, so a name holding an @ is rejected", () => {
    expect(() => pluginDependencies({ dependencies: ["a@b@c"] })).toThrow('dependencies[0] ("a@b@c")');
  });

  it("throws when dependencies is not a list", () => {
    expect(() => pluginDependencies({ dependencies: "b" })).toThrow("dependencies must be a list");
  });

  it.each([
    [["ok", "Bad Name"], 'dependencies[1] ("Bad Name")'],
    [["a@Bad"], 'dependencies[0] ("a@Bad")'],
    [[{ name: "a", version: "" }], "the version must be a non-empty string"],
    [[{ name: "a", version: 2 }], "the version must be a non-empty string"],
    [[42], "dependencies[0] (42)"],
  ])("rejects a bad entry %j naming its index", (dependencies, message) => {
    expect(() => pluginDependencies({ dependencies })).toThrow(message);
  });
});

describe("dependencyOrder", () => {
  it("puts each plugin after the ones it needs", () => {
    expect(dependencyOrder([plugin("c", ["b"]), plugin("a"), plugin("b", ["a"])])).toEqual(["a", "b", "c"]);
  });

  it("keeps the input order between independent plugins", () => {
    expect(dependencyOrder([plugin("z"), plugin("m"), plugin("a")])).toEqual(["z", "m", "a"]);
  });

  it("orders ties by input position, not by how a manifest lists its dependencies", () => {
    expect(dependencyOrder([plugin("a", ["c", "b"]), plugin("b"), plugin("c")])).toEqual(["b", "c", "a"]);
  });

  it("emits a shared dependency once (diamond)", () => {
    const plugins = [plugin("a", ["b", "c"]), plugin("b", ["d"]), plugin("c", ["d"]), plugin("d")];
    expect(dependencyOrder(plugins)).toEqual(["d", "b", "c", "a"]);
  });

  it("shows only the cycle, not the path that led to it", () => {
    const plugins = [plugin("a", ["b"]), plugin("b", ["c"]), plugin("c", ["b"])];
    expect(() => dependencyOrder(plugins)).toThrow("plugin dependency cycle: b -> c -> b");
  });

  it("prefixes a bad entry with the plugin name", () => {
    expect(() => dependencyOrder([plugin("a", ["Bad"])])).toThrow('a: dependencies[0] ("Bad")');
  });

  it("matches by name only: marketplace and version are carried, not checked", () => {
    const deps = [{ name: "b", marketplace: "elsewhere", version: "^9" }];
    expect(dependencyOrder([plugin("a", deps), plugin("b")])).toEqual(["b", "a"]);
  });

  it("throws on a dependency that is not among the plugins", () => {
    expect(() => dependencyOrder([plugin("a", ["b"])])).toThrow("a depends on b, which is not among the plugins to install");
  });

  it("throws on a cycle, showing its path", () => {
    expect(() => dependencyOrder([plugin("a", ["b"]), plugin("b", ["a"])])).toThrow("plugin dependency cycle: a -> b -> a");
  });

  it("throws on a plugin that depends on itself", () => {
    expect(() => dependencyOrder([plugin("a", ["a"])])).toThrow("plugin dependency cycle: a -> a");
  });

  it("throws on a duplicate name", () => {
    expect(() => dependencyOrder([plugin("a"), plugin("a")])).toThrow('plugin "a" is listed twice');
  });

  it("prefixes a manifest error with the plugin name", () => {
    expect(() => dependencyOrder([plugin("a", "b")])).toThrow("a: dependencies must be a list");
  });
});

describe("npm packages", () => {
  let root;
  let dir;
  const put = (name, content) => writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  const withDeps = { name: "p", dependencies: { x: "1.0.0" } };
  const calls = [];
  const run = (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd, files: readdirSync(cwd).sort() });
    mkdirSync(join(cwd, "node_modules", "x"), { recursive: true });
    writeFileSync(join(cwd, "node_modules", "x", "index.js"), "");
  };
  const stagingLeft = () => readdirSync(root).filter((f) => f !== "copy");

  beforeEach(() => {
    calls.length = 0;
    root = mkdtempSync(join(tmpdir(), "atril-npm-"));
    dir = join(root, "copy");
    mkdirSync(dir);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("npmLockfile", () => {
    it("is none without a package.json or without runtime dependencies", () => {
      expect(npmLockfile(dir)).toEqual({ status: "none" });
      put("package.json", { name: "p", dependencies: {}, devDependencies: { y: "1" } });
      expect(npmLockfile(dir)).toEqual({ status: "none" });
    });

    it.each(["bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"])("is unsupported, naming %s", (lock) => {
      put("package.json", withDeps);
      put(lock, "");
      expect(npmLockfile(dir)).toEqual({ status: "unsupported", reason: `${lock}, not an npm lockfile` });
    });

    it("is unsupported without any lockfile", () => {
      put("package.json", withDeps);
      expect(npmLockfile(dir)).toEqual({ status: "unsupported", reason: "no lockfile" });
    });

    it("is unsupported for a lockfileVersion other than 2 or 3", () => {
      put("package.json", withDeps);
      put("package-lock.json", { lockfileVersion: 1 });
      expect(npmLockfile(dir)).toEqual({ status: "unsupported", reason: "package-lock.json has lockfileVersion 1, not 2 or 3" });
    });

    it("is ready with a lockfileVersion 2 or 3 lockfile, optionalDependencies alone included", () => {
      put("package.json", { optionalDependencies: { x: "1.0.0" } });
      put("package-lock.json", { lockfileVersion: 2 });
      expect(npmLockfile(dir)).toEqual({ status: "ready", lockfile: "package-lock.json" });
    });

    it("names the invalid JSON file", () => {
      put("package.json", "{");
      expect(() => npmLockfile(dir)).toThrow("package.json");
    });

    it.each(["dependencies", "optionalDependencies"])("rejects a %s that is not an object", (field) => {
      for (const value of ['"abc"', "[]", "null"]) {
        put("package.json", `{"${field}":${value}}`);
        expect(() => npmLockfile(dir)).toThrow(`${field} must be an object`);
      }
    });
  });

  describe("installNpmDeps", () => {
    it("does not run npm when there is nothing to install or it is unsupported", () => {
      expect(installNpmDeps(dir, { run })).toEqual({ status: "none" });
      put("package.json", withDeps);
      expect(installNpmDeps(dir, { run })).toEqual({ status: "unsupported", reason: "no lockfile" });
      expect(calls).toEqual([]);
    });

    it("runs npm ci in a staging folder holding only package.json and the lockfile", () => {
      put("package.json", withDeps);
      put("package-lock.json", { lockfileVersion: 3 });
      put(".npmrc", "registry=https://evil.example");
      expect(installNpmDeps(dir, { run })).toEqual({ status: "installed", lockfile: "package-lock.json" });
      expect(calls).toHaveLength(1);
      expect(calls[0].cmd).toBe("npm");
      expect(calls[0].args).toEqual(["ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"]);
      expect(calls[0].cwd).not.toBe(dir);
      expect(calls[0].files).toEqual(["package-lock.json", "package.json"]);
      expect(existsSync(join(dir, "node_modules", "x", "index.js"))).toBe(true);
      expect(stagingLeft()).toEqual([]);
    });

    it("throws with the cause, removes the staging folder and leaves no node_modules when npm fails", () => {
      put("package.json", withDeps);
      put("package-lock.json", { lockfileVersion: 3 });
      const boom = new Error("E404");
      let error;
      try {
        installNpmDeps(dir, { run: () => { throw boom; } });
      } catch (e) {
        error = e;
      }
      expect(error.message).toBe(`${dir}: npm ci failed (E404)`);
      expect(error.cause).toBe(boom);
      expect(stagingLeft()).toEqual([]);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
    });

    it("throws, naming the copy, when npm succeeds but produces no node_modules", () => {
      put("package.json", withDeps);
      put("package-lock.json", { lockfileVersion: 3 });
      expect(() => installNpmDeps(dir, { run: () => {} })).toThrow(`${dir}: npm ci produced no node_modules`);
      expect(stagingLeft()).toEqual([]);
    });

    it("throws before running anything when the copy already has node_modules", () => {
      put("package.json", withDeps);
      put("package-lock.json", { lockfileVersion: 3 });
      mkdirSync(join(dir, "node_modules"));
      expect(() => installNpmDeps(dir, { run })).toThrow(`${join(dir, "node_modules")} already exists`);
      expect(calls).toEqual([]);
    });
  });
});
