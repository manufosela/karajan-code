import { execFile } from "node:child_process";
import { adviseEventPolicy } from "../harden/event-policy.js";
import { withTimeout } from "../utils/with-timeout.js";
import { STRATEGY } from "./types.js";

const TIMEOUT_MS = 20_000;
/** HU-5005: the child is SIGKILLed after `ms`; a timed-out or failed call has a non-zero exitCode (unverified). */
export const boundedRun = (ms) => (cmd, args) => new Promise((resolve) => execFile(cmd, args,
  { timeout: ms, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  (err, stdout, stderr) => resolve({ exitCode: err ? Number(err.code) || 1 : 0, stdout, stderr: stderr || err?.message || "" })));
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
