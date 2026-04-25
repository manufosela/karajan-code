import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAdrsFromArchitecture,
  renderAdrMarkdown,
  writeAdrsToDisk,
  persistAdrsFromArchitecture,
} from "../src/plan/adr-generator.js";

let tmpHome;
let tmpProject;
let savedHome;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "kj-adr-"));
  tmpProject = mkdtempSync(join(tmpdir(), "kj-adr-project-"));
  savedHome = process.env.KJ_HOME;
  process.env.KJ_HOME = tmpHome;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = savedHome;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProject, { recursive: true, force: true });
});

describe("extractAdrsFromArchitecture", () => {
  it("returns [] when there are no tradeoffs", () => {
    expect(extractAdrsFromArchitecture({})).toEqual([]);
    expect(extractAdrsFromArchitecture({ tradeoffs: [] })).toEqual([]);
    expect(extractAdrsFromArchitecture(null)).toEqual([]);
  });

  it("creates one ADR per tradeoff with 4-digit zero-padded ids", () => {
    const adrs = extractAdrsFromArchitecture({
      tradeoffs: [
        { decision: "Use SQLite for storage", rationale: "Zero-config, file-based" },
        { decision: "Use Express 5 for HTTP" },
      ],
    });
    expect(adrs).toHaveLength(2);
    expect(adrs[0].id).toBe("0001-use-sqlite-for-storage");
    expect(adrs[1].id).toBe("0002-use-express-5-for-http");
    expect(adrs[0].number).toBe(1);
    expect(adrs[1].number).toBe(2);
  });

  it("default status is 'accepted' (architect ran → decision is taken)", () => {
    const [adr] = extractAdrsFromArchitecture({ tradeoffs: [{ decision: "x" }] });
    expect(adr.status).toBe("accepted");
  });

  it("respects the status override when provided + valid", () => {
    const [adr] = extractAdrsFromArchitecture(
      { tradeoffs: [{ decision: "x" }] },
      { status: "proposed" }
    );
    expect(adr.status).toBe("proposed");
  });

  it("rejects invalid status overrides and falls back to 'accepted'", () => {
    const [adr] = extractAdrsFromArchitecture(
      { tradeoffs: [{ decision: "x" }] },
      { status: "invalid-status" }
    );
    expect(adr.status).toBe("accepted");
  });

  it("captures alternatives when the architect provides them", () => {
    const [adr] = extractAdrsFromArchitecture({
      tradeoffs: [{ decision: "Use Vitest", rationale: "Fast", alternatives: ["Jest", "Mocha"] }],
    });
    expect(adr.alternatives).toEqual(["Jest", "Mocha"]);
  });

  it("accepts plain-string tradeoffs (degraded shape)", () => {
    const [adr] = extractAdrsFromArchitecture({ tradeoffs: ["Use HTTP/2"] });
    expect(adr.title).toBe("Use HTTP/2");
    expect(adr.decision).toBe("Use HTTP/2");
  });

  it("skips empty / whitespace-only tradeoffs without bumping the number", () => {
    const adrs = extractAdrsFromArchitecture({
      tradeoffs: [
        { decision: "  " },
        "",
        null,
        { decision: "Real one" },
      ],
    });
    expect(adrs).toHaveLength(1);
    expect(adrs[0].number).toBe(1);
  });

  it("slugifies titles with non-ASCII characters cleanly", () => {
    const [adr] = extractAdrsFromArchitecture({
      tradeoffs: [{ decision: "Usar PostgreSQL — versión 16" }],
    });
    expect(adr.id).toMatch(/^0001-/);
    expect(adr.id).not.toMatch(/[^a-z0-9-]/);
  });
});

describe("renderAdrMarkdown", () => {
  it("uses the canonical Nygard format with a header, Status/Date, Context, Decision, Consequences", () => {
    const md = renderAdrMarkdown({
      number: 7, id: "0007-x", title: "Use SQLite", status: "accepted",
      context: "We need plan storage.", decision: "Use SQLite.",
      consequences: "No external DB.", alternatives: [],
    }, { date: new Date("2026-04-25T00:00:00Z") });
    expect(md).toMatch(/^# 0007\. Use SQLite\n/);
    expect(md).toMatch(/\*\*Status:\*\* accepted/);
    expect(md).toMatch(/\*\*Date:\*\* 2026-04-25/);
    expect(md).toMatch(/## Context\n\nWe need plan storage\./);
    expect(md).toMatch(/## Decision\n\nUse SQLite\./);
    expect(md).toMatch(/## Consequences\n\nNo external DB\./);
  });

  it("renders an Alternatives section as a bullet list when present", () => {
    const md = renderAdrMarkdown({
      number: 1, id: "x", title: "t", status: "accepted",
      decision: "d", context: "c", consequences: "cons",
      alternatives: ["A", "B", "C"],
    });
    expect(md).toMatch(/\*\*Alternatives considered:\*\*\n\n- A\n- B\n- C/);
  });

  it("falls back to placeholder text when context / consequences are missing", () => {
    const md = renderAdrMarkdown({
      number: 1, id: "x", title: "t", status: "accepted", decision: "d",
    });
    expect(md).toMatch(/_\(architect role did not provide an explicit context/);
    expect(md).toMatch(/_\(no consequences captured by the architect role\.\)_/);
  });
});

describe("writeAdrsToDisk", () => {
  it("creates the adrs/ subdir under the plan dir and writes one file per ADR", async () => {
    const adrs = [
      { number: 1, id: "0001-a", title: "A", status: "accepted", decision: "d1", context: "c", consequences: "x", alternatives: [] },
      { number: 2, id: "0002-b", title: "B", status: "accepted", decision: "d2", context: "c", consequences: "x", alternatives: [] },
    ];
    const paths = await writeAdrsToDisk({
      projectDir: tmpProject,
      planId: "plan-test",
      adrs,
    });
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(existsSync(p)).toBe(true);
      expect(p).toMatch(/\/plans\/[^/]+\/plan-test\/adrs\/000[12]-[ab]\.md$/);
      expect(readFileSync(p, "utf-8")).toMatch(/# 000[12]\./);
    }
  });

  it("uses the '_loose' bucket when planId is missing (kj architect standalone)", async () => {
    const adrs = [{ number: 1, id: "0001-x", title: "X", status: "accepted", decision: "d", context: "", consequences: "", alternatives: [] }];
    const [filePath] = await writeAdrsToDisk({
      projectDir: tmpProject,
      planId: null,
      adrs,
    });
    expect(filePath).toMatch(/\/_loose\/adrs\/0001-x\.md$/);
  });

  it("returns [] without touching disk when adrs is empty", async () => {
    const paths = await writeAdrsToDisk({ projectDir: tmpProject, planId: "p", adrs: [] });
    expect(paths).toEqual([]);
  });

  it("requires a projectDir", async () => {
    await expect(
      writeAdrsToDisk({ projectDir: "", planId: "p", adrs: [{ number: 1, id: "x", title: "t", status: "accepted", decision: "d", context: "", consequences: "", alternatives: [] }] })
    ).rejects.toThrow(/projectDir is required/);
  });
});

describe("persistAdrsFromArchitecture (extract + write)", () => {
  it("end-to-end: tradeoffs[] → markdown files on disk", async () => {
    const result = await persistAdrsFromArchitecture({
      projectDir: tmpProject,
      planId: null,
      architecture: {
        tradeoffs: [
          { decision: "Pick Vitest", rationale: "Fast + ESM-native", alternatives: ["Jest"] },
          { decision: "Use chokidar for watching", rationale: "Cross-platform" },
        ],
      },
    });
    expect(result.adrs).toHaveLength(2);
    expect(result.paths).toHaveLength(2);
    const dir = result.paths[0].replace(/\/[^/]+$/, "");
    const files = readdirSync(dir).sort();
    expect(files).toEqual(["0001-pick-vitest.md", "0002-use-chokidar-for-watching.md"]);
    const md = readFileSync(result.paths[0], "utf-8");
    expect(md).toMatch(/Fast \+ ESM-native/);
  });

  it("end-to-end with no tradeoffs: returns empty arrays without writing", async () => {
    const result = await persistAdrsFromArchitecture({
      projectDir: tmpProject,
      planId: "p",
      architecture: { tradeoffs: [] },
    });
    expect(result).toEqual({ adrs: [], paths: [] });
  });
});
