import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "./paths.js";
import { GITHUB_REMOTE } from "../harden/branch-protection.js";
import { eventPolicyNotice, boundedRun } from "../checks/event-policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const gitOut = (run, cwd, args) => run("git", ["-C", cwd, ...args]).then((res) => (res?.exitCode === 0 ? String(res.stdout).trim() : ""));
const readStamps = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };

/** HU-5005: once a day per GitHub repo, on stderr, kj harden's event-policy warning; only a definitive answer is stamped. Never throws. */
export async function printEventPolicyReminder({ cwd = process.cwd(), now = Date.now(), home = getKarajanHome(),
  env = process.env, write = (s) => process.stderr.write(s), timeoutMs = 5_000, run = boundedRun(timeoutMs), identity } = {}) {
  try {
    if (env.KJ_NO_UPDATE_CHECK === "1") return;
    const projectDir = await gitOut(run, cwd, ["rev-parse", "--show-toplevel"]);
    const match = projectDir && GITHUB_REMOTE.exec(await gitOut(run, projectDir, ["remote", "get-url", "origin"]));
    if (!match) return;
    const repo = `${match[1]}/${match[2]}`;
    const stampFile = path.join(home, "event-policy-reminder.json");
    const age = now - readStamps(stampFile)?.[repo];
    if (age >= 0 && age < DAY_MS) return; // a stamp from the future (clock moved back) does not silence it
    const notice = await eventPolicyNotice({ projectDir, run, identity });
    if (notice?.status === "unverified") return; // no stamp: the next command asks gh again
    if (notice?.status === "missing") write(`${notice.lines.join("\n")}\n`);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(stampFile, JSON.stringify({ ...readStamps(stampFile), [repo]: now }));
  } catch { /* Reminder only: never fail the command because of it. */ }
}
