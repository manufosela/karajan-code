// HU-4278 (KJC-BUG-0580, #4260): each seeded workflow pins a published kj that has what it
// uses, or is left as it is. An unreachable registry never yields a pinned, unconfirmed version.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installWorkflows } from "../../src/harden/workflow-engine.js";
import { pinForMinimum } from "../../src/harden/published-pin.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-minver-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const wfPath = (file) => join(dir, ".github", "workflows", file);
const entry = (res, file) => res.workflows.find((w) => w.file.endsWith(file));
const install = (published) => installWorkflows({ projectDir: dir, kjVersion: "5.22.0", published });

describe("pinForMinimum", () => {
  it("is the newest stable published version within [min, running]", () => {
    expect(pinForMinimum({ published: ["5.20.0", "5.21.0", "5.23.0", "5.22.0-beta.1"], running: "5.22.0", min: "5.21.0" })).toBe("5.21.0");
    expect(pinForMinimum({ published: ["5.21.0"], running: "5.22.0", min: "5.22.0" })).toBeNull();
    expect(pinForMinimum({ published: null, running: "5.22.0", min: "1.0.0" })).toBeNull();
  });
});

describe("kj harden workflows pin per minimum version", () => {
  it("leaves secrets out when its minimum is not published, and pins verdicts to the newest published", () => {
    const res = install(["5.21.0"]);
    expect(entry(res, "kj-secrets.yml")).toMatchObject({ action: "left", note: expect.stringContaining("kj-secrets.yml needs karajan-code >= 5.22.0, which is not on npm yet") });
    expect(existsSync(wfPath("kj-secrets.yml"))).toBe(false);
    expect(readFileSync(wfPath("kj-verdicts.yml"), "utf8")).toContain("karajan-code@5.21.0");
  });

  it("pins both to the running version when it is published", () => {
    install(["5.21.0", "5.22.0"]);
    for (const f of ["kj-secrets.yml", "kj-verdicts.yml"]) expect(readFileSync(wfPath(f), "utf8")).toContain("karajan-code@5.22.0");
  });

  it("writes nothing that installs kj when the registry is unreachable", () => {
    const res = install(null);
    for (const f of ["kj-secrets.yml", "kj-verdicts.yml"]) {
      expect(entry(res, f).action).toBe("left");
      expect(existsSync(wfPath(f))).toBe(false);
    }
    expect(res.workflows.some((w) => w.note)).toBe(false); // the single warning comes from harden
  });

  it("keeps an existing kj-secrets.yml byte for byte when its minimum is not published", () => {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    const old = "# kj:managed:wf-secrets v1 start\nname: old\n# kj:managed:wf-secrets end\n";
    writeFileSync(wfPath("kj-secrets.yml"), old);
    install(["5.21.0"]);
    expect(readFileSync(wfPath("kj-secrets.yml"), "utf8")).toBe(old);
  });
});
