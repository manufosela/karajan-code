// BOOT-C (KJC-TSK-0862, ADR "el proyecto se arranca y se prueba como lo haría
// una persona") — kj declares the CONTRACT of the start script and verifies it;
// the project writes it. kj cannot know how a project it has never seen is
// launched, and generating one by stack detection would produce exactly the
// decorative artefact this codebase already rejects (a config without its tool).
//
// Two facts it establishes before any work starts: the project runs, or it was
// ALREADY broken. Saying that afterwards is worthless.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startScriptPath, runStartScript, START_SCRIPT_CONTRACT, MAX_OUTPUT_BYTES } from "../../src/start/project-script.js";

let dir;
const write = (rel, text, mode) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text, mode ? { mode } : undefined);
};

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-startsh-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the project's start script", () => {
  it("absent: says what it is for and what it must do, and never invents one", async () => {
    const r = await runStartScript({ projectDir: dir });
    expect(r.status).toBe("absent");
    expect(r.contract).toBe(START_SCRIPT_CONTRACT);
    expect(r.contract).toMatch(/humo/i);
    expect(fs.existsSync(startScriptPath(dir))).toBe(false);
  });

  it("green: the tree is known to run before anything is touched", async () => {
    write(".karajan/start.sh", "#!/bin/sh\necho listo\n", 0o755);
    const r = await runStartScript({ projectDir: dir });
    expect(r.status).toBe("ok");
    expect(r.output).toMatch(/listo/);
  });

  it("red: the tree was ALREADY broken, and that is said before implementing", async () => {
    write(".karajan/start.sh", "#!/bin/sh\necho falla 1>&2\nexit 3\n", 0o755);
    const r = await runStartScript({ projectDir: dir });
    expect(r.status).toBe("broken");
    expect(r.exitCode).toBe(3);
    expect(r.output).toMatch(/falla/);
  });

  it("the config can point somewhere else: the contract is the script, not its path", async () => {
    write("scripts/smoke.sh", "#!/bin/sh\necho otro\n", 0o755);
    const r = await runStartScript({ projectDir: dir, config: { start_script: "scripts/smoke.sh" } });
    expect(r.status).toBe("ok");
    expect(r.output).toMatch(/otro/);
  });

  it("a script that hangs is not a verdict: it stops and says so", async () => {
    write(".karajan/start.sh", "#!/bin/sh\nsleep 30\n", 0o755);
    const r = await runStartScript({ projectDir: dir, timeoutMs: 300 });
    expect(r.status).toBe("timeout");
  });

  // Caught by codex too: a verbose script would eat the CLI's memory for the
  // whole timeout window.
  it("a torrent of output is capped, and says it was cut", async () => {
    write(".karajan/start.sh", "#!/bin/sh\ni=0\nwhile [ $i -lt 4000 ]; do echo ruidoruidoruidoruidoruidoruido; i=$((i+1)); done\n", 0o755);
    const r = await runStartScript({ projectDir: dir });
    expect(r.status).toBe("ok");
    expect(r.truncated).toBe(true);
    expect(r.output.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });

  // Caught by codex: this script's job is to START things, so killing only the
  // shell would leave the server it launched holding its port.
  it("on timeout the whole tree dies, not just the shell", async () => {
    const pidFile = path.join(dir, "child.pid");
    write(".karajan/start.sh", `#!/bin/sh\nsleep 30 &\necho $! > ${pidFile}\nwait\n`, 0o755);
    const r = await runStartScript({ projectDir: dir, timeoutMs: 400 });
    expect(r.status).toBe("timeout");
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    expect(Number.isFinite(pid)).toBe(true);
    await new Promise((done) => setTimeout(done, 100));
    expect(() => process.kill(pid, 0)).toThrow(); // gone
  });
});
