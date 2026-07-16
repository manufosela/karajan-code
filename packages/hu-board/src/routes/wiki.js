// KJC-TSK-0508 — HU Board Wiki panel route.
// POST /api/wiki/query → spawns `qmd query --format json` against the local
// per-project QMD wiki (registered by `kj init` via KJC-TSK-0506). Returns
// 503 with installable:true so the front renders an "Install QMD" CTA
// instead of a generic error when the binary is missing.
import { Router } from "express";
import { runCommand } from "karajan-core/process";

const router = Router();
const QMD_NOT_INSTALLED = /command not found|ENOENT|not recognized as/i;

router.post("/query", async (req, res) => {
  const raw = req.body?.query;
  const query = typeof raw === "string" ? raw.trim() : "";
  if (!query) return res.status(400).json({ ok: false, error: "query is required" });
  const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || 10, 1), 50);
  const collection = req.body?.collection ? String(req.body.collection).trim() : null;
  const fast = req.body?.fast === true;

  const args = ["query", query, "--format", "json", "-n", String(limit)];
  if (collection) args.push("-c", collection);
  if (fast) args.push("--no-rerank");

  try {
    const out = await runCommand("qmd", args, { timeout: 120_000 });
    if (out.exitCode === 127 || QMD_NOT_INSTALLED.test(out.stderr || "")) {
      return res.status(503).json({ ok: false, error: "qmd not installed", installable: true });
    }
    if (out.exitCode !== 0) {
      const msg = (out.stderr || out.stdout || `qmd exit ${out.exitCode}`).trim();
      return res.status(500).json({ ok: false, error: msg });
    }
    let results;
    try { results = JSON.parse(out.stdout || "[]"); }
    catch { return res.status(500).json({ ok: false, error: "qmd output is not valid JSON" }); }
    res.json({ ok: true, results, count: Array.isArray(results) ? results.length : 0 });
  } catch (err) {
    if (err?.code === "ENOENT") return res.status(503).json({ ok: false, error: "qmd not installed", installable: true });
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

export default router;
