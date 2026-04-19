/**
 * TSK-0325 — tests for the journal parser backing the /pipeline view.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

let tmpDir;
let parser;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "hu-board-journal-"));
  process.env.KJ_PROJECT_DIR = tmpDir;
  parser = await import("../src/journal-parser.js");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_PROJECT_DIR;
});

function stage(name, body) { return `### ${name}\n${body}\n`; }

function writeSession(id, files) {
  const dir = join(tmpDir, ".reviews", id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
}

describe("journal-parser.listSessions", () => {
  it("returns an empty list when .reviews/ does not exist", () => {
    const fresh = mkdtempSync(join(tmpdir(), "hu-board-journal-empty-"));
    process.env.KJ_PROJECT_DIR = fresh;
    expect(parser.listSessions()).toEqual([]);
    rmSync(fresh, { recursive: true, force: true });
    process.env.KJ_PROJECT_DIR = tmpDir;
  });

  it("lists only directories under .reviews/", () => {
    writeSession("sess-a", { "iterations.md": "# Iterations\n" });
    writeSession("sess-b", { "iterations.md": "# Iterations\n" });
    fs.writeFileSync(join(tmpDir, ".reviews", "stray.txt"), "ignored", "utf8");
    const ids = parser.listSessions().map((s) => s.id).sort();
    expect(ids).toContain("sess-a");
    expect(ids).toContain("sess-b");
    expect(ids).not.toContain("stray.txt");
  });
});

describe("journal-parser.splitByHeading", () => {
  it("splits on the given level", () => {
    const md = "# doc\n\n## one\nbody1\n\n## two\nbody2\n";
    const blocks = parser.splitByHeading(md, 2);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].heading).toBe("one");
    expect(blocks[0].body.trim()).toBe("body1");
    expect(blocks[1].heading).toBe("two");
  });

  it("returns empty array for missing content", () => {
    expect(parser.splitByHeading("", 2)).toEqual([]);
    expect(parser.splitByHeading(null, 2)).toEqual([]);
  });
});

describe("journal-parser.parseIterations", () => {
  it("extracts iteration number + stages", () => {
    const md = [
      "# Iterations",
      "",
      "## Iteration 1",
      "**Duration**: 1m2s",
      "",
      stage("Coder", "added function foo"),
      stage("Reviewer", "Approved"),
      "",
      "## Iteration 2",
      "**Duration**: 45s",
      stage("Coder", "fixed typo"),
    ].join("\n");
    const its = parser.parseIterations(md);
    expect(its).toHaveLength(2);
    expect(its[0].number).toBe(1);
    expect(its[0].duration).toBe("1m2s");
    expect(its[0].stages.map((s) => s.name)).toEqual(["Coder", "Reviewer"]);
    expect(its[1].stages[0].body).toContain("fixed typo");
  });
});

describe("journal-parser.parseDecisions", () => {
  it("returns a flat list of heading/body pairs", () => {
    const md = "# Decisions\n\n## 10:00 — Solomon consult\nbody\n\n## 10:02 — Brain route\nbody2\n";
    const out = parser.parseDecisions(md);
    expect(out).toHaveLength(2);
    expect(out[0].heading).toContain("Solomon");
  });
});

describe("journal-parser.parseSummary", () => {
  it("separates preamble and sections", () => {
    const md = "intro line\n\n## Stages\nstage body\n";
    const out = parser.parseSummary(md);
    expect(out.preamble).toBe("intro line");
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].heading).toBe("Stages");
  });
});

describe("journal-parser.readJournal", () => {
  it("returns a stable shape even when files are missing", () => {
    writeSession("sess-partial", { "iterations.md": "# Iterations\n## Iteration 1\n### Coder\ndone\n" });
    const out = parser.readJournal("sess-partial");
    expect(out.exists).toBe(true);
    expect(out.iterations).toHaveLength(1);
    expect(out.decisions).toEqual([]);
    expect(out.summary).toEqual({ preamble: "", sections: [] });
    expect(out.tree).toBe("");
  });

  it("returns exists=false for unknown sessions", () => {
    const out = parser.readJournal("nope-nope-nope");
    expect(out.exists).toBe(false);
  });
});
