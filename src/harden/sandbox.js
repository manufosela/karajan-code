/**
 * sandbox — kj harden turns the host's Bash sandbox on (KJC-TSK-1087, ADR 0015).
 *
 * Claude Code sandboxes Bash with bubblewrap on Linux and seatbelt on macOS. With
 * allowUnsandboxedCommands off, a sandbox that cannot start leaves the session with
 * no Bash at all (pilot KJC-TSK-1083: Ubuntu 24.04 restricts user namespaces until
 * bwrap has an AppArmor profile). So the probe runs first, on this machine.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const USERNS_SYSCTL = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

const whichOnPath = (bin) => (process.env.PATH ?? "").split(delimiter).map((d) => join(d, bin)).find((p) => existsSync(p)) ?? null;
const runSync = (bin, args) => spawnSync(bin, args, { encoding: "utf8", timeout: 10_000 });

const missing = (tool, pkg) => ({ ok: false, reason: `${tool} is not installed`, remedy: `install ${pkg} (apt install ${pkg}, dnf install ${pkg})` });

function userNamespacesRestricted(readFile) {
  try { return readFile(USERNS_SYSCTL).trim() === "1"; } catch { return false; }
}

function probeLinux({ which, run, readFile }) {
  const bwrap = which("bwrap");
  if (!bwrap) return missing("bubblewrap (bwrap)", "bubblewrap");
  if (!which("socat")) return missing("socat", "socat");
  // The same namespaces Claude Code's sandbox asks for: user and network.
  const res = run(bwrap, ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-user", "--unshare-net", "true"]);
  if (res.status === 0) return { ok: true };
  if (userNamespacesRestricted(readFile)) {
    return {
      ok: false,
      reason: "AppArmor restricts unprivileged user namespaces and bwrap has no profile",
      remedy: "add /etc/apparmor.d/bwrap allowing userns for /usr/bin/bwrap, then load it with apparmor_parser -r (your user does this)",
    };
  }
  const detail = String(res.stderr ?? "").trim() || "exit " + res.status;
  return { ok: false, reason: `bwrap cannot create its namespaces: ${detail}`, remedy: "fix bwrap on this machine, then run kj harden again" };
}

/**
 * Can the host sandbox start on this machine? Never throws.
 * @returns {{ok: true} | {ok: false, reason: string, remedy?: string}}
 */
export function probeSandbox({ platform = process.platform, which = whichOnPath, run = runSync, readFile = (p) => readFileSync(p, "utf8"), exists = existsSync } = {}) {
  if (platform === "linux") return probeLinux({ which, run, readFile });
  if (platform === "darwin") {
    if (!exists("/usr/bin/sandbox-exec")) return { ok: false, reason: "sandbox-exec is missing from /usr/bin" };
    const res = run("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]);
    const detail = String(res.stderr ?? "").trim() || "exit " + res.status;
    return res.status === 0 ? { ok: true } : { ok: false, reason: `sandbox-exec cannot start a sandbox: ${detail}` };
  }
  return { ok: false, reason: `the host sandbox does not run on ${platform}` };
}

// KJC-TSK-1092: what the method needs from the sandbox (lessons of the pilot, KJC-TSK-1083).
// gh keeps its tokens in the keyring over D-Bus; kj review reaches a local SonarQube,
// which the sandbox's private localhost cannot (the reviewer agents run inside it).
// Outside the project only kj's state and package caches are writable, and the
// supervisor and the phone key stay out of reach.
const METHOD_SANDBOX = {
  // KJC-TSK-1114: with these denied, the Sentinel's Bash-text guards step aside (plan KJC-TSK-1081);
  // kj worktree runs outside, it is the sanctioned way to create and remove lanes.
  excludedCommands: ["gh *", "kj review *", "kj worktree *"],
  denyWrite: [
    ".karajan/harness", ".karajan/hooks", ".claude/settings.json", ".claude/settings.local.json", ".karajan/supervisor-provenance.json", "~/.karajan/supervisor-phone.json",
    "kj.config.yml", ".ragignore", ".kj/worktrees",
  ],
  allowWrite: ["~/.karajan", "~/.npm/_cacache", "~/.npm/_logs", "~/.npm/_npx", "~/.cache", "~/.config/configstore"],
  allowedDomains: [
    "github.com", "api.github.com", "*.githubusercontent.com", "uploads.github.com", "registry.npmjs.org",
    "api.openai.com", "chatgpt.com", "*.openai.com", "api.anthropic.com", "*.anthropic.com", "claude.ai",
    "api.githubcopilot.com", "*.githubcopilot.com", "*.googleapis.com",
  ],
};

const union = (have, add) => [...new Set([...(Array.isArray(have) ? have : []), ...add])];

function withMethodSandbox(settings) {
  const sb = settings.sandbox ?? {};
  const fsCfg = sb.filesystem ?? {};
  const net = sb.network ?? {};
  return {
    ...settings,
    sandbox: {
      ...sb,
      enabled: true,
      allowUnsandboxedCommands: false,
      excludedCommands: union(sb.excludedCommands, METHOD_SANDBOX.excludedCommands),
      filesystem: { ...fsCfg, denyWrite: union(fsCfg.denyWrite, METHOD_SANDBOX.denyWrite), allowWrite: union(fsCfg.allowWrite, METHOD_SANDBOX.allowWrite) },
      network: { ...net, allowedDomains: union(net.allowedDomains, METHOD_SANDBOX.allowedDomains) },
    },
  };
}

/**
 * Turn the host sandbox on in .claude/settings.local.json when it can start here.
 * @returns {{state: "on" | "off" | "left-off" | "untouched", reason?: string}}
 */
export function installSandbox({ projectDir, logger = console, probe = probeSandbox }) {
  const ready = probe();
  if (!ready.ok) {
    const remedy = ready.remedy ? `; ${ready.remedy}` : "";
    logger.info?.(`kj harden: host sandbox left off, ${ready.reason}${remedy}`);
    return { state: "off", reason: ready.reason };
  }
  const path = join(projectDir, ".claude", "settings.local.json");
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      logger.warn?.(`kj harden: ${path} is not valid JSON, the host sandbox was not written`);
      return { state: "untouched", reason: "invalid JSON" };
    }
  }
  if (settings.sandbox?.enabled === false) {
    logger.info?.(`kj harden: the host sandbox stays off, ${path} says enabled: false`);
    return { state: "left-off", reason: "enabled: false" };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(withMethodSandbox(settings), null, 2)}\n`);
  return { state: "on" };
}
