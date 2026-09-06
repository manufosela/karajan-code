// KJC-TSK-0713 SEN-A — the Sentinel: per-session method state (PostToolUse)
// plus a Stop hook that BLOCKS ending the turn while violations are open.
// Tests run the REAL scripts through the hooks protocol (JSON on stdin,
// exit 2 = block), inside a throwaway git repo.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, postScript, stopScript, statePath;
const run = (script, payload, env = {}) =>
  spawnSync("node", [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    // IDN-B: these suites exercise the OTHER gates; the identity lock has its
    // own suite (sentinel-identity.test.js), so it is escaped here (env route).
    env: { ...process.env, KJ_ALLOW_IDENTITY: "1", ...env },
  });
const editTool = (file, session = "s1") => ({ session_id: session, tool_name: "Edit", tool_input: { file_path: file } });
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-"));
  execSync(
    "git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo",
    { cwd: dir },
  );
  installSentinelHooks({ projectDir: dir });
  postScript = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  stopScript = path.join(dir, ".karajan", "harness", "stop.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("posttooluse script (state writer)", () => {
  it("records source edits and test edits separately, per session", () => {
    expect(run(postScript, editTool(path.join(dir, "src", "a.js"))).status).toBe(0);
    expect(run(postScript, editTool(path.join(dir, "tests", "a.test.js"))).status).toBe(0);
    expect(run(postScript, editTool(path.join(dir, "README.md"))).status).toBe(0);
    const s = state().sessions.s1;
    expect(s.edited_sources).toEqual(["src/a.js"]);
    expect(s.edited_tests).toEqual(["tests/a.test.js"]);
  });

  it("INF-A (KJC-TSK-0758): la infra ES fuente — .tf/.yaml/.sh/Dockerfile van al bucket de sources y *_test.* al de tests", () => {
    run(postScript, editTool(path.join(dir, "main.tf")));
    run(postScript, editTool(path.join(dir, "k8s", "deploy.yaml")));
    run(postScript, editTool(path.join(dir, "up.sh")));
    run(postScript, editTool(path.join(dir, "Dockerfile")));
    run(postScript, editTool(path.join(dir, "modules", "vpc_test.go")));
    const s = state().sessions.s1;
    expect(s.edited_sources).toEqual(["main.tf", "k8s/deploy.yaml", "up.sh", "Dockerfile"]);
    expect(s.edited_tests).toEqual(["modules/vpc_test.go"]);
  });

  it("records used KJ_ALLOW_* escapes and never crashes on garbage input", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")), { KJ_ALLOW_NO_CARD: "1" });
    expect(state().sessions.s1.escapes).toContain("KJ_ALLOW_NO_CARD");
    expect(run(postScript, "not-json").status).toBe(0);
  });
});

describe("stop script (turn cannot end red)", () => {
  it("blocks when sources were edited without touching a single test, then passes once a test is touched", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    const blocked = run(stopScript, { session_id: "s1" });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/test/i);
    run(postScript, editTool(path.join(dir, "tests", "a.test.js")));
    expect(run(stopScript, { session_id: "s1" }).status).toBe(0);
  });

  it("blocks on the base branch and on a branch without a card ref, with remediation in the message", () => {
    execSync("git checkout -q main", { cwd: dir });
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    run(postScript, editTool(path.join(dir, "tests", "a.test.js")));
    const onMain = run(stopScript, { session_id: "s1" });
    expect(onMain.status).toBe(2);
    expect(onMain.stderr).toMatch(/rama base|base branch/i);
    execSync("git checkout -q -b sin-card", { cwd: dir });
    const noCard = run(stopScript, { session_id: "s1" });
    expect(noCard.status).toBe(2);
    expect(noCard.stderr).toMatch(/card/i);
  });

  it("ends the turn normally when nothing was edited, on escape, and on garbage input", () => {
    expect(run(stopScript, { session_id: "empty" }).status).toBe(0);
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    expect(run(stopScript, { session_id: "s1" }, { KJ_SENTINEL_OFF: "1" }).status).toBe(0);
    expect(run(stopScript, "not-json").status).toBe(0);
  });

  it("fails OPEN after 3 consecutive blocks (a sentinel bug never bricks the session) and records it", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    for (let i = 0; i < 3; i++) expect(run(stopScript, { session_id: "s1" }).status).toBe(2);
    const open = run(stopScript, { session_id: "s1" });
    expect(open.status).toBe(0);
    expect(state().sessions.s1.errors.join(" ")).toMatch(/fail-open/);
  });

  it("--status prints the state without blocking", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    const res = spawnSync("node", [stopScript, "--status"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/src\/a\.js/);
  });
});

describe("pretooluse-sentinel script (stateful gate — the rule fires BEFORE the damage)", () => {
  let gate;
  beforeEach(() => {
    gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });

  // (sha refrescado el 6-sep: Actions no entregó el evento del push original)
  it("KJC-TSK-0822 v1.1: enrolar la clave del movil es acto humano — comando y fichero denegados", () => {
    const bash = (command) => ({ session_id: "s1", tool_name: "Bash", tool_input: { command } });
    expect(run(gate, bash("kj identity enroll-phone QUJDRA==")).status).toBe(2);
    expect(run(gate, bash("cat /home/x/.karajan/supervisor-phone.json")).status).toBe(2);
    const w = run(gate, { session_id: "s1", tool_name: "Write", tool_input: { file_path: "/home/x/.karajan/supervisor-phone.json", content: "{}" } });
    expect(w.status).toBe(2);
    expect(w.stderr).toMatch(/acto humano/);
    // kj identity show sigue permitido
    expect(run(gate, bash("kj identity show")).status).toBe(0);
  });

  it("ADR 0009: kj harden --commit es acto humano — la sesion lo tiene denegado SIN escape", () => {
    for (const command of ["kj harden --commit", "KJ_ALLOW_CROSS_LANE=1 kj harden --profile strict --commit"]) {
      const blocked = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command } });
      expect(blocked.status).toBe(2);
      expect(blocked.stderr).toMatch(/acto humano/);
    }
    // harden a secas sigue permitido (la regeneracion local es legitima).
    expect(run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: "kj harden --report" } }).status).toBe(0);
  });

  it("INF-A: editar un .tf en rama sin card se deniega igual que un .js", () => {
    execSync("git checkout -q -b sin-card", { cwd: dir });
    const blocked = run(gate, editTool(path.join(dir, "main.tf")));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/card/i);
  });

  it("blocks editing a source on a branch without card ref, with remediation and named escape recorded", () => {
    execSync("git checkout -q -b sin-card", { cwd: dir });
    const blocked = run(gate, editTool(path.join(dir, "src", "a.js")));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/kj hu add|card/i);
    const escaped = run(gate, editTool(path.join(dir, "src", "a.js")), { KJ_ALLOW_NO_CARD: "1" });
    expect(escaped.status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_NO_CARD")).toBe(true);
  });

  it("allows source edits on a card branch, test edits anywhere, and blocks on the base branch", () => {
    expect(run(gate, editTool(path.join(dir, "src", "a.js"))).status).toBe(0);
    execSync("git checkout -q main", { cwd: dir });
    expect(run(gate, editTool(path.join(dir, "tests", "a.test.js"))).status).toBe(0);
    expect(run(gate, editTool(path.join(dir, "src", "a.js"))).status).toBe(2);
  });

  it("blocks git push while method violations are open, allows once green", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    const push = { session_id: "s1", tool_name: "Bash", tool_input: { command: "git push origin HEAD" } };
    expect(run(gate, push).status).toBe(2);
    run(postScript, editTool(path.join(dir, "tests", "a.test.js")));
    expect(run(gate, push).status).toBe(0);
  });

  it("blocks npm publish when the release check is red, honors the escape, and fails open without kj", () => {
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "kj"),
      `#!/bin/sh\necho '{"ok":false,"checks":[{"ok":false,"name":"changelog","detail":"missing section"}]}'\nexit 1\n`,
      { mode: 0o755 },
    );
    const publish = { session_id: "s1", tool_name: "Bash", tool_input: { command: "npm publish --otp=123456" } };
    const blocked = run(gate, publish, { PATH: `${bin}:${process.env.PATH}` });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/changelog/);
    expect(run(gate, publish, { PATH: `${bin}:${process.env.PATH}`, KJ_ALLOW_RELEASE: "1" }).status).toBe(0);
    // KJC-BUG-0155: dirname(process.execPath) is node's OWN bin — the same dir
    // where `npm link` installs the real kj on a dev machine, so the fail-open
    // leg found kj and blocked. A lonely bin holding ONLY node proves it.
    const lonely = path.join(dir, "lonelybin");
    fs.mkdirSync(lonely);
    fs.symlinkSync(process.execPath, path.join(lonely, "node"));
    expect(run(gate, publish, { PATH: lonely }).status).toBe(0);
    expect(run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: "ls -la" } }).status).toBe(0);
  });

  it("KJC-BUG-0142: el escape como PREFIJO del comando funciona — el hook corre con el env del host y el prefijo jamas llegaba a process.env (deadlock real: landing solo verde tras deploy, deploy bloqueado)", () => {
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "kj"),
      `#!/bin/sh\necho '{"ok":false,"checks":[{"ok":false,"name":"landing","detail":"not current"}]}'\nexit 1\n`,
      { mode: 0o755 },
    );
    const env = { PATH: `${bin}:${process.env.PATH}` };
    const pub = (command) => run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command } }, env);
    // El prefijo de asignacion literal al INICIO escapa y queda registrado.
    expect(pub("KJ_ALLOW_RELEASE=1 npm publish --ignore-scripts --otp=123456").status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_RELEASE")).toBe(true);
    // Varias asignaciones encadenadas al inicio tambien cuentan.
    expect(pub("FOO=bar KJ_ALLOW_RELEASE=1 firebase deploy --only hosting").status).toBe(0);
    // Una MENCION a mitad de comando o tras el verbo NO escapa.
    expect(pub("echo KJ_ALLOW_RELEASE=1 && npm publish").status).toBe(2);
    expect(pub("npm publish # KJ_ALLOW_RELEASE=1").status).toBe(2);
    // El valor tiene que ser exactamente 1.
    expect(pub("KJ_ALLOW_RELEASE=0 npm publish").status).toBe(2);
    // Catch de codex: en una CADENA el prefijo shell no alcanza a los
    // comandos posteriores — el escape por texto solo vale para un comando
    // SIMPLE (sin ; | & $ backtick ni salto de linea, tampoco escondidos
    // en el valor de una asignacion).
    expect(pub("KJ_ALLOW_RELEASE=1 true && npm publish").status).toBe(2);
    expect(pub("KJ_ALLOW_RELEASE=1 true; npm publish").status).toBe(2);
    expect(pub("KJ_ALLOW_RELEASE=1 npm publish | tee log.txt").status).toBe(2);
    expect(pub("KJ_ALLOW_RELEASE=1 X=$(id) npm publish").status).toBe(2);
    // Catch de codex (2a ronda): subshells y process substitution.
    expect(pub("KJ_ALLOW_RELEASE=1 npm publish <(id)").status).toBe(2);
    expect(pub("KJ_ALLOW_RELEASE=1 (npm publish)").status).toBe(2);
    // La via env de siempre sigue valiendo para cadenas.
    expect(run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: "npm publish && echo ok" } }, { ...env, KJ_ALLOW_RELEASE: "1" }).status).toBe(0);
  });

  it("KJC-BUG-0147: lo entrecomillado no encadena — parentesis y pipes dentro de comillas son un comando simple; y un escape ignorado SE DICE", () => {
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\necho '{"ok":false,"checks":[{"ok":false,"name":"landing","detail":"x"}]}'\nexit 1\n`, { mode: 0o755 });
    const env = { PATH: `${bin}:${process.env.PATH}` };
    const pub = (command) => run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command } }, env);
    // Hallado en vivo: todo mensaje Conventional Commit lleva parentesis — el escape se ignoraba en silencio.
    const quoted = pub('KJ_ALLOW_RELEASE=1 npm publish --tag "fix(x): y (KJC-TSK-1) | z"');
    expect(quoted.stderr).not.toMatch(/IGNORADO/);
    expect(quoted.status).toBe(0);
    expect(pub("KJ_ALLOW_RELEASE=1 npm publish --tag 'a; b (c) | d'").status).toBe(0);
    // Dentro de comillas DOBLES $ y backtick siguen expandiendo: no es simple.
    const dq = pub('KJ_ALLOW_RELEASE=1 npm publish --tag "v$HOME"');
    expect(dq.status).toBe(2);
    expect(dq.stderr).toMatch(/KJ_ALLOW_RELEASE=1 presente pero IGNORADO/);
    // Fuera de comillas, un pipe sigue sin ser simple — y ahora se dice por que.
    const piped = pub("KJ_ALLOW_RELEASE=1 npm publish | tail -1");
    expect(piped.status).toBe(2);
    expect(piped.stderr).toMatch(/IGNORADO[^\n]*"\|"/);
    // Separadores escapados con barra son literales (la plantilla genera UNA barra: catch de codex, probado aqui).
    expect(pub("KJ_ALLOW_RELEASE=1 npm publish --tag a\\;b").status).toBe(0);
    expect(pub('KJ_ALLOW_RELEASE=1 npm publish --tag "a\\$b"').status).toBe(0);
    // Comilla sin cerrar = no verificable.
    expect(pub('KJ_ALLOW_RELEASE=1 npm publish --tag "abc').status).toBe(2);
  });
});

describe("self-protection + audited escapes (SEN-C)", () => {
  let gate;
  beforeEach(() => {
    gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });

  it("blocks the agent editing settings.json or the harness/hooks, with NO agent escape honored", () => {
    for (const target of [
      path.join(dir, ".claude", "settings.json"),
      path.join(dir, ".karajan", "hooks", "pre-commit"),
      path.join(dir, ".karajan", "harness", "stop.mjs"),
    ]) {
      const blocked = run(gate, editTool(target), { KJ_ALLOW_WRITE: "1", KJ_ALLOW_NO_CARD: "1", KJ_SENTINEL_OFF: "1" });
      expect(blocked.status).toBe(2);
      expect(blocked.stderr).toMatch(/humano|sentinel/i);
    }
  });

  it("denies ANY Bash mentioning protected paths (write blocklists are bypassable), leaves other Bash alone", () => {
    const bash = (command) => run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command } });
    expect(bash("sed -i 's/x/y/' .karajan/harness/stop.mjs").status).toBe(2);
    expect(bash("echo '{}' > .claude/settings.json").status).toBe(2);
    expect(bash("cp evil.mjs .karajan/harness/stop.mjs").status).toBe(2);
    expect(bash("cat .claude/settings.json").status).toBe(2);
    expect(bash("ls -la src/").status).toBe(0);
  });

  it("kj report formats the audited escape events (timestamp + escape + tool)", async () => {
    const { formatSentinelEscapes } = await import("../../src/commands/report.js");
    expect(formatSentinelEscapes({})).toBeNull();
    const text = formatSentinelEscapes({ escape_events: [{ escape: "KJ_ALLOW_PII", tool: "Bash", sid: "s1", ts: Date.UTC(2026, 7, 4, 12) }] });
    expect(text).toMatch(/Sentinel escapes used \(1\)/);
    expect(text).toMatch(/KJ_ALLOW_PII/);
    expect(text).toMatch(/2026-08-04T12/);
  });

  it("stop BLOCKS the turn on tampered scripts (root of trust: the installed kj, never the project tree)", async () => {
    const { verifySentinelScripts } = await import("../../src/harden/sentinel-hooks.js");
    fs.appendFileSync(postScript, "// tampered via indirection\n");
    expect(verifySentinelScripts({ projectDir: dir }).mismatched).toEqual(["posttooluse.mjs"]);
    const bin = path.join(dir, "verifybin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "kj"),
      `#!/bin/sh\necho '{"ok":false,"mismatched":["posttooluse.mjs"]}'\nexit 1\n`,
      { mode: 0o755 },
    );
    const blocked = run(stopScript, { session_id: "empty" }, { PATH: `${bin}:${process.env.PATH}` });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/kj harden/);
    installSentinelHooks({ projectDir: dir });
    expect(verifySentinelScripts({ projectDir: dir }).ok).toBe(true);
    expect(run(stopScript, { session_id: "empty" }, { PATH: path.dirname(process.execPath) }).status).toBe(0);
  });

  it("stop emits a user-visible summary of used escapes when the turn ends green", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")), { KJ_ALLOW_NO_CARD: "1" });
    run(postScript, editTool(path.join(dir, "tests", "a.test.js")));
    const res = run(stopScript, { session_id: "s1" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/systemMessage/);
    expect(res.stdout).toMatch(/KJ_ALLOW_NO_CARD/);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_NO_CARD")).toBe(true);
  });
});

describe("sentinel-lib (shared single source)", () => {
  it("is written by install, and both scripts import it instead of duplicating logic", async () => {
    const lib = path.join(dir, ".karajan", "harness", "sentinel-lib.mjs");
    expect(fs.existsSync(lib)).toBe(true);
    for (const script of [postScript, stopScript]) {
      expect(fs.readFileSync(script, "utf8")).toContain('from "./sentinel-lib.mjs"');
    }
    const mod = await import(`file://${lib}`);
    expect(mod.violations({ edited_sources: ["src/a.js"], edited_tests: [] }, "main").length).toBe(2);
    expect(mod.violations({ edited_sources: ["src/a.js"], edited_tests: ["tests/a.test.js"] }, "feat/KJC-TSK-0001-x")).toEqual([]);
  });

  it("recordEscape appends an auditable escape event to the state", async () => {
    const mod = await import(`file://${path.join(dir, ".karajan", "harness", "sentinel-lib.mjs")}`);
    mod.recordEscape("s1", "KJ_ALLOW_NO_CARD", "Edit");
    expect(state().escape_events).toHaveLength(1);
    expect(state().escape_events[0]).toMatchObject({ escape: "KJ_ALLOW_NO_CARD", tool: "Edit", sid: "s1" });
    expect(state().sessions.s1.escapes).toContain("KJ_ALLOW_NO_CARD");
  });
});

// MONO-0 (KJC-TSK-0737, ADR 0002) — lane boundary: a session mutates only
// ITS worktree. Same repo (git-common-dir) + another toplevel ⇒ deny BEFORE
// the damage; reads and non-repo paths untouched; the escape is audited.
describe("pretooluse-sentinel lane boundary (MONO-0)", () => {
  let gate, lane;
  beforeEach(() => {
    gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
    lane = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-")), "wt");
    execSync(`git worktree add --detach ${lane}`, { cwd: dir });
    fs.mkdirSync(path.join(lane, "src"), { recursive: true });
    fs.writeFileSync(path.join(lane, "src", "x.js"), "x");
  });
  afterEach(() => {
    execSync(`git worktree remove --force ${lane}`, { cwd: dir });
  });
  const laneEdit = () => ({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(lane, "src", "x.js") } });

  it("denies an Edit into a sibling worktree of the same repo, naming the lane", () => {
    const res = run(gate, laneEdit());
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("carril");
    expect(res.stderr).toContain(lane);
  });

  it("KJC-BUG-0142: el prefijo KJ_ALLOW_CROSS_LANE=1 en el TEXTO del comando Bash escapa el guard de carriles", () => {
    const target = path.join(lane, "src", "x.js");
    const denied = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `sed -i s/a/b/ ${target}` } });
    expect(denied.status).toBe(2);
    const escaped = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `KJ_ALLOW_CROSS_LANE=1 sed -i s/a/b/ ${target}` } });
    expect(escaped.status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_CROSS_LANE")).toBe(true);
  });

  it("KJ_ALLOW_CROSS_LANE=1 passes AND records the auditable escape", () => {
    const res = run(gate, laneEdit(), { KJ_ALLOW_CROSS_LANE: "1" });
    expect(res.status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_CROSS_LANE")).toBe(true);
  });

  it("denies Bash that mutates a sibling-lane path; read-only Bash passes", () => {
    const mut = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `sed -i s/a/b/ ${path.join(lane, "src", "x.js")}` } });
    expect(mut.status).toBe(2);
    expect(mut.stderr).toContain("carril");
    const wipe = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `rm -rf ${lane}` } });
    expect(wipe.status).toBe(2);
    const ro = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `grep -rn foo ${path.join(lane, "src")}` } });
    expect(ro.status).toBe(0);
  });

  it("expansion hiding a destructive target is denied; benign $ usage passes (solomon ruling)", () => {
    const bash = (command, env = {}) => run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command } }, env);
    expect(bash("rm -rf $LANE").status).toBe(2);
    expect(bash("echo hi > $OUT").status).toBe(2);
    expect(bash("tee `cat target`").status).toBe(2);
    expect(bash("rm -rf $LANE", { KJ_ALLOW_CROSS_LANE: "1" }).status).toBe(0);
    // Multilinea nunca es "lectura simple" (reviewer catch): la 2a linea muta.
    expect(bash(`git status\nsed -i s/a/b/ ${path.join(lane, "src", "x.js")}`).status).toBe(2);
    // Expansion en herramienta generica (chmod/touch/interprete): deny.
    expect(bash("chmod 755 $F").status).toBe(2);
    expect(bash('python -c "open(\'$F\')"').status).toBe(2);
    // find muta con -delete/-exec: no es read-only y sus paths se escanean.
    expect(bash(`find ${path.join(lane, "src")} -delete`).status).toBe(2);
    // A "read-only" verb with substitution is NOT read-only (reviewer catch).
    expect(bash(`grep foo $(true) ${path.join(lane, "src")}`.replace("$(true)", "$(rm -rf $L)")).status).toBe(2);
    // Command substitution EXECUTES anywhere — denied even in runner args;
    // plain $VARs in toolchain-runner segments stay allowed.
    expect(bash('git commit -m "release $(date +%F)"').status).toBe(2);
    expect(bash("FOO=$BAR npm test").status).toBe(0);
    expect(bash("git commit -m $MSG").status).toBe(0);
  });

  it("bare relative paths into an in-tree lane (.kj/worktrees/…) are denied; sed patterns never false-positive (reviewer catch)", () => {
    const inTree = path.join(dir, ".kj", "worktrees", "wt2");
    execSync(`git worktree add --detach ${inTree}`, { cwd: dir });
    fs.mkdirSync(path.join(inTree, "src"), { recursive: true });
    fs.writeFileSync(path.join(inTree, "src", "x.js"), "x");
    const spawn = (command) => spawnSync("node", [gate], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8", cwd: dir, env: { ...process.env, KJ_ALLOW_IDENTITY: "1" },
    });
    const bare = spawn("sed -i s/a/b/ .kj/worktrees/wt2/src/x.js");
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain("carril");
    const sedOnly = spawn("sed -i s/a/b/ notas.txt");
    expect(sedOnly.status).toBe(0);
    // cd/pushd en comando mutador: deny conservador SIEMPRE — bare, con $,
    // o relativas post-cd, todas las variantes de la carrera de bypasses.
    for (const evil of ["cd .kj/worktrees/wt2 && rm x.js", "cd $L && rm x.js", "cd .kj/worktrees && rm -rf wt2"]) {
      const res = spawn(evil);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("cd");
    }
    execSync(`git worktree remove --force ${inTree}`, { cwd: dir });
  });

  it("a local symlink into a foreign lane is canonicalized and denied (reviewer catch)", () => {
    fs.symlinkSync(path.join(lane, "src"), path.join(dir, "sneaky"));
    const res = run(gate, { session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, "sneaky", "x.js") } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("carril");
  });

  it("KJC-BUG-0140: un redirect literal ENTRE dos strings entrecomillados no es una ruta con espacios — el flujo estándar commit+log pasa; la ruta REAL entrecomillada con espacios sigue denegando", () => {
    const standard = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: {
      command: 'git commit -m "feat(x): mensaje con espacios" > /tmp/kj-log.txt 2>&1 && echo "ok" && git push -u origin rama',
    } });
    expect(standard.status).toBe(0);
    const realQuoted = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: {
      command: 'cp "/otro carril/con espacios/x.js" destino.js',
    } });
    expect(realQuoted.status).toBe(2);
    const afterEq = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: {
      command: 'rsync --exclude="/un dir/con espacios" a b',
    } });
    expect(afterEq.status).toBe(2);
    // Pares reales, no contexto (catch de codex): la comilla a mitad de
    // token (scp host:"...") o pegada a un redirect sigue siendo ruta real.
    for (const evil of ['tee >"/un dir/con espacios/x.log" archivo', 'scp host:"/path with spaces/file" .', 'touch foo"/path with spaces"', 'touch "dir with"" spaces/file"']) {
      const res = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: evil } });
      expect(res.status).toBe(2);
    }
    // Escapes que tocan comilla o blanco son opacos (catch de codex): la
    // comilla escapada moveria el cierre y esconderia el espacio.
    const escaped = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: 'cp "dir\\" with spaces/file" dest' } });
    expect(escaped.status).toBe(2);
    const sedFree = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: "sed -i s/a\\.b/c/ notas.txt" } });
    expect(sedFree.status).toBe(0);
    // Comilla sin cerrar en mutador = no verificable.
    const unclosed = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: 'git commit -m "a medias' } });
    expect(unclosed.status).toBe(2);
  });

  it("cd/pushd in any mutating command is denied conservatively; mutating without cd in own tree passes", () => {
    const res = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: "cd /tmp && rm -rf ../whatever" } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("cd");
    const own = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `rm -f ${path.join(dir, "notas.txt")}` } });
    expect(own.status).toBe(0);
  });

  it("a write under a NOT-yet-existing lane subdir is denied — walks up to an existing ancestor (reviewer catch)", () => {
    const res = run(gate, { session_id: "s1", tool_name: "Write", tool_input: { file_path: path.join(lane, "newdir", "deep", "file.js") } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("carril");
  });

  it("unlisted mutators and cd-chains into a lane are denied — deny-unless-read-only (reviewer catch)", () => {
    const dd = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `dd if=/dev/zero of=${path.join(lane, "src", "img")} count=1` } });
    expect(dd.status).toBe(2);
    const cdChain = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `cd ${lane} && make build` } });
    expect(cdChain.status).toBe(2);
  });

  it("a redirection glued to the path (>/lane/file) is denied too (reviewer catch)", () => {
    const res = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: `echo x >${path.join(lane, "src", "out.txt")}` } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("carril");
  });

  it("relative ../ paths into a sibling lane are resolved and denied too (reviewer catch)", () => {
    const rel = path.relative(dir, path.join(lane, "src", "x.js"));
    const res = spawnSync("node", [gate], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: `sed -i s/a/b/ ${rel}` } }),
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, KJ_ALLOW_IDENTITY: "1" },
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("carril");
  });

  it("same-tree edits and non-repo paths stay untouched", () => {
    expect(run(gate, editTool(path.join(dir, "src", "ok.js"))).status).toBe(0);
    const outside = path.join(os.tmpdir(), "kj-nolane-note.md");
    expect(run(gate, { session_id: "s1", tool_name: "Write", tool_input: { file_path: outside } }).status).toBe(0);
  });
});

describe("installSentinelHooks settings merge", () => {
  it("wires PostToolUse and Stop idempotently, preserving the user's entries", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    const mine = { matcher: "Grep", hooks: [{ type: "command", command: "echo mine" }] };
    fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { PostToolUse: [mine] } }));
    installSentinelHooks({ projectDir: dir });
    installSentinelHooks({ projectDir: dir });
    const cfg = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(cfg.model).toBe("opus");
    expect(JSON.stringify(cfg.hooks.PostToolUse)).toContain("echo mine");
    // KJC-TSK-0765: three PostToolUse matchers (edit tools, Bash, MCP update_card),
    // each wired exactly once across two installs.
    expect((JSON.stringify(cfg.hooks.PostToolUse).match(/posttooluse\.mjs/g) || []).length).toBe(3);
    const matchers = cfg.hooks.PostToolUse.map((e) => e.matcher);
    expect(matchers).toContain("Bash");
    expect(matchers.some((m) => /update_card/.test(m || ""))).toBe(true);
    expect((JSON.stringify(cfg.hooks.Stop).match(/stop\.mjs/g) || []).length).toBe(1);
  });

  it("leaves a non-array hook event untouched and reports script-only", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: { weird: true } } }));
    const res = installSentinelHooks({ projectDir: dir });
    expect(res.wired).toBe(false);
    expect(JSON.parse(fs.readFileSync(settings, "utf8")).hooks.Stop).toEqual({ weird: true });
  });
});
