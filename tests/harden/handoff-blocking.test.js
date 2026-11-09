// KJC-TSK-1474: a handoff says whether the agent can go on without it. A blocking one
// stops the agent; any other waits for the human while the work goes on.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handoffCommand } from "../../src/commands/handoff.js";
import { addHandoff, readHandoff } from "../../src/harden/handoff.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-handoff-blocking-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj handoff add --blocking", () => {
  it("a handoff is not blocking unless the agent says so", () => {
    const { id } = addHandoff({ projectDir: dir, command: "npm publish", why: "publicar la 5.10" });
    expect(readHandoff({ projectDir: dir, id }).blocking).toBe(false);
  });

  it("a blocking one says the agent stops, and the list marks it", async () => {
    const lines = [];
    const log = (l) => lines.push(l);
    const flags = { command: "kj harden --commit", why: "sellar los hooks nuevos", blocking: true };
    expect(await handoffCommand({ action: "add", config: { projectDir: dir }, flags, log })).toBe(0);
    const id = lines[0].match(/encargo ([0-9a-f]{8}) registrado/)[1];
    expect(readHandoff({ projectDir: dir, id }).blocking).toBe(true);
    expect(lines.join("\n")).toMatch(/bloqueante: para y pregunta a tu usuario/);
    await handoffCommand({ action: "list", config: { projectDir: dir }, flags: {}, log });
    expect(lines.at(-1)).toMatch(new RegExp(`^${id}  pending .*BLOQUEANTE`));
  });
});
