import { adviseEventPolicy } from "../harden/event-policy.js";
import { runCommand } from "../utils/process.js";
import { withTimeout } from "../utils/with-timeout.js";
import { STRATEGY } from "./types.js";

const TIMEOUT_MS = 20_000;
/** HU-5005: a run whose child runCommand kills after `ms`; it ends even if `run` ignores it (exit 143: unverified). */
export const boundedRun = (ms, run = runCommand) => (cmd, args) =>
  withTimeout(run(cmd, args, { timeout: ms }), ms, cmd).catch((err) => ({ exitCode: 143, stderr: err.message }));

/** What kj harden says (KJC-BUG-0532): null when it does not apply, else { status, lines } with its lines. */
export async function eventPolicyNotice({ projectDir, run = boundedRun(10_000), identity }) {
  const lines = [];
  const logger = { info: (m) => lines.push(m), warn: (m) => lines.push(m) };
  const res = await adviseEventPolicy({ projectDir, logger, run, identity });
  return res && { status: res.status, lines };
}

export function createEventPolicyCheck({ projectDir = process.cwd(), run, identity } = {}) {
  return {
    name: "event-policy",
    label: "Actions event policy",
    strategy: STRATEGY.MANUAL,
    detectTimeoutMs: TIMEOUT_MS + 1000,
    async detect() {
      const notice = await withTimeout(eventPolicyNotice({ projectDir, run, identity }), TIMEOUT_MS, "event-policy")
        .catch((err) => ({ status: "unverified", lines: [`could not check it: ${err.message}`] }));
      if (!notice) return { ok: true, hidden: true, detail: "not a public GitHub repo running pull_request_target" };
      if (notice.status === "ok") return { ok: true, detail: "pull_request_target is allowed" };
      const detail = notice.status === "missing" ? "no policy allows pull_request_target" : "the policies could not be read";
      return { ok: false, severity: "warn", detail, fix: notice.lines.map((l) => l.trim()).join(" ") };
    },
  };
}
