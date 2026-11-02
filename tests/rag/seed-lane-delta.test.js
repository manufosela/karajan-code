// HU-3260 (spec test 5): a seeded lane with one edited file refreshes that one file; it never bootstraps.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../src/rag/bootstrap-index.js", () => ({ startBootstrap: vi.fn(), stopBootstrap: vi.fn(), stopLeaseHolder: vi.fn(), indexLeasePath: vi.fn() }));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: vi.fn(() => ({ dim: 8, embed: async () => Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0) })) }));

const { maybeAutoUpdate } = await import("../../src/rag/auto-update.js");
const { startBootstrap } = await import("../../src/rag/bootstrap-index.js");
const { seedLaneIndex } = await import("../../src/rag/seed-lane.js");
const { openVecStore, insertChunk, projectSlug, setLastIndexedCommit } = await import("../../src/rag/vec-store.js");
const { writeEmbedSchema } = await import("../../src/rag/embed-schema.js");

const git = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" }).trim();
let root;

beforeEach(() => { vi.stubEnv("KJ_RAG_DB", ""); root = realpathSync(mkdtempSync(join(tmpdir(), "kj-seed-delta-"))); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

it("runs a delta of 1 file in a seeded worktree and does not start a bootstrap", async () => {
  const main = join(root, "main");
  const lane = join(root, "lane");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "a.js"), "export const a = 1;\n");
  git(main, "add", "a.js");
  git(main, "commit", "-q", "-m", "base");
  git(main, "worktree", "add", "-q", lane, "-b", "lane");
  const db = openVecStore({ dim: 8, path: join(main, ".karajan", "rag.db") });
  insertChunk(db, { source: `${main}/a.js`, kind: "code", text: "a", metadata: null, embedding: Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0), project: projectSlug(main) });
  setLastIndexedCommit(db, projectSlug(main), git(main, "rev-parse", "HEAD"));
  db.close();
  writeEmbedSchema(main);
  expect(await seedLaneIndex({ mainDir: main, laneDir: lane, dim: 8 })).toMatchObject({ seeded: true });

  writeFileSync(join(lane, "a.js"), "export const a = 2;\n");
  const res = await maybeAutoUpdate({ projectDir: lane, config: { rag: { embedder: { dim: 8 } } }, logger: { info() {}, warn() {} } });
  expect(res).toMatchObject({ ran: true, totals: { files: 1 } });
  expect(startBootstrap).not.toHaveBeenCalled();
});
