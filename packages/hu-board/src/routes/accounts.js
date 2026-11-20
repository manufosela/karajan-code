// HU-4594 (ADR 0064 decision 6): /api/accounts. Reads ~/.karajan/accounts.json only (never rescue.json,
// so no key can reach the page); every write runs the same `kj account` the terminal runs.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "karajan-core/paths";
import { projectOf, runKj } from "./governance.js";

// The store's id rule: the leading letter or digit keeps an id from ever reading as a kj flag.
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PROVIDERS = new Set(["claude", "codex"]);
const PACE_FLAGS = { gap: "--gap", max: "--max", limitWait: "--limit-wait" };

/** accounts.json as the page sees it; a project is named by its last path segment, never its full path. */
function readView() {
  const file = path.join(getKarajanHome(), "accounts.json");
  if (!fs.existsSync(file)) return { accounts: [], default: {}, projects: {} };
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const accounts = (data.accounts ?? []).map(({ id, provider, dir, pace }) => ({ id, provider, dir, pace }));
  const projects = Object.fromEntries(Object.entries(data.projects ?? {}).map(([key, order]) => [path.basename(key), order]));
  return { accounts, default: data.default ?? {}, projects };
}

/** rescue.json as the page sees it: the rules and whether a key exists. The key field is never copied. */
function readRescue() {
  const file = path.join(getKarajanHome(), "rescue.json");
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return Object.fromEntries([...PROVIDERS].map((p) => [p, { hasKey: typeof data[p]?.key === "string", rules: data[p]?.rules ?? {} }]));
}

const isId = (value) => typeof value === "string" && ID.test(value);
const isNumber = (value) => Number.isFinite(value) && value >= 0;
const WINDOW = /^\d{1,2}-\d{1,2}$/;
// A leading letter or digit keeps a name from ever reading as a kj flag (as ID does).
const RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/;
const KEY_FIELDS = ["key", "keyEnv", "keyStdin"];
const isNames = (value) => Array.isArray(value) && value.every((v) => typeof v === "string" && RULE_NAME.test(v));
const rescueProblem = (body) => {
  if (KEY_FIELDS.some((f) => Object.hasOwn(body, f))) return "the board never carries a key";
  if (!PROVIDERS.has(body.provider)) return "provider must be claude or codex";
  const { limit, window: win, roles, models, daily, monthly } = body;
  const ok = (limit === undefined || typeof limit === "boolean") && (win === undefined || (typeof win === "string" && WINDOW.test(win)))
    && (roles === undefined || isNames(roles)) && (models === undefined || isNames(models))
    && [daily, monthly].every((n) => n === undefined || isNumber(n));
  return ok ? null : "limit must be a boolean, window 9-18, roles and models lists of names, daily and monthly numbers >= 0";
};

/** The first problem with the body, or null; argv is only built once this is null. */
const problemWith = {
  add: ({ id, provider, dir }) => (isId(id) && PROVIDERS.has(provider) && typeof dir === "string" && path.isAbsolute(dir) ? null : "id, provider (claude|codex) and an absolute dir are required"),
  id: ({ id }) => (isId(id) ? null : "id must be lowercase letters, digits, - or _ (up to 40)"),
  use: ({ ids }) => (Array.isArray(ids) && ids.length > 0 && ids.every(isId) ? null : "ids must be a list of account ids"),
  pace: (body) => (isId(body.id) && Object.keys(PACE_FLAGS).every((k) => body[k] === undefined || isNumber(body[k])) ? null : "id and numbers >= 0 are required"),
  rescue: rescueProblem,
  rescueRemove: ({ provider }) => (PROVIDERS.has(provider) ? null : "provider must be claude or codex"),
};

const router = Router();

router.get("/rescue", (req, res) => {
  try {
    res.json({ ok: true, rescue: readRescue() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

router.get("/", (req, res) => {
  try {
    res.json({ ok: true, ...readView() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

/** A POST route: validate the body (400, nothing runs), then run kj with the argv built from checked values. */
const write = (name, check, argvOf, { inProject = false } = {}) => router.post(`/${name}`, (req, res) => {
  const body = req.body ?? {};
  const problem = problemWith[check](body);
  if (problem) return res.status(400).json({ ok: false, error: problem });
  const dir = inProject ? projectOf(req) : process.cwd();
  if (!dir) return res.status(404).json({ ok: false, error: "not a karajan project" });
  return runKj(res, dir, ["account", ...argvOf(body)]);
});

write("add", "add", ({ id, provider, dir }) => ["add", id, "--provider", provider, "--dir", dir]);
write("default", "id", ({ id }) => ["default", id]);
write("remove", "id", ({ id }) => ["remove", id]);
write("use", "use", ({ ids, clear }) => ["use", ...ids, ...(clear === true ? ["--clear"] : [])], { inProject: true });
write("pace", "pace", (body) => ["pace", body.id, ...Object.entries(PACE_FLAGS).flatMap(([k, flag]) => (body[k] === undefined ? [] : [flag, String(body[k])]))]);

const RESCUE_FLAGS = ({ limit, window: win, roles, models, daily, monthly }) => [
  ...(limit === true ? ["--limit"] : []),
  ...(win === undefined ? [] : ["--window", win]),
  ...(roles === undefined ? [] : ["--roles", roles.join(",")]),
  ...(models === undefined ? [] : ["--models", models.join(",")]),
  ...(daily === undefined ? [] : ["--daily", String(daily)]),
  ...(monthly === undefined ? [] : ["--monthly", String(monthly)]),
];
write("rescue", "rescue", (body) => ["rescue", body.provider, ...RESCUE_FLAGS(body)]);
write("rescue/remove", "rescueRemove", ({ provider }) => ["rescue", provider, "--remove"]);

export default router;
