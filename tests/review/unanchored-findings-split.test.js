// HU-4837: the pieces of kj review --staged that keep unanchored findings apart.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectFileReader, splitFindings, unanchoredNote } from "../../src/review/unanchored-findings.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-split-"));
  fs.writeFileSync(path.join(dir, "a.js"), "const a = 1;\n");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("projectFileReader", () => {
  it("reads a file inside the project", () => {
    expect(projectFileReader(dir)("a.js")).toBe("const a = 1;\n");
  });

  it("refuses a path that leaves the project, and a missing file", () => {
    expect(projectFileReader(dir)("../outside.js")).toBeNull();
    expect(projectFileReader(dir)(path.join(os.tmpdir(), "x.js"))).toBeNull();
    expect(projectFileReader(dir)("nope.js")).toBeNull();
  });

  // A finding is untrusted text: a symlink inside the project must not read a file outside it.
  it("refuses a symlink inside the project that points outside it", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kj-split-out-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "token\n");
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
      expect(projectFileReader(dir)("link.txt")).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // An alias of the project directory (a symlinked workspace) is still the project.
  it("reads a file of a project reached through a symlink", () => {
    const alias = `${dir}-alias`;
    fs.symlinkSync(dir, alias);
    try { expect(projectFileReader(alias)("a.js")).toBe("const a = 1;\n"); } finally { fs.unlinkSync(alias); }
  });
});

describe("splitFindings", () => {
  const readFile = projectFileReader;
  it("keeps the anchored ones, sets the rest apart with their reason, marks the protected", () => {
    const issues = [
      { id: "ok", file: "a.js", line: 1, description: "`const a`" },
      { id: "ghost", file: "ghost.js", line: 1, description: "x" },
      { id: "sec", category: "security", file: "ghost.js", line: 1, description: "x" },
    ];
    const { blocking, unanchored } = splitFindings(issues, { diff: "", readFile: readFile(dir) });
    expect(blocking.map((i) => i.id)).toEqual(["ok", "sec"]);
    expect(blocking[1].unanchored).toBe("missing-file");
    expect(unanchored).toEqual([expect.objectContaining({ id: "ghost", reason: "missing-file" })]);
  });
});

describe("unanchoredNote", () => {
  it("names each finding with its reason", () => {
    expect(unanchoredNote([{ id: "R-2", file: "g.js", line: 9, reason: "missing-file" }])).toMatch(/R-2 \(g\.js:9\): missing-file/);
  });
});
