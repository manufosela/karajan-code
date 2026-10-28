// KJC-TSK-1170 (RAG-E, ADR 0026): the retriever against a FIXED corpus with the real
// embedder, compared with the frozen baseline in tests/rag/baseline.json. Recall or MRR
// getting worse fails the suite. Latency is NOT checked here (KJC-BUG-0418): inside the
// parallel suite the wall clock measures the machine's load, not the retriever. Check it
// alone with: kj rag eval --golden <file> --baseline tests/rag/baseline.json
// Without Ollama (CI) it is skipped and says so: a skipped measurement is never a green one.
//   Measure a new baseline:  KJ_RAG_SAVE_BASELINE=1 npx vitest run tests/rag/eval-regression.test.js
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, "fixtures", "eval-corpus");
// Relative to the repo root (vitest's cwd), so the baseline records a path every machine shares.
const GOLDEN = "tests/rag/fixtures/eval-golden.json";
const BASELINE = join(here, "baseline.json");
const MODEL = "nomic-embed-text";

async function ollamaHasModel() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    const { models = [] } = await res.json();
    return models.some((m) => String(m.name).startsWith(MODEL));
  } catch {
    return false;
  }
}

const available = await ollamaHasModel();
if (!available) console.warn(`[rag-eval] skipped: Ollama with ${MODEL} is not reachable, the retrieval baseline was NOT checked`);

const logger = { info: () => {}, warn: () => {}, error: (m) => console.error(m) };
const config = () => ({ projectDir: CORPUS, rag: { embedder: { provider: "ollama", model: MODEL, dim: 768 } } });

describe.skipIf(!available)("retrieval does not regress against the frozen baseline — KJC-TSK-1170", () => {
  let root, prevHome, prevDb, prevExit;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-baseline-"));
    [prevHome, prevDb, prevExit] = [process.env.KARAJAN_HOME, process.env.KJ_RAG_DB, process.exitCode];
    process.env.KARAJAN_HOME = join(root, ".karajan");
    process.env.KJ_RAG_DB = join(root, "rag.db");
    mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
    const files = readdirSync(CORPUS, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => relative(CORPUS, join(d.parentPath ?? d.path, d.name)));
    const { ragIndexCommand } = await import("../../src/commands/rag.js");
    await ragIndexCommand({ config: config(), logger, flags: { file: files, json: true } });
  }, 120_000);
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
    if (prevDb === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prevDb;
    process.exitCode = prevExit;
  });

  it("recall@k and MRR are not worse than tests/rag/baseline.json", async () => {
    const { ragEvalCommand } = await import("../../src/commands/rag.js");
    const { compareToBaseline } = await import("../../src/rag/eval.js");
    const saving = process.env.KJ_RAG_SAVE_BASELINE === "1";
    if (!saving && !existsSync(BASELINE)) throw new Error(`no baseline at ${BASELINE}: measure one with KJ_RAG_SAVE_BASELINE=1`);
    process.exitCode = 0;
    const report = await ragEvalCommand({
      config: config(), logger,
      flags: { golden: GOLDEN, topK: 10, project: "all", ...(saving ? { saveBaseline: BASELINE } : {}) },
    });
    expect(report.aggregate.n).toBe(24);
    expect(process.exitCode).toBe(0);
    const { recall, mrr } = JSON.parse(readFileSync(BASELINE, "utf8")).aggregate;
    expect(compareToBaseline(report.aggregate, { recall, mrr }).problems).toEqual([]);
  }, 120_000);
});
