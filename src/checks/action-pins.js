/**
 * KJC-TSK-0870 — the maintenance that pinning moved onto kj.
 *
 * Issue #1374 was right: `kj harden` generated workflows with moving tags
 * (`actions/checkout@v4`), and kj's own `kj audit --security` flagged them, so
 * five of the project's seven warnings came from files kj had just written.
 * They are pinned to commit SHAs now.
 *
 * Pinning trades one risk for another: nobody can move the tag under you, and
 * nobody delivers the upstream patch either. A pin that nobody revisits is a
 * vulnerability with a long shelf life, and since kj writes those lines, kj is
 * the one that has to notice. That is this check.
 *
 * It lives in `kj doctor` (a person asking about their environment) and NOT in
 * `kj check` (a gate that CI runs): a gate that needs the network is a gate
 * that fails on a plane, and turning red over an unreachable API is how a gate
 * loses its credibility.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { PINNED_ACTIONS } from "../harden/workflow-templates.js";

const execFileAsync = promisify(execFile);
// Nobody waits for a diagnostic. Both clients are capped, and the pins are
// asked in parallel, so an unreachable GitHub costs one timeout and not one
// per action.
const CALL_TIMEOUT_MS = 5_000;

const STRATEGY_MANUAL = "manual";
const API = "https://api.github.com/repos";

/** `owner/repo@sha # tag` as written in the templates. */
export function parsePin(pin) {
  const m = /^([^@\s]+)@([0-9a-f]{40})\s*#\s*(\S+)$/i.exec(String(pin || "").trim());
  return m ? { action: m[1], sha: m[2].toLowerCase(), tag: m[3] } : null;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const clean = (s) => String(s || "").trim().toLowerCase();

/**
 * The SHA a tag points at today, asked through `gh` when it is there.
 *
 * Measured, not assumed: plain unauthenticated `fetch` answered 403 on the
 * first real run, because GitHub allows 60 calls an hour PER IP and any shared
 * or NAT-ed address burns that between everyone behind it. A check that
 * answers "could not check" almost always is decorative. `gh` carries the
 * user's own credentials (5000/hour) and kj already relies on it elsewhere;
 * `fetch` stays as the fallback for whoever has no gh.
 *
 * @returns {Promise<string|null>} null when the answer cannot be trusted.
 */
export async function currentSha(action, tag, { fetchFn = fetch, ghFn = ghSha } = {}) {
  const viaGh = await ghFn(action, tag);
  if (viaGh) return viaGh;
  const res = await fetchFn(`${API}/${action}/commits/${encodeURIComponent(tag)}`, {
    headers: { Accept: "application/vnd.github.sha", "User-Agent": "karajan-code" },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res?.ok) return null;
  const body = clean(await res.text());
  return SHA_RE.test(body) ? body : null;
}

/** @returns {Promise<string|null>} null when gh is absent, unauthenticated or unhappy. */
async function ghSha(action, tag) {
  try {
    const { stdout } = await execFileAsync("gh", ["api", `repos/${action}/commits/${tag}`, "--jq", ".sha"], {
      encoding: "utf8",
      timeout: CALL_TIMEOUT_MS,
    });
    const sha = clean(stdout);
    return SHA_RE.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** @internal Exported for dynamic import from tests. */
export function createActionPinsCheck({ pins = PINNED_ACTIONS, deps = {} } = {}) {
  return {
    name: "action-pins",
    label: "actions fijadas por SHA",
    strategy: STRATEGY_MANUAL,
    describe: "Detect a pinned GitHub Action whose tag has moved on without it",
    async detect() {
      const entries = Object.entries(pins).map(([key, pin]) => ({ key, ...(parsePin(pin) || {}) }));
      const malformed = entries.filter((e) => !e.sha);
      const asked = await Promise.all(
        entries.filter((x) => x.sha).map(async (e) => {
          // offline, rate limited, DNS down, gh missing: not an answer
          const latest = await currentSha(e.action, e.tag, deps).catch(() => null);
          return { ...e, latest };
        }),
      );
      const stale = asked.filter((e) => e.latest && e.latest !== e.sha);
      const unchecked = asked.filter((e) => !e.latest).length;

      if (malformed.length > 0) {
        return {
          ok: false,
          severity: "warn",
          detail: `pin mal formado: ${malformed.map((m) => m.key).join(", ")} — un pin que no se puede leer no se puede comprobar`,
          fix: "revisa PINNED_ACTIONS en src/harden/workflow-templates.js: owner/repo@<sha de 40> # <tag>",
        };
      }
      if (stale.length > 0) {
        return {
          ok: false,
          severity: "warn",
          detail: stale.map((s) => `${s.action} ${s.tag} apunta hoy a ${s.latest.slice(0, 12)} y kj fija ${s.sha.slice(0, 12)}`).join(" · "),
          fix: stale.map((s) => `${s.action}@${s.latest} # ${s.tag}`).join("  ·  "),
        };
      }
      // Never claim what was not looked at (the card's own acceptance
      // criterion): an unreachable API is said, not passed off as green.
      if (unchecked > 0) {
        return {
          ok: true,
          severity: "info",
          detail: unchecked === entries.length
            ? "no se pudo comprobar ninguna action (¿sin red o con la API de GitHub limitando?)"
            : `${unchecked} action(s) sin comprobar (¿sin red o con la API de GitHub limitando?)`,
        };
      }
      return { ok: true, severity: "info", detail: `${entries.length} action(s) fijadas y al día` };
    },
  };
}
