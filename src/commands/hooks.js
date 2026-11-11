// HU-3773 (ADR 0051): `kj hooks` shows the command each hook step runs and where it comes
// from; `kj hooks set|unset` pins or releases one. Pinning replaces a quality step, so it is a human act.
import path from "node:path";
import { loadProjectConfig, writeConfig } from "../config/loader.js";
import { humanAct } from "../harden/human-act.js";
import { signAct } from "../harden/act-sign.js";
import { makefileCommands } from "../harden/makefile-targets.js";
import { HOOK_STEPS, pinnedCommands, validatePin } from "../harden/pinned-commands.js";
import { resolveCmds } from "./harden.js";

const CONFIG_FILE = path.join(".karajan", "kj.config.yml");
const AFTER = "The hooks change only after `kj harden` and the seal.";

// ADR 0018: the full human act, refused to an agent session, then signed by the phone if enrolled.
async function pinAct({ projectDir, kjVersion, change, deps = {} }) {
  humanAct("hooks-set", { env: deps.env ?? process.env, tty: deps.ttyHuman ?? process.stdout.isTTY, ancestry: deps.ancestry ?? {}, confirm: deps.confirm });
  await signAct("hooks-set", {
    projectDir, home: deps.home, logger: deps.logger ?? console, deps, kjVersion, files: [{ file: ".karajan/kj.config.yml", sha256: "" }],
    changes: [{ file: ".karajan/kj.config.yml", status: "modified", summary: change, diff: change, truncated: false }],
  });
}

async function savePins({ projectDir, step, command, load, write }) {
  const projectConfig = (await load(projectDir)) || {};
  const commands = { ...projectConfig.harden?.commands };
  if (command === null) delete commands[step];
  else commands[step] = command;
  projectConfig.harden = { ...projectConfig.harden, commands };
  await write(path.join(projectDir, CONFIG_FILE), projectConfig);
}

export async function hooksSetCommand({
  step, command, projectDir = process.cwd(), kjVersion = "unknown", deps = {},
  load = loadProjectConfig, write = writeConfig, act = pinAct, print = console.log,
}) {
  validatePin(step, command);
  await act({ projectDir, kjVersion, deps, change: `${step}: ${command}` });
  await savePins({ projectDir, step, command, load, write });
  print(`✓ ${step} pinned: ${command}\n${AFTER}`);
  return { step, command };
}

export async function hooksUnsetCommand({
  step, projectDir = process.cwd(), kjVersion = "unknown", deps = {},
  load = loadProjectConfig, write = writeConfig, act = pinAct, print = console.log,
}) {
  validatePin(step, "x");
  await act({ projectDir, kjVersion, deps, change: `${step}: unpinned` });
  await savePins({ projectDir, step, command: null, load, write });
  print(`✓ ${step} unpinned\n${AFTER}`);
  return { step };
}

/** Each step with the command it runs and its origin: pinned, Makefile or detected. */
export async function hooksCommand({ projectDir = process.cwd(), load = loadProjectConfig, print = console.log }) {
  const pinned = await pinnedCommands(projectDir, load);
  const make = makefileCommands(projectDir);
  const detected = await resolveCmds(projectDir, null);
  const byPrecedence = [["pinned", pinned], ["Makefile", make], ["detected", detected]];
  const steps = HOOK_STEPS.map((step) => {
    const [origin, source] = byPrecedence.find(([, commands]) => commands[step]) ?? ["none", {}];
    return { step, command: source[step] ?? null, origin };
  });
  for (const { step, command, origin } of steps) print(`${step.padEnd(7)} ${command ?? "-"}  (${origin})`);
  return steps;
}
