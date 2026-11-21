// KJC-TSK-0951: the layers of a human act (ADR 0009), on their own. The seal's
// tests (supervisor-commit.test.js) keep proving them through `harden --commit`;
// these prove the module any other human-only command builds on.
import { describe, it, expect } from "vitest";
import { HUMAN_ACTS, agentAncestry, confirmHuman, humanAct, humanActOf, readTty, refuseAgentSession, ttyDevice, winProcessTable } from "../../src/harden/human-act.js";

// KJC-TSK-0966 (HUM-C, ADR 0018): one closed catalog, one mechanism.
describe("the catalog of human acts", () => {
  const human = { env: {}, tty: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) } };

  it("an id outside the catalog is refused by name", () => {
    expect(() => humanActOf("delete-everything")).toThrow(/not in the catalog of human acts/);
  });

  it("humanAct runs the four layers for a catalog id, with the act's own label", () => {
    expect(() => humanAct("rules-approve", { ...human, confirm: (nonce) => nonce })).not.toThrow();
    expect(() => humanAct("rules-approve", { ...human, env: { CLAUDECODE: "1" }, confirm: (nonce) => nonce })).toThrow(/kj rules approve es un acto humano/);
    expect(() => humanAct("supervisor-seal", { ...human, confirm: () => "wrong" })).toThrow(/harden --commit: confirmación humana fallida/);
  });

  it("every act names a module or the card that will bring it", () => {
    for (const act of Object.values(HUMAN_ACTS)) expect(Boolean(act.module) || /^KJC-TSK-\d{4}$/.test(act.pending)).toBe(true);
  });
});

const chain = (cmds) => (pid) => cmds[pid] ?? { ppid: 1, cmd: "init" };
const HUMAN = { env: {}, tty: true, ancestry: { pid: 100, readProc: chain({ 100: { ppid: 50, cmd: "node kj" }, 50: { ppid: 1, cmd: "bash" } }) } };

describe("refuseAgentSession", () => {
  it("lets a human terminal through", () => {
    expect(() => refuseAgentSession("kj x", HUMAN)).not.toThrow();
  });

  it("names the act when the environment or the terminal says agent", () => {
    for (const over of [{ env: { CLAUDECODE: "1" } }, { env: { KJ_NON_INTERACTIVE: "1" } }, { tty: false }]) {
      expect(() => refuseAgentSession("kj x", { ...HUMAN, ...over })).toThrow(/^kj x es un acto humano/);
    }
  });

  it("a clean environment and a fake pty do not hide the ancestry", () => {
    const ancestry = { pid: 200, readProc: chain({ 200: { ppid: 150, cmd: "node kj" }, 150: { ppid: 1, cmd: "claude --session" } }) };
    expect(agentAncestry(ancestry)).toMatchObject({ agent: true });
    expect(() => refuseAgentSession("kj x", { ...HUMAN, ancestry })).toThrow(/desciende de un agente \(claude/);
  });

  // KJC-TSK-1084: the Sentinel no longer reads the text of a human act, so the
  // command's own check must fail closed: an ancestry it cannot read is refused.
  it("refuses when the ancestry cannot be read", () => {
    const ancestry = { pid: 300, readProc: () => { throw new Error("EACCES"); } };
    expect(agentAncestry(ancestry)).toMatchObject({ agent: false, unknown: true });
    expect(() => refuseAgentSession("kj x", { ...HUMAN, ancestry })).toThrow(/no se pudo comprobar la ascendencia/);
  });
});

describe("agentAncestry without /proc", () => {
  it("reads the parent chain with ps", () => {
    const outputs = { 400: "  350 node kj\n", 350: "    1 claude --session\n" };
    const ps = (pid) => outputs[pid];
    expect(agentAncestry({ pid: 400, hasProc: false, ps })).toMatchObject({ agent: true, match: "claude --session" });
  });
});

// KJC-BUG-0647 (#4637): Windows has neither /proc nor ps; the chain comes from the system
// PowerShell's process table, read once, and the nonce from the console, never from stdin.
describe("agentAncestry on Windows", () => {
  const table = (rows) => () => rows.map(([ProcessId, ParentProcessId, Name, CommandLine]) => ({ ProcessId, ParentProcessId, Name, CommandLine }));

  it("walks the chain of the process table and finds an agent ancestor", () => {
    const winTable = table([[400, 350, "node.exe", "node kj harden --commit"], [350, 300, "pwsh.exe", "pwsh"], [300, 4, "claude.exe", null]]);
    expect(agentAncestry({ pid: 400, platform: "win32", winTable })).toMatchObject({ agent: true, match: "claude.exe" });
  });

  it("a human chain is not unknown, so the act goes through", () => {
    const winTable = table([[400, 350, "node.exe", "node kj security normal"], [350, 300, "powershell.exe", "powershell"], [300, 4, "explorer.exe", "C:\\Windows\\explorer.exe"]]);
    expect(agentAncestry({ pid: 400, platform: "win32", winTable })).toEqual({ agent: false });
    expect(() => refuseAgentSession("kj x", { ...HUMAN, ancestry: { pid: 400, platform: "win32", winTable } })).not.toThrow();
  });

  it("a table that cannot be read, or that lacks the process itself, is unknown", () => {
    expect(agentAncestry({ pid: 400, platform: "win32", winTable: () => { throw new Error("no powershell"); } })).toMatchObject({ unknown: true });
    expect(agentAncestry({ pid: 400, platform: "win32", winTable: table([[1, 0, "System", null]]) })).toMatchObject({ unknown: true });
  });
});

describe("winProcessTable", () => {
  it.skipIf(process.platform === "win32")("throws without the system PowerShell, so the ancestry fails closed", () => {
    expect(() => winProcessTable()).toThrow(/no system PowerShell/);
    expect(agentAncestry({ pid: 400, platform: "win32" })).toMatchObject({ unknown: true });
  });

  // The review of HU-4697: Windows may live on another volume, so the root is the one the
  // kernel's \SystemRoot link resolves to, the same for the exe and for SystemRoot.
  it("runs the PowerShell under the directory \\SystemRoot resolves to, with it as SystemRoot", () => {
    const calls = [];
    const realpath = (p) => { if (p !== "\\\\?\\GLOBALROOT\\SystemRoot") throw new Error(`ENOENT ${p}`); return "D:\\Windows"; };
    const run = (exe, args, { env }) => { calls.push({ exe, env }); return '{"ProcessId":4,"ParentProcessId":0,"Name":"System","CommandLine":null}'; };
    expect(winProcessTable({ realpath, exists: () => true, run })).toEqual([{ ProcessId: 4, ParentProcessId: 0, Name: "System", CommandLine: null }]);
    expect(calls).toEqual([{ exe: "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", env: { SystemRoot: "D:\\Windows" } }]);
    calls.length = 0;
    winProcessTable({ realpath: () => "\\\\?\\D:\\Windows", exists: () => true, run });
    expect(calls[0].env).toEqual({ SystemRoot: "D:\\Windows" });
  });

  it("runs nothing when \\SystemRoot does not resolve or holds no PowerShell", () => {
    const run = () => { throw new Error("must not run"); };
    expect(() => winProcessTable({ realpath: () => { throw new Error("ENOENT"); }, exists: () => true, run })).toThrow(/no system PowerShell/);
    expect(() => winProcessTable({ realpath: () => "D:\\Windows", exists: () => false, run })).toThrow(/no system PowerShell \(D:\\Windows\\System32/);
  });
});

describe("the terminal a nonce is read from", () => {
  it("is the console input on Windows and /dev/tty elsewhere, never stdin", () => {
    expect(ttyDevice("win32")).toBe("CONIN$");
    expect(ttyDevice("linux")).toBe("/dev/tty");
    expect(ttyDevice("darwin")).toBe("/dev/tty");
  });
});

describe("readTty", () => {
  const fakeFs = (typed) => {
    const log = [];
    let next = 3;
    return {
      log,
      openSync: (path, flags) => { log.push(["open", path, flags]); return next++; },
      writeSync: (fd, text) => { log.push(["write", fd, text]); },
      readSync: (fd, buf) => { log.push(["read", fd]); return buf.write(typed); },
      closeSync: (fd) => { log.push(["close", fd]); },
    };
  };

  it("writes the code to the terminal itself before it waits, never to stdout", () => {
    const fs = fakeFs("abc123\n");
    expect(readTty("kj x", "abc123", { platform: "linux", fs })).toBe("abc123");
    const write = fs.log.findIndex(([op]) => op === "write");
    const read = fs.log.findIndex(([op]) => op === "read");
    expect(fs.log[0]).toEqual(["open", "/dev/tty", "w"]);
    expect(fs.log[write][2]).toContain('teclea "abc123"');
    expect(write).toBeLessThan(read);
    expect(fs.log.filter(([op]) => op === "close")).toHaveLength(2);
  });

  it("on Windows writes to the console output and reads the console input", () => {
    const fs = fakeFs("abc123");
    readTty("kj x", "abc123", { platform: "win32", fs });
    const opened = fs.log.filter(([op]) => op === "open").map(([, path]) => path);
    expect(opened).toEqual(["CONOUT$", "CONIN$"]);
  });

  it("answers null when the terminal cannot be opened", () => {
    const fs = { ...fakeFs(""), openSync: () => { throw new Error("ENXIO"); } };
    expect(readTty("kj x", "abc123", { platform: "linux", fs })).toBeNull();
  });
});

describe("confirmHuman", () => {
  it("passes only when the nonce comes back as shown, a fresh one each time", () => {
    const seen = [];
    confirmHuman("kj x", (nonce) => { seen.push(nonce); return nonce; });
    confirmHuman("kj x", (nonce) => { seen.push(nonce); return nonce; });
    expect(seen[0]).toMatch(/^[0-9a-f]{6}$/);
    expect(seen[0]).not.toBe(seen[1]);
    for (const answer of ["yes", "", null]) {
      expect(() => confirmHuman("kj x", () => answer)).toThrow(/^kj x: confirmación humana fallida/);
    }
  });
});
