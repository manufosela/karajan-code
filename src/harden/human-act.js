/**
 * The layers that make a command a HUMAN act (ADR 0009), out of the supervisor's
 * seal so that other human-only commands use the very same ones (KJC-TSK-0951).
 *
 *  1-2. the environment and the terminal: an agent session declares itself;
 *  3.   the process ancestry: a kj launched by an agent DESCENDS from it, and
 *       that is in /proc whoever fakes the pty or cleans the environment;
 *  4.   a random nonce typed back, read from the real controlling terminal.
 */
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

const AGENT_PROC = /claude|codex|copilot|gemini|opencode|\bagy\b/i;

export function agentAncestry({ pid = process.pid, readProc = null, maxDepth = 40 } = {}) {
  const read = readProc || ((p) => {
    const stat = readFileSync(`/proc/${p}/stat`, "utf8");
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    let cmd = "";
    try { cmd = readFileSync(`/proc/${p}/cmdline`).toString("utf8").replaceAll("\0", " "); } catch { /* gone */ }
    return { ppid, cmd };
  });
  let cur = pid;
  for (let i = 0; i < maxDepth && cur > 1; i += 1) {
    let info;
    try { info = read(cur); } catch { return { agent: false, unknown: true }; }
    if (info?.cmd && AGENT_PROC.test(info.cmd)) return { agent: true, match: info.cmd.slice(0, 80) };
    if (!Number.isFinite(info?.ppid) || info.ppid === cur) break;
    cur = info.ppid;
  }
  return { agent: false };
}

/** Layers 1 to 3: throws when `what` runs inside an agent session. */
export function refuseAgentSession(what, { env = process.env, tty = process.stdout.isTTY, ancestry = {} } = {}) {
  if (env.CLAUDECODE || env.KJ_NON_INTERACTIVE === "1" || !tty) {
    throw new Error(`${what} es un acto humano: córrelo desde TU terminal, fuera de una sesión de agente (ADR 0009)`);
  }
  const anc = agentAncestry(ancestry);
  if (anc.agent) {
    throw new Error(`${what} es un acto humano y este proceso desciende de un agente (${anc.match}) — ni con pty falso ni con el entorno limpio (ADR 0009)`);
  }
}

// The answer comes from the process's REAL tty (not stdin, which an attacker
// feeds through a pipe): /dev/tty only exists with a controlling terminal.
function readTty(what, nonce) {
  process.stdout.write(`${what}: teclea "${nonce}" para confirmar que eres humano: `);
  try {
    const buf = Buffer.alloc(64);
    const fd = openSync("/dev/tty", "r");
    const n = readSync(fd, buf, 0, 64);
    closeSync(fd);
    return buf.toString("utf8", 0, n).trim();
  } catch {
    return null;
  }
}

/**
 * Layer 4: a random nonce typed back. A blind feeder does not know the code;
 * automating its reading takes an expect driver, which is premeditation.
 * @param {string} what
 * @param {(nonce: string) => string|null} [confirm] test seam
 */
export function confirmHuman(what, confirm = null) {
  const nonce = randomBytes(3).toString("hex");
  const answer = confirm ? confirm(nonce) : readTty(what, nonce);
  if (answer !== nonce) throw new Error(`${what}: confirmación humana fallida (esperaba "${nonce}") — ADR 0009`);
}

/**
 * KJC-TSK-0966 (HUM-C, ADR 0018): the CLOSED catalog of human acts. Every
 * command that changes who governs, or that destroys work, is listed here and
 * runs through this module; an architecture test fails on a module of the
 * catalog that skips it and on a writer of governance files that is not here.
 * `module` names the file that implements the act; `pending` names the card
 * that will, for acts the ADR declares and kj does not have yet.
 */
export const HUMAN_ACTS = Object.freeze({
  "supervisor-seal": { label: "harden --commit", module: "src/harden/supervisor-commit.js" },
  "rules-approve": { label: "kj rules approve", module: "src/commands/rules-approve.js" },
  "phone-enroll": { label: "kj identity enroll-phone", module: "src/commands/identity.js" },
  "handoff-run": { label: "kj handoff run", module: null, pending: "KJC-TSK-0968" },
  "security-level-down": { label: "kj security normal", module: "src/harden/security-level.js" },
});

/**
 * The one mechanism, by catalog id: `refuse` (layers 1 to 3) and `confirm`
 * (layer 4), apart because an act may check things in between (the seal looks
 * at the stage before asking for the nonce). `humanAct` runs both.
 * @param {keyof typeof HUMAN_ACTS} id
 */
export function humanActOf(id) {
  const act = HUMAN_ACTS[id];
  if (!act) throw new Error(`"${id}" is not in the catalog of human acts (src/harden/human-act.js, ADR 0018)`);
  return {
    label: act.label,
    refuse: (opts = {}) => refuseAgentSession(act.label, opts),
    confirm: (confirm = null) => confirmHuman(act.label, confirm),
  };
}

export function humanAct(id, { env, tty, ancestry, confirm } = {}) {
  const act = humanActOf(id);
  act.refuse({ env, tty, ancestry });
  act.confirm(confirm);
}
