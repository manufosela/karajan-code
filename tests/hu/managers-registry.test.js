import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadManager } from "../../src/hu/managers/index.js";

describe("loadManager", () => {
  it("builds the GitHub manager from the board config, with the injected runner", async () => {
    const manager = await loadManager({ backend: "github", repo: "acme/app" }, { env: {}, run: async () => ({ exitCode: 0, stdout: "[]" }) });
    expect(manager.isId("HU-12")).toBe(true);
    expect(manager.capabilities.offline).toBe(true);
  });

  it("fails loud on a name outside the built-in list, whatever it looks like", async () => {
    for (const backend of ["jira", "../../evil", "/tmp/x.js", "constructor", "local"]) {
      await expect(loadManager({ backend }, {})).rejects.toThrow(/unknown task manager.*github, linear/);
    }
  });

  const packagesWith = (name, source) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-pkgs-"));
    if (source !== null) {
      fs.mkdirSync(path.join(root, `board-${name}`, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, `board-${name}`, "src", "index.js"), source);
    }
    return pathToFileURL(`${root}${path.sep}`);
  };

  it("says so when the package of a built-in is not in the tree", async () => {
    await expect(loadManager({ backend: "linear", linear: {} }, { packages: packagesWith("linear", null) })).rejects.toThrow(/manager package for linear is not installed/);
  });

  it("fails loud on an invalid manager or a package with no createManager", async () => {
    const config = { backend: "linear", linear: { team: "TRI" } };
    const echo = packagesWith("linear", "export const createManager = ({ config }) => ({ config });");
    await expect(loadManager(config, { packages: echo })).rejects.toThrow(/task manager is missing/);
    await expect(loadManager(config, { packages: packagesWith("linear", "export const x = 1;") })).rejects.toThrow(/does not export createManager/);
  });
});
