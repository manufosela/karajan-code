// ADR 0021, decision 12 and plan step 10c: installed catalog artifacts follow what their
// catalog offers now; a local edit is never overwritten without asking.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";
import { installFromCatalog } from "../src/catalog-install.js";
import { readLock } from "../src/lock.js";
import { install } from "../src/store.js";
import { applyInstalledUpdate, installedUpdates } from "../src/upgrade.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-upgrade-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const command = (rel, body) => put(rel, `---\nname: deploy\ndescription: deploy\nkind: command\n---\n${body}\n`);
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const states = () => installedUpdates(o()).map(({ kind, name, state }) => `${kind}:${name}:${state}`);

beforeEach(() => {
  command("kit/commands/deploy.md", "v1");
  writeConfig({ catalogs: ["kit"] }, o());
  installFromCatalog("command:deploy", o());
});

describe("installedUpdates", () => {
  it("is current until the catalog offers different content, then outdated with the diff", () => {
    expect(states()).toEqual(["command:deploy:current"]);
    command("kit/commands/deploy.md", "v2");
    const [update] = installedUpdates(o());
    expect(update).toMatchObject({ state: "outdated", catalog: "kit" });
    expect(update.diff).toMatch(/-v1[\s\S]*\+v2/);
  });
  it("is edited when the installed copy changed too, and unavailable when the catalog drops it", () => {
    command("kit/commands/deploy.md", "v2");
    command("store/commands/deploy.md", "mine");
    expect(states()).toEqual(["command:deploy:edited"]);
    rmSync(join(dir, "kit", "commands", "deploy.md"));
    expect(states()).toEqual(["command:deploy:unavailable"]);
  });
  it("does not follow a name another catalog now offers first", () => {
    command("first/commands/deploy.md", "other");
    writeConfig({ catalogs: ["first", "kit"] }, o());
    expect(states()).toEqual(["command:deploy:unavailable"]);
  });
  it("skips what was installed locally", () => {
    command("loose/deploy.md", "x");
    rmSync(join(dir, "store"), { recursive: true });
    install(join(dir, "loose", "deploy.md"), o());
    expect(states()).toEqual([]);
  });
  it("skips what a plugin installed: plugin updates come later", () => {
    put("loose/kit__deploy.md", "---\nname: kit__deploy\ndescription: d\nkind: command\n---\nx\n");
    install(join(dir, "loose", "kit__deploy.md"), { ...o(), origin: { origin: "plugin", plugin: "kit" } });
    expect(states()).toEqual(["command:deploy:current"]);
  });
});

describe("applyInstalledUpdate", () => {
  it("reinstalls from the catalog and moves the lock hash", () => {
    const before = readLock(o()).artifacts["command:deploy"].hash;
    command("kit/commands/deploy.md", "v2");
    applyInstalledUpdate("command:deploy", o());
    expect(readFileSync(join(dir, "store", "commands", "deploy.md"), "utf8")).toMatch(/v2/);
    expect(readLock(o()).artifacts["command:deploy"].hash).not.toBe(before);
    expect(states()).toEqual(["command:deploy:current"]);
  });
  it("refuses an edited artifact unless discardEdits is given", () => {
    command("kit/commands/deploy.md", "v2");
    command("store/commands/deploy.md", "mine");
    expect(() => applyInstalledUpdate("command:deploy", o())).toThrow(/command:deploy was edited locally; pass --discard-edits to overwrite it/);
    applyInstalledUpdate("command:deploy", o(), { discardEdits: true });
    expect(states()).toEqual(["command:deploy:current"]);
  });
  it("refreshes the lock when the edited copy already equals the catalog's", () => {
    command("kit/commands/deploy.md", "v2");
    command("store/commands/deploy.md", "v2");
    applyInstalledUpdate("command:deploy", o(), { discardEdits: true });
    expect(states()).toEqual(["command:deploy:current"]);
  });
  it("is a no-op when current and refuses what is not a candidate", () => {
    expect(applyInstalledUpdate("command:deploy", o())).toMatchObject({ status: "unchanged" });
    expect(() => applyInstalledUpdate("command:ghost", o())).toThrow(/no catalog origin/);
  });
});
