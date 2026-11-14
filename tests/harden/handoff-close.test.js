// HU-4306: a human act that succeeds closes its handoff; `kj handoff wait` tells the agent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handoffCommand } from "../../src/commands/handoff.js";
import { addHandoff, closeHandoffsOfAct, readHandoff, waitHandoff } from "../../src/harden/handoff.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-handoff-close-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const add = (command) => addHandoff({ projectDir: dir, command, why: "only the human can" }).id;
const status = (id) => readHandoff({ projectDir: dir, id }).status;

describe("a human act closes its handoff", () => {
  it("closes the one with the same argument, not another", () => {
    const [a, b] = [add("kj release approve 4293"), add("kj release approve 4294")];
    closeHandoffsOfAct({ projectDir: dir, label: "kj release approve", args: ["release", "approve", "4293"], result: "tagged v1" });
    closeHandoffsOfAct({ projectDir: dir, label: "kj rules approve", args: ["release", "approve", "4294"] }); // another act
    expect([status(a), status(b)]).toEqual(["done", "pending"]);
    expect(readHandoff({ projectDir: dir, id: a }).result).toBe("tagged v1");
  });

  it("matches the seal behind a leading cd", () => {
    const id = add("cd /some/lane && kj harden --commit");
    closeHandoffsOfAct({ projectDir: dir, label: "harden --commit", args: ["harden", "--commit"] });
    expect(status(id)).toBe("done");
  });

  it("matches the alternatives of a label and ignores its parenthesis", () => {
    const [h, g, other] = [add("kj hooks unset pre-push"), add("kj gates set pr_size 300"), add("kj hooks list")];
    closeHandoffsOfAct({ projectDir: dir, label: "kj hooks set|unset", args: ["hooks", "unset", "pre-push"] });
    closeHandoffsOfAct({ projectDir: dir, label: "kj gates set (aflojar una regla)", args: ["gates", "set", "pr_size", "300"] });
    expect([status(h), status(g), status(other)]).toEqual(["done", "done", "pending"]);
  });

  it("closes only on the exact invocation: no extra, reordered or repeated token", () => {
    const [extra, reordered, repeated] = [add("kj release approve 4293"), add("kj gates set pr_size 300"), add("kj hooks unset pre-push pre-push")];
    closeHandoffsOfAct({ projectDir: dir, label: "kj release approve", args: ["release", "approve", "4293", "--force"] });
    closeHandoffsOfAct({ projectDir: dir, label: "kj gates set (aflojar una regla)", args: ["gates", "set", "300", "pr_size"] });
    closeHandoffsOfAct({ projectDir: dir, label: "kj hooks set|unset", args: ["hooks", "unset", "pre-push"] });
    expect([status(extra), status(reordered), status(repeated)]).toEqual(["pending", "pending", "pending"]);
  });
});

describe("kj handoff wait", () => {
  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

  it("returns the record as soon as it is done", async () => {
    const id = add("kj harden --commit");
    const c = clock();
    const sleep = async (ms) => { await c.sleep(ms); closeHandoffsOfAct({ projectDir: dir, label: "harden --commit", args: ["harden", "--commit"] }); };
    const h = await waitHandoff({ projectDir: dir, id, timeoutMs: 60000, intervalMs: 3000, now: c.now, sleep });
    expect(h.status).toBe("done");
    expect(c.now()).toBe(3000);
  });

  it("returns null on timeout, and the command exits 2", async () => {
    const id = add("kj harden --commit");
    const c = clock();
    expect(await waitHandoff({ projectDir: dir, id, timeoutMs: 9000, intervalMs: 3000, ...c })).toBeNull();
    const lines = [];
    const flags = { id, timeout: "0.0001", intervalMs: 10 };
    expect(await handoffCommand({ action: "wait", config: { projectDir: dir }, flags, log: (l) => lines.push(l) })).toBe(2);
    expect(lines.at(-1)).toMatch(/sigue abierto/);
  });

  it("add tells the agent how to wait", async () => {
    const lines = [];
    await handoffCommand({ action: "add", config: { projectDir: dir }, flags: { command: "kj harden --commit", why: "seal" }, log: (l) => lines.push(l) });
    expect(lines.at(-1)).toMatch(/the agent can wait for it: kj handoff wait [0-9a-f]{8}$/);
  });
});
