import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "./paths.js";
import { RECOMMENDED_NODE_MAJOR, NODE_UPGRADE_GUIDE } from "../checks/node.js";

const STAMP_FILE = "node-reminder.json";
const INTERVAL_MS = 24 * 60 * 60 * 1000;

const shownRecently = (stamp, now) => {
  try {
    const { shownAt } = JSON.parse(fs.readFileSync(stamp, "utf8"));
    const age = now - shownAt;
    // A stamp from the future (clock moved back) must not silence the reminder.
    return Number.isFinite(shownAt) && age >= 0 && age < INTERVAL_MS;
  } catch {
    return false;
  }
};

/**
 * Reminds, at most once a day and on stderr only, that Node 24 is recommended.
 * It is a reminder, not a gate: a stamp that cannot be read or written means
 * "show it" and never stops the command.
 */
export function printNodeReminder({
  version = process.version,
  now = Date.now(),
  home = getKarajanHome(),
  env = process.env,
  write = (s) => process.stderr.write(s),
} = {}) {
  try {
    if (env.KJ_NO_UPDATE_CHECK === "1") return;
    if (Number.parseInt(String(version).replace(/^v/, ""), 10) >= RECOMMENDED_NODE_MAJOR) return;
    const stamp = path.join(home, STAMP_FILE);
    if (shownRecently(stamp, now)) return;
    write(`  Node ${version} works with kj, but Node ${RECOMMENDED_NODE_MAJOR} is recommended (Node 22 support ends April 2027; kj 6.0 will require ${RECOMMENDED_NODE_MAJOR}): ${NODE_UPGRADE_GUIDE}\n`);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(stamp, JSON.stringify({ shownAt: now }));
  } catch {
    // Reminder only: never fail the command because of it.
  }
}
