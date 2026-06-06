// KJC-TSK-0509 — `kj qmd query` CLI wrapper. Auto-resolves the project's QMD
// collection (`<projectSlug>-<suffix>`) so users do not have to remember it.
// Mirrors `kj rag query`'s friendly-error shape on missing binary/collection.
// Distinction: rag = agent context (code+plans); qmd = human wiki (docs/*.md).
import { runCommand } from "../utils/process.js";
import { projectSlug } from "../utils/qmd-collection.js";

const QMD_NOT_INSTALLED = /command not found|ENOENT|not recognized as/i;
const COLLECTION_MISSING = /no such collection|collection .* not found|unknown collection/i;
const INSTALL_HINT = "qmd not installed. Install it with: npm install -g @tobilu/qmd";
const INIT_HINT = "Collection not registered for this project. Run `kj init` to register the wiki collection.";

function suffixFor(scope) {
  if (!scope || scope === "docs") return "docs";
  if (scope === "reviews" || scope === ".reviews") return "reviews";
  if (scope === "plans" || scope === ".karajan/plans" || scope === "karajan-plans") return "karajan-plans";
  return scope;
}

function resolveCollection({ flags, projectDir }) {
  if (flags.collection) return String(flags.collection).trim();
  return `${projectSlug(projectDir)}-${suffixFor(flags.scope)}`;
}

function notInstalled(logger) {
  logger.error?.(`[qmd] ${INSTALL_HINT}`);
  process.exitCode = 127;
  return { ok: false, error: "qmd not installed", installable: true };
}

export async function qmdQueryCommand({ text, config, logger, flags = {} }) {
  if (!text || !String(text).trim()) throw new Error("kj qmd query: text argument required");
  const projectDir = config?.projectDir || process.cwd();
  const collection = resolveCollection({ flags, projectDir });
  const limit = Math.min(Math.max(Number(flags.topK) || 10, 1), 50);
  const args = ["query", String(text), "--format", "json", "-c", collection, "-n", String(limit)];
  if (flags.fast) args.push("--no-rerank");

  let out;
  try {
    out = await runCommand("qmd", args, { timeout: 120_000 });
  } catch (err) {
    if (err?.code === "ENOENT") return notInstalled(logger);
    throw err;
  }

  const stderr = out.stderr || "";
  if (out.exitCode === 127 || QMD_NOT_INSTALLED.test(stderr)) return notInstalled(logger);
  if (COLLECTION_MISSING.test(stderr)) {
    logger.error?.(`[qmd] ${INIT_HINT}`);
    process.exitCode = 1;
    return { ok: false, error: "collection not registered", collection };
  }
  if (out.exitCode !== 0) {
    const msg = (stderr || out.stdout || `qmd exit ${out.exitCode}`).trim();
    logger.error?.(`[qmd] ${msg}`);
    process.exitCode = out.exitCode || 1;
    return { ok: false, error: msg };
  }

  let results;
  try { results = JSON.parse(out.stdout || "[]"); }
  catch {
    logger.error?.("[qmd] qmd output is not valid JSON");
    process.exitCode = 1;
    return { ok: false, error: "qmd output is not valid JSON" };
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return { ok: true, results };
  }
  if (!Array.isArray(results) || results.length === 0) {
    logger.info(`[qmd] no hits for "${text}" in collection ${collection}`);
    return { ok: true, results: [] };
  }
  logger.info(`[qmd] ${results.length} hit(s) in ${collection}:`);
  for (const h of results) {
    const src = h.source || h.path || h.file || "?";
    const score = typeof h.score === "number" ? ` · score=${h.score.toFixed(4)}` : "";
    const snippet = h.snippet || h.text || h.body || "";
    logger.info(`  - ${src}${score}`);
    if (snippet) logger.info(`    ${snippet.length > 200 ? `${snippet.slice(0, 200)}…` : snippet}`);
  }
  return { ok: true, results };
}
