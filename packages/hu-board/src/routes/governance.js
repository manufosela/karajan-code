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

router.get("/", async (req, res) => {
  const raw = typeof req.query.dir === "string" ? req.query.dir.trim() : "";
  if (!raw) return res.status(400).json({ ok: false, error: "dir is required (absolute project directory)" });
  const dir = resolve(raw);
  if (!existsSync(join(dir, ".karajan")) || !statSync(join(dir, ".karajan")).isDirectory()) {
    return res.status(404).json({ ok: false, error: "not a karajan project: no .karajan/ directory", dir });
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

export default router;
