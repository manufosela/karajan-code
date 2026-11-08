// HU-3474: `kj review` in a lane reads the Sentinel state of the main tree,
// where a session that entered the lane through EnterWorktree wrote it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLaneSentinelState } from "../../src/harden/sentinel-lane-state.js";
import { readRagLedger } from "../../src/review/rag-ledger.js";

let tmp, main, lane, other;
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { stdio: "ignore" });
const write = (dir, state) => {
  fs.mkdirSync(path.join(dir, ".karajan", "harness"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "harness", "sentinel-state.json"), JSON.stringify(state));
};
const mark = (sid, laneTop) => {
  const dir = path.join(main, ".git", "kj-lanes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `session-${sid}.json`), JSON.stringify({ sid, lane: laneTop, at: Date.now() }));
};
const sess = (at, extra = {}) => ({ at, rag_queries: [{ text: "q", hits: ["a.js"] }], rag_hits: ["a.js"], ...extra });
const sids = (state) => Object.keys(state.sessions).sort();

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-state-")));
  main = path.join(tmp, "main");
  lane = path.join(tmp, "lane");
  other = path.join(tmp, "other");
  fs.mkdirSync(main);
  git(main, "init", "-q");
  git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-q", "--detach", lane);
  git(main, "worktree", "add", "-q", "--detach", other);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the state a lane sees", () => {
  it("reads from the main tree a session that entered the lane (its presence mark names the lane)", () => {
    write(main, { sessions: { s1: sess(5) } });
    mark("s1", lane);
    expect(sids(readLaneSentinelState(lane))).toEqual(["s1"]);
  });
  it("reads a session that wrote in the lane from elsewhere, through its lane entry", () => {
    write(main, { sessions: { s2: sess(5, { lanes: { [lane]: { edited_sources: ["x.js"] } } }) } });
    expect(sids(readLaneSentinelState(lane))).toEqual(["s2"]);
  });
  it("does not return an entry that belongs only to another lane", () => {
    write(main, { sessions: { s1: sess(5), s3: sess(6, { lanes: { [other]: { edited_sources: [] } } }) } });
    mark("s1", other);
    expect(readLaneSentinelState(lane).sessions).toEqual({});
    expect(sids(readLaneSentinelState(other))).toEqual(["s1", "s3"]);
  });
  it("prefers the lane's own state file", () => {
    write(main, { sessions: { s1: sess(5) } });
    mark("s1", lane);
    write(lane, { sessions: { own: sess(1) } });
    expect(sids(readLaneSentinelState(lane))).toEqual(["own"]);
  });
  it("reads a plain repository's state unfiltered", () => {
    write(main, { sessions: { a: sess(1), b: sess(2) } });
    expect(sids(readLaneSentinelState(main))).toEqual(["a", "b"]);
  });
  it("reads as null when no state exists anywhere", () => {
    expect(readLaneSentinelState(lane)).toBeNull();
  });
});

describe("the RAG ledger of a lane", () => {
  it("takes the most recent session of THIS lane, never another lane's newer one", () => {
    write(main, { sessions: { mine: sess(5, { rag_hits: ["mine.js"] }), theirs: sess(99, { rag_hits: ["theirs.js"] }) } });
    mark("mine", lane);
    mark("theirs", other);
    const ledger = readRagLedger(lane);
    expect(ledger.sessionId).toBe("mine");
    expect(ledger.hits).toEqual(["mine.js"]);
  });
  it("joins the hits and queries of every session of the lane (kj code runs its coder as another one)", () => {
    const q = (ts, text) => ({ ts, text, hits: [] });
    write(main, { sessions: {
      first: sess(5, { rag_hits: ["a.js", "b.js"], rag_queries: [q(1, "one")] }),
      later: sess(9, { rag_hits: ["a.js"], rag_queries: [q(0, "zero")] }),
    } });
    mark("first", lane);
    mark("later", lane);
    const ledger = readRagLedger(lane);
    expect(ledger.sessionId).toBe("later");
    expect(ledger.sessions).toBe(2);
    expect([...ledger.hits].sort()).toEqual(["a.js", "b.js"]);
    expect(ledger.queries.map((x) => x.text)).toEqual(["zero", "one"]);
  });
  it("reads only the latest session in the main tree itself", () => {
    write(main, { sessions: { old: sess(1, { rag_hits: ["old.js"] }), live: sess(2, { rag_hits: ["live.js"] }) } });
    const ledger = readRagLedger(main);
    expect(ledger.sessionId).toBe("live");
    expect(ledger.sessions).toBe(1);
    expect(ledger.hits).toEqual(["live.js"]);
  });
  it("is unavailable when only another lane's session exists", () => {
    write(main, { sessions: { theirs: sess(99) } });
    mark("theirs", other);
    expect(readRagLedger(lane).available).toBe(false);
  });
});
