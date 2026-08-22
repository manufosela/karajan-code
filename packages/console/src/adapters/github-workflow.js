// C2 (KJC-TSK-0778, ADR 0007) — the github-workflow adapter: operations are
// workflow_dispatch runs in the deployment repo, authenticated as a GitHub
// App installation (short-lived token minted from an RS256 JWT signed with
// node:crypto — no PAT, no extra dependency). dispatch returns no run id, so
// the run is located by workflow + ref + creation time; never invented.
import { createSign } from "node:crypto";

const API = "https://api.github.com";
const b64url = (s) => Buffer.from(s).toString("base64url");

/** RS256 JWT for the App (10 min, iat skewed 60 s back as GitHub recommends). */
export function appJwt({ appId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 600, iss: String(appId) }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).end().sign(privateKey, "base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * @param {{github: {appId: string|number, installationId: string|number, privateKey: string},
 *          fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>}} deps
 */
export function createGithubWorkflowAdapter({ github, fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!github?.appId || !github?.installationId || !github?.privateKey) throw new TypeError("github-workflow: github.appId, github.installationId and github.privateKey are required (the key from the environment, never from the config)");
  let cached = null;

  async function token() {
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    const res = await fetchImpl(`${API}/app/installations/${github.installationId}/access_tokens`, {
      method: "POST", headers: { authorization: `Bearer ${appJwt({ appId: github.appId, privateKey: github.privateKey, now: now() })}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`github-workflow: installation token refused (${res.status})`);
    const body = await res.json();
    cached = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    return cached.token;
  }
  const gh = async (path, init = {}) => {
    const res = await fetchImpl(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${await token()}`, accept: "application/vnd.github+json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`github-workflow: ${init.method || "GET"} ${path} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  const runRef = (operation, id) => `github:${operation.repo}:${id}`;
  // A pending ref carries the dispatch instant: runStatus/runLog answer "pending" for it, never a parse error (review catch).
  const parseRef = (ref) => {
    const m = /^github:([^:]+\/[^:]+):(\d+|pending:\d+)$/.exec(ref);
    if (!m) throw new Error(`github-workflow: not a run ref "${ref}"`);
    return m[2].startsWith("pending:") ? { repo: m[1], pendingSince: Number(m[2].slice(8)) } : { repo: m[1], id: m[2] };
  };
  const pendingStatus = (ref, since) => ({ runRef: ref, status: "pending", conclusion: null, dispatchedAt: new Date(since).toISOString(), note: "workflow_dispatch accepted; the run had not appeared yet — check the workflow page" });

  return {
    name: "github-workflow",
    /** Fires workflow_dispatch and locates the run it created (retrying a few seconds). */
    async dispatch(operation, inputs = {}) {
      const startedAt = now();
      await gh(`/repos/${operation.repo}/actions/workflows/${encodeURIComponent(operation.workflow)}/dispatches`, { method: "POST", body: JSON.stringify({ ref: operation.ref || "main", inputs }) });
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await sleep(attempt === 0 ? 1500 : 2500);
        const { workflow_runs: runs = [] } = await gh(`/repos/${operation.repo}/actions/workflows/${encodeURIComponent(operation.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(operation.ref || "main")}&per_page=5`);
        const run = runs.find((r) => Date.parse(r.created_at) >= startedAt - 5_000);
        if (run) return { runRef: runRef(operation, run.id), url: run.html_url, status: run.status };
      }
      return { runRef: `github:${operation.repo}:pending:${startedAt}`, status: "pending", dispatchedAt: new Date(startedAt).toISOString(), url: `https://github.com/${operation.repo}/actions/workflows/${operation.workflow}` };
    },
    async runStatus(ref) {
      const { repo, id, pendingSince } = parseRef(ref);
      if (pendingSince) return pendingStatus(ref, pendingSince);
      const r = await gh(`/repos/${repo}/actions/runs/${id}`);
      return { runRef: ref, status: r.status, conclusion: r.conclusion, url: r.html_url, createdAt: r.created_at, updatedAt: r.updated_at };
    },
    /** Jobs and steps summary — the log zip is not downloaded; the run url is where the full log lives. */
    async runLog(ref) {
      const { repo, id, pendingSince } = parseRef(ref);
      if (pendingSince) return pendingStatus(ref, pendingSince).note;
      const { jobs = [] } = await gh(`/repos/${repo}/actions/runs/${id}/jobs`);
      return jobs.map((j) => `${j.name}: ${j.status}${j.conclusion ? ` (${j.conclusion})` : ""}\n${(j.steps || []).map((s) => `  - ${s.name}: ${s.status}${s.conclusion ? ` (${s.conclusion})` : ""}`).join("\n")}`).join("\n");
    },
  };
}

/** The private key comes from the environment, never from console.config.json. */
export function githubKeyFromEnv(env = process.env) {
  if (env.CONSOLE_GITHUB_APP_KEY) return env.CONSOLE_GITHUB_APP_KEY.replaceAll("\\n", "\n");
  if (env.CONSOLE_GITHUB_APP_KEY_FILE) return null; // read by the caller (fs stays out of this module)
  return null;
}
