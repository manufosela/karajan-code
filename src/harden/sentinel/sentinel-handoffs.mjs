// KJC-TSK-1475: the agent minds what waits for its user (kj handoff). Read here
// straight from .karajan/handoffs, never through kj: every tool call asks, and a
// spawn would slow them all. Anything unreadable counts as nothing (fail open).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isReadOnlyCommand } from "./sentinel-shell.mjs";

export const REMIND_EVERY_MS = 30 * 60 * 1000;
const HANDOFF_FILE = /^[0-9a-f]{8}\.json$/;
// What the agent may still do while a blocking handoff waits: read, ask, and close it.
const ALLOWED_TOOLS = new Set(["Read", "Grep", "Glob", "AskUserQuestion"]);
// A single line: a newline or \r would carry a second command behind it.
const HANDOFF_CMD = /^[^\S\r\n]*kj[^\S\r\n]+handoff([^\S\r\n][^;&|`$<>\r\n]*)?$/;
// KJC-BUG-0677: two reads of waiting the shell reader does not know (gh, kj). Literal
// forms only: no newline, operator, redirection, quote or expansion fits in them.
const WAIT_CMDS = [/^[ \t]*gh pr checks( [\w./:=-]+)*[ \t]*$/, /^[ \t]*kj [a-z-]+ --help[ \t]*$/];
const mayRun = (command) => HANDOFF_CMD.test(command) || WAIT_CMDS.some((re) => re.test(command)) || isReadOnlyCommand(command);

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

/** The pending handoffs of the lane at `top`, oldest first. */
export const pendingHandoffs = (top) => {
  const dir = join(top, ".karajan", "handoffs");
  let names;
  try { names = readdirSync(dir).filter((n) => HANDOFF_FILE.test(n)); } catch { return []; }
  return names.map((n) => readJson(join(dir, n)))
    .filter((h) => h?.status === "pending" && typeof h.command === "string")
    .toSorted((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
};

/** Whether the turn's end must remind the user: something pending and the last reminder 30 min old or none. */
export const reminderDue = (pending, lastAt, now) => pending.length > 0 && (typeof lastAt !== "number" || now - lastAt >= REMIND_EVERY_MS);

const lineOf = (h) => "- " + h.id + ": " + h.command + (h.why ? " (" + h.why + ")" : "") + (h.blocking ? " [BLOQUEANTE]" : "");

/** What the Stop hook tells the agent before it may end the turn. */
export const reminderText = (pending) => "karajan sentinel: antes de terminar, lo que espera a tu usuario (kj handoff):\n"
  + pending.map(lineOf).join("\n")
  + "\nComprueba cada uno: si ya está hecho o ya no aplica, ciérralo con kj handoff done <id> y díselo en una línea."
  + " Termina tu mensaje con los que queden, como ÚLTIMAS líneas y sin nada después: qué tiene que hacer y el paso único para hacerlo."
  + " No pares tu trabajo por los que no son bloqueantes.";

/**
 * The reminder the turn's end owes the lane at `top`, or null; when there is one it is
 * noted in the Sentinel's `state` (the caller saves it), so the next one waits 30 min.
 */
export const takeReminder = (state, top, now) => {
  const pending = pendingHandoffs(top);
  const reminded = (state.handoff_reminded ||= {});
  if (!reminderDue(pending, reminded[top], now)) return null;
  reminded[top] = now;
  return reminderText(pending);
};

/** The deny for a tool call while a blocking handoff waits, or null when the call may go. */
export const blockingDeny = (pending, tool, input) => {
  const stops = pending.filter((h) => h.blocking === true);
  if (stops.length === 0 || ALLOWED_TOOLS.has(tool)) return null;
  if (tool === "Bash" && mayRun(String(input?.command ?? ""))) return null;
  return "karajan sentinel: hay un encargo BLOQUEANTE para tu usuario:\n" + stops.map(lineOf).join("\n")
    + "\nPara: termina el turno preguntándole solo por esto, con el paso único que tiene que dar."
    + " Cuando lo haga o te diga que sigas sin él, ciérralo con kj handoff done <id> y sigue.";
};
