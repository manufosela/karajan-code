// KJC-TSK-0724 TOR-B — the deterministic scoreboard: pure metrics from the
// artifacts TOR-A leaves behind, injectable external metrics with HONEST
// degradation (n/a, never fake numbers), red suites eliminated, and a
// declared lexicographic ranking — no opaque composite scores. Zero LLM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scoreTournament, parseDiffStats, defaultMutate } from "../../src/tournament/scoreboard.js";

const DIFF_TWO_FILES = [
  "diff --git a/src/a.js b/src/a.js",
  "+++ b/src/a.js",
  "+line one",
  "+line two",
  "-old line",
  "diff --git a/tests/a.test.js b/tests/a.test.js",
  "+++ b/tests/a.test.js",
  "+assert something",
  "",
].join("\n");

let dir, torDir;
const mkLane = (coder, { suiteOk = true, diff = DIFF_TWO_FILES, status = "completed" } = {}) => {
  const laneDir = path.join(torDir, coder);
  fs.mkdirSync(laneDir, { recursive: true });
  fs.writeFileSync(path.join(laneDir, "diff.patch"), diff);
  fs.writeFileSync(
    path.join(laneDir, "meta.json"),
    JSON.stringify({ coder, branch: `tor/x-${coder}`, lane: `/lanes/${coder}`, suite: { ok: suiteOk, exitCode: suiteOk ? 0 : 1 } }),
  );
  return { coder, status, dir: laneDir, lane: `/lanes/${coder}`, suite: { ok: suiteOk } };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-torb-"));
  torDir = path.join(dir, ".kj", "tournaments", "tor-x");
  fs.mkdirSync(torDir, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const writeSummary = (lanes) =>
  fs.writeFileSync(path.join(torDir, "summary.json"), JSON.stringify({ id: "tor-x", task: "t", lanes }));

describe("parseDiffStats", () => {
  it("counts additions, deletions, files and tests touched from a unified diff", () => {
    const stats = parseDiffStats(DIFF_TWO_FILES);
    expect(stats.files).toEqual(["src/a.js", "tests/a.test.js"]);
    expect(stats.additions).toBe(3);
    expect(stats.deletions).toBe(1);
    expect(stats.net).toBe(2);
    expect(stats.testsTouched).toBe(1);
  });
  it("counts added/deleted lines whose CONTENT starts with ++ or -- (only exact headers are excluded)", () => {
    const tricky = [
      "diff --git a/src/inc.js b/src/inc.js",
      "--- a/src/inc.js",
      "+++ b/src/inc.js",
      "+++counter;", // added line with content "++counter;"
      "---counter;", // deleted line with content "--counter;"
      "+normal",
      "--- /dev/null", // deletion header of a new file — not a count
      "+++ /dev/null", // addition header of a deleted file — not a count
    ].join("\n");
    const stats = parseDiffStats(tricky);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
    expect(stats.files).toEqual(["src/inc.js"]);
  });

  it("handles an empty diff as zeroes", () => {
    expect(parseDiffStats("")).toMatchObject({ files: [], additions: 0, deletions: 0, net: 0, testsTouched: 0 });
  });
});

describe("defaultMutate lane guard", () => {
  it("a gone or relative lane yields a DISTINCT note, never a silent degradation", async () => {
    for (const lane of ["/does/not/exist", "relative/path", null]) {
      const res = await defaultMutate({ lane });
      expect(res.score).toBeNull();
      expect(res.note).toMatch(/lane/i);
    }
  });
});

describe("scoreTournament", () => {
  it("scores completed lanes, eliminates red suites from finalists, and persists scoreboard.json", async () => {
    writeSummary([mkLane("claude"), mkLane("codex", { suiteOk: false }), { coder: "agy", status: "failed", error: "boom" }]);
    const board = await scoreTournament({
      tournamentDir: torDir,
      deps: { mutateFn: async () => ({ score: 80, killed: 8, survived: 2 }), sonarFn: async () => null },
    });
    const claude = board.rows.find((r) => r.coder === "claude");
    const codex = board.rows.find((r) => r.coder === "codex");
    const agy = board.rows.find((r) => r.coder === "agy");
    expect(claude.finalist).toBe(true);
    expect(claude.mutation.score).toBe(80);
    expect(claude.loc.net).toBe(2);
    expect(codex.finalist).toBe(false);
    expect(codex.eliminated_by).toBe("suite");
    expect(agy.finalist).toBe(false);
    expect(agy.eliminated_by).toBe("failed");
    expect(board.ranking[0]).toBe("claude");
    expect(JSON.parse(fs.readFileSync(path.join(torDir, "scoreboard.json"), "utf8")).rows).toHaveLength(3);
  });

  it("ranks finalists by declared rule: mutation desc, then net LOC asc — and states the rule", async () => {
    writeSummary([mkLane("claude"), mkLane("codex"), mkLane("agy")]);
    const mutation = { claude: { score: 60 }, codex: { score: 90 }, agy: { score: 90 } };
    const diffs = { agy: DIFF_TWO_FILES, codex: `${DIFF_TWO_FILES}\n+++ b/src/extra.js\n+x\n+y\n+z\n` };
    for (const [coder, d] of Object.entries(diffs)) fs.writeFileSync(path.join(torDir, coder, "diff.patch"), d);
    const board = await scoreTournament({
      tournamentDir: torDir,
      deps: { mutateFn: async ({ coder }) => mutation[coder], sonarFn: async () => null },
    });
    // codex y agy empatan en mutation (90); agy gana por menos LOC neto
    expect(board.ranking).toEqual(["agy", "codex", "claude"]);
    expect(board.rule).toMatch(/mutation/i);
  });

  it("a null mutation is never a hidden penalty: partial availability falls back to LOC between those pairs", async () => {
    writeSummary([mkLane("claude"), mkLane("codex")]);
    // codex tiene score real 50; claude no tiene mutation pero MENOS LOC
    fs.writeFileSync(path.join(torDir, "codex", "diff.patch"), `${DIFF_TWO_FILES}\n+++ b/src/extra.js\n+a\n+b\n+c\n+d\n`);
    const board = await scoreTournament({
      tournamentDir: torDir,
      deps: { mutateFn: async ({ coder }) => (coder === "codex" ? { score: 50 } : null), sonarFn: async () => null },
    });
    // con -1 implícito claude habría quedado último; con la regla honesta gana por LOC
    expect(board.ranking).toEqual(["claude", "codex"]);
  });

  it("degrades honestly: unavailable mutation/sonar become null with a note, never zeros", async () => {
    writeSummary([mkLane("claude")]);
    const board = await scoreTournament({
      tournamentDir: torDir,
      deps: { mutateFn: async () => { throw new Error("mutate not available"); }, sonarFn: async () => null },
    });
    const row = board.rows[0];
    expect(row.mutation.score).toBeNull();
    expect(row.mutation.note).toMatch(/available|disponible/i);
    expect(row.sonar).toBeNull();
    expect(board.rule).toMatch(/LOC/);
  });
});
