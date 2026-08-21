// C0 (KJC-TSK-0776, ADR 0007) — the audit trail of the most privileged
// component of the system. Same kernel as kj's policy decisions
// (@karajan-family/governance): append-only, hash-chained, verifiable offline.
// Sinks are the only I/O; the kernel never touches disk. Secrets NEVER land
// here: a detail that looks like one is refused loudly, not redacted quietly.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { recordDecision, verifyDecisionChain } from "@karajan-family/governance";

const SECRET_KEY = /secret|token|password|credential|private[_-]?key|^value$/i;

export function memorySink() {
  const lines = [];
  return { kind: "memory", append: (line) => { lines.push(line); }, lines: () => [...lines] };
}

export function fileSink(path) {
  return {
    kind: "file",
    append: (line) => { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${line}\n`, "utf8"); },
    lines: () => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()) : []),
  };
}

/** The sink declared in console.config.json. gcs-jsonl arrives with the GCP adapter (C1). */
export function sinkFromConfig(audit) {
  if (audit.sink === "memory") return memorySink();
  if (audit.sink === "file") return fileSink(audit.path);
  throw new Error(`audit sink "${audit.sink}" is not available in this build (gcs-jsonl lands with the GCP adapter, C1)`);
}

const looksSecret = (obj, path = "") => {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k)) return `${path}${k}`;
    const inner = looksSecret(v, `${path}${k}.`);
    if (inner) return inner;
  }
  return null;
};

/**
 * @param {{sink: {append: Function, lines: Function}}} deps
 */
export function createAudit({ sink }) {
  if (!sink || typeof sink.append !== "function" || typeof sink.lines !== "function") throw new TypeError("createAudit: a sink with append() and lines() is required");

  /** Seals one entry. who = {email, role}; outcome = ok | denied | error. */
  function record({ who, action, target = null, outcome, detail }) {
    if (!who?.email || !action || !outcome) throw new TypeError("audit.record: who.email, action and outcome are required");
    const leak = looksSecret(detail);
    if (leak) throw new Error(`audit.record: detail.${leak} looks like a secret — the audit trail never stores secrets`);
    return recordDecision({
      entry: { who: { email: who.email, role: who.role ?? null }, action, target, outcome, ...(detail === undefined ? {} : { detail }) },
      deps: { append: sink.append, lastLine: () => sink.lines().at(-1) ?? null },
    });
  }

  /** Runs fn and seals its outcome either way; the error is re-thrown after being recorded. */
  async function wrap({ who, action, target }, fn) {
    try {
      const result = await fn();
      record({ who, action, target, outcome: "ok", detail: result?.audit });
      return result;
    } catch (err) {
      record({ who, action, target, outcome: err?.status === 403 ? "denied" : "error", detail: { message: String(err?.message || err) } });
      throw err;
    }
  }

  const verify = () => verifyDecisionChain(sink.lines());
  const entries = () => sink.lines().map((l) => JSON.parse(l));
  return { record, wrap, verify, entries, sink };
}
