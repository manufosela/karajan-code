// ADR 0021, plan step 13g1-i: plugin dependencies are read from a manifest and put in install
// order. Pure: plain objects in, names out. No disk, git or network.
import { describe, expect, it } from "vitest";
import { dependencyOrder, pluginDependencies } from "../src/plugin-deps.js";

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
