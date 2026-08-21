// GUI-A (KJC-TSK-0771, epic KJC-PCS-0076) — governance snapshot of ONE
// project for the dashboard: the declared policy, the deterministic report
// (`kj policy report --json`), the anchor state and the clone's declared
// identity. The board stays decoupled from the CLI tree (KJC-TSK-0632): the
// report comes from the kj binary, everything else is read from the
// project's .karajan/ files. Read-only; actions land in GUI-C.
import { Router } from "express";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { runCommand } from "karajan-core/process";

const router = Router();

const readYaml = (file) => {
  if (!existsSync(file)) return { found: false, data: null, error: null };
  try { return { found: true, data: yaml.load(readFileSync(file, "utf8")), error: null }; }
  catch (err) { return { found: true, data: null, error: String(err.message || err) }; }
};

/** policy.yml → flat rules the view can list (rule ids match the engine's). */
function policySummary(dir) {
  const { found, data, error } = readYaml(join(dir, ".karajan", "policy.yml"));
  if (!found) return { declared: false, rules: [], invariants: [], error: null };
  if (error || !data || typeof data !== "object") return { declared: true, rules: [], invariants: [], error: error || "policy.yml is not a mapping" };
  const rules = [];
  for (const [role, caps] of Object.entries(data.roles || {})) {
    for (const [cap, spec] of Object.entries(caps || {})) {
      if (!spec || typeof spec !== "object") continue;
      for (const kind of ["deny", "allow"]) {
        if (Array.isArray(spec[kind])) rules.push({ rule_id: `roles.${role}.${cap}.${kind}`, role, cap, kind, patterns: spec[kind], enforcement: spec.enforcement || "warn", class: spec.class || null });
      }
    }
  }
  const invariants = (Array.isArray(data.invariants) ? data.invariants : []).map((i) => ({ ...i, enforcement: i?.enforcement || "warn" }));
  return { declared: true, version: data.version ?? null, rules, invariants, error: null };
}

function anchorState(dir, chainLength) {
  const file = join(dir, ".karajan", "policy-anchor.json");
  if (!existsSync(file)) return { sealed: false, length: 0, current: chainLength, stale: chainLength > 0 };
  try {
    const a = JSON.parse(readFileSync(file, "utf8"));
    const length = Number(a.length) || 0;
    return { sealed: true, head: a.head ?? null, ts: a.ts ?? null, length, current: chainLength, stale: chainLength !== length };
  } catch (err) { return { sealed: false, length: 0, current: chainLength, stale: true, error: String(err.message || err) }; }
}

function identityState(dir) {
  const { found, data } = readYaml(join(dir, ".karajan", "identity.local.yml"));
  const ok = found && data && typeof data === "object" && data.gh_user && data.git_email;
  return ok ? { declared: true, gh_user: String(data.gh_user), git_email: String(data.git_email) } : { declared: false };
}

/** The board may run from a package inside a monorepo: climb to the nearest .karajan/. */
function nearestProject(start) {
  let cur = resolve(start);
  for (;;) {
    if (existsSync(join(cur, ".karajan"))) return cur;
    const up = resolve(cur, "..");
    if (up === cur) return resolve(start);
    cur = up;
  }
}

router.get("/", async (req, res) => {
  // GUI-B: without dir, the project the board was started for (same rule as
  // the config editor: KJ_PROJECT_DIR || cwd) — the view remembers the rest.
  const raw = (typeof req.query.dir === "string" && req.query.dir.trim()) || nearestProject(process.env.KJ_PROJECT_DIR || process.cwd());
  const dir = resolve(raw);
  if (!existsSync(join(dir, ".karajan")) || !statSync(join(dir, ".karajan")).isDirectory()) {
    // Data, not a server error: the view shows the attempted dir and lets the user fix it.
    return res.json({ ok: false, error: "not a karajan project: no .karajan/ directory", dir });
  }
  let report;
  try {
    // exit 1 = broken chain: the JSON still carries chain.ok=false — data, not a server error.
    const r = await runCommand("kj", ["policy", "report", "--json"], { cwd: dir });
    if (r.exitCode === 127) return res.status(503).json({ ok: false, error: "kj not installed", installable: true });
    const line = String(r.stdout || "").trim().split("\n").findLast((l) => l.startsWith("{"));
    report = line ? JSON.parse(line) : null;
    if (!report) return res.status(502).json({ ok: false, error: "kj policy report produced no JSON", exitCode: r.exitCode, stderr: String(r.stderr || "").slice(0, 500) });
  } catch (err) {
    if (err?.code === "ENOENT") return res.status(503).json({ ok: false, error: "kj not installed", installable: true });
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
  res.json({ ok: true, dir, policy: policySummary(dir), report, anchor: anchorState(dir, report.chain?.length ?? 0), identity: identityState(dir) });
});

// GUI-C (KJC-TSK-0773): actions go through the SAME CLI commands the
// terminal uses — the inexemptable (security, defaults.*) is refused by kj
// itself and its message travels back verbatim; nothing is re-implemented.
const projectOf = (req) => {
  const raw = (typeof req.body?.dir === "string" && req.body.dir.trim()) || nearestProject(process.env.KJ_PROJECT_DIR || process.cwd());
  const dir = resolve(raw);
  return existsSync(join(dir, ".karajan")) ? dir : null;
};

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

async function runKj(res, dir, args) {
  try {
    const r = await runCommand("kj", args, { cwd: dir });
    // kj logs with colours; the board shows text (ESC built by code: no control char in a regex literal).
    const output = `${r.stdout || ""}${r.stderr || ""}`.replaceAll(ANSI, "").trim();
    if (r.exitCode === 127) return res.status(503).json({ ok: false, error: "kj not installed", installable: true });
    if (r.exitCode !== 0) return res.status(409).json({ ok: false, error: output || `kj exited ${r.exitCode}`, exitCode: r.exitCode });
    return res.json({ ok: true, output });
  } catch (err) {
    if (err?.code === "ENOENT") return res.status(503).json({ ok: false, error: "kj not installed", installable: true });
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}

router.post("/grant", async (req, res) => {
  const dir = projectOf(req);
  if (!dir) return res.status(404).json({ ok: false, error: "not a karajan project" });
  const { rule, until, reason } = req.body || {};
  if (!rule || !until || !String(reason || "").trim()) return res.status(400).json({ ok: false, error: "rule, until (ISO) and reason are required — an exception without who/why/until is a hole" });
  if (!identityState(dir).declared) return res.status(409).json({ ok: false, error: "identity not declared for this clone — run kj identity set first (the grant must be attributable)" });
  return runKj(res, dir, ["policy", "grant", "--rule", String(rule), "--until", String(until), "--reason", String(reason).trim()]);
});

// Spoken rule: `kj policy add <text>` proposes the diff; ONLY apply:true adds
// --yes. The engine validates the vocabulary; the human confirms in the board.
router.post("/rule", async (req, res) => {
  const dir = projectOf(req);
  if (!dir) return res.status(404).json({ ok: false, error: "not a karajan project" });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "text is required — say the rule" });
  return runKj(res, dir, ["policy", "add", text, ...(req.body?.apply === true ? ["--yes"] : [])]);
});

router.post("/anchor", async (req, res) => {
  const dir = projectOf(req);
  if (!dir) return res.status(404).json({ ok: false, error: "not a karajan project" });
  return runKj(res, dir, ["policy", "anchor"]);
});

export default router;
