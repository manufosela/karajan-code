// HU-3812 (issue #3763): a staged change is a release bump only when it moves
// the version (package.json / package-lock.json) and the changelog, nothing else.
import { describe, it, expect } from "vitest";
import { checkReleaseBump } from "../../src/review/release-bump.js";

const pkg = (version, extra = {}) => JSON.stringify({ name: "app", version, ...extra });
const lock = (version, extra = {}) => JSON.stringify({ name: "app", version, packages: { "": { name: "app", version }, "node_modules/x": { version: "1.0.0" } }, ...extra });

const [PKG, LOCK, LOG] = ["package.json", "package-lock.json", "CHANGELOG.md"];
const check = (files, head, index) => checkReleaseBump(files, {
  readHead: async (f) => head[f] ?? null,
  readIndex: async (f) => index[f] ?? null,
});

describe("checkReleaseBump", () => {
  it("accepts a version bump of package.json, the lock and the changelog", async () => {
    const res = await check([PKG, LOCK, LOG],
      { [PKG]: pkg("1.0.0"), [LOCK]: lock("1.0.0"), [LOG]: "# old\n" },
      { [PKG]: pkg("1.1.0"), [LOCK]: lock("1.1.0"), [LOG]: "# new\n# old\n" });
    expect(res).toEqual({ bump: true, reason: "version and changelog only" });
  });

  it.each([
    ["an extra field in package.json", [PKG], { [PKG]: pkg("1.0.0") }, { [PKG]: pkg("1.1.0", { private: true }) }, "package.json: changes more than the version"],
    ["another file", [PKG, "src/a.js"], { [PKG]: pkg("1.0.0"), "src/a.js": "a" }, { [PKG]: pkg("1.1.0"), "src/a.js": "b" }, "src/a.js: not a version or changelog file"],
    ["only the changelog", [LOG], { [LOG]: "a" }, { [LOG]: "b" }, "no version file changed"],
    ["a lock with another change", [LOCK], { [LOCK]: lock("1.0.0") }, { [LOCK]: lock("1.1.0", { lockfileVersion: 3 }) }, "package-lock.json: changes more than the version"],
    ["unparsable JSON", [PKG], { [PKG]: pkg("1.0.0") }, { [PKG]: "{nope" }, "package.json: unparsable JSON"],
    ["an unchanged version", [PKG], { [PKG]: pkg("1.0.0") }, { [PKG]: `${pkg("1.0.0")}\n` }, "package.json: version unchanged"],
    ["a file missing at HEAD", [PKG], {}, { [PKG]: pkg("1.0.0") }, "package.json: added, deleted or renamed"],
  ])("refuses %s", async (_label, files, head, index, reason) => {
    expect(await check(files, head, index)).toEqual({ bump: false, reason });
  });
});
