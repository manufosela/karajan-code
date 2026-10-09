// KJC-TSK-0968 (HUM-E, ADR 0018): a deny leaves a record with the gate's words, and a
// handoff is registered only for a command that record knows: the agent never writes the why.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handoffCommand } from "../../src/commands/handoff.js";
import { addHandoff, DENIALS_FILE, HANDOFFS_DIR, listHandoffs, readDenials, readHandoff } from "../../src/harden/handoff.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-handoff-"));
  execSync("git init -q -b main && git checkout -q -b feat/KJC-TSK-0001-x", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const guard = (payload) => spawnSync("node", [path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs")], { input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env } });
const DENIED = "git add -A";
const deny = () => guard({ session_id: "s1", tool_name: "Bash", tool_input: { command: DENIED } });

describe("the Sentinel's record of denials", () => {
  it("a deny leaves a line with the tool, the input and the gate's own words; an allow leaves nothing", () => {
    const r = deny();
    expect(r.status).toBe(2);
    const [record] = readDenials({ projectDir: dir });
    expect(record).toMatchObject({ sid: "s1", tool: "Bash", input: { command: DENIED } });
    expect(record.why).toMatch(/karajan sentinel: /);
    expect(record.why).toBe(r.stderr.split("\n").filter((l) => l.startsWith("karajan sentinel:")).join("\n").trim().replace(/\n+$/, ""));
    expect(guard({ session_id: "s1", tool_name: "Bash", tool_input: { command: "git status" } }).status).toBe(0);
    expect(readDenials({ projectDir: dir })).toHaveLength(1);
  });
});

describe("kj handoff", () => {
  it("registers only a command the gate denied, with the gate's why, readable by id and listed", async () => {
    expect(() => addHandoff({ projectDir: dir, command: "rm -rf build" })).toThrow(/ningún deny para ese comando exacto.*no el agente/);
    deny();
    const lines = [];
    const log = (l) => lines.push(l);
    expect(await handoffCommand({ action: "add", config: { projectDir: dir }, flags: { command: "git add  -A" }, log })).toBe(1); // not the exact bytes
    expect(await handoffCommand({ action: "add", config: { projectDir: dir }, flags: { command: DENIED }, log })).toBe(0);
    const id = lines.at(-3).match(/encargo ([0-9a-f]{8}) registrado/)[1];
    expect(lines.join("\n")).toMatch(/por qué lo negó el gate .*:\nkarajan sentinel: /);
    const h = readHandoff({ projectDir: dir, id });
    expect(h).toMatchObject({ id, command: DENIED, status: "pending", cwd: dir, denial: { tool: "Bash" } });
    expect(listHandoffs({ projectDir: dir }).map((x) => x.id)).toEqual([id]);
    expect(await handoffCommand({ action: "show", config: { projectDir: dir }, flags: { id }, log })).toBe(0);
    expect(lines.join("\n")).toMatch(new RegExp(`comando   ${DENIED}\nsha256    ${h.sha256}`));
    expect(await handoffCommand({ action: "list", config: { projectDir: dir }, flags: {}, log })).toBe(0);
    expect(lines.at(-1)).toMatch(new RegExp(`^${id}  pending`));
  });

  it("a touched handoff is not read, and an id that does not exist is said", () => {
    deny();
    const { id } = addHandoff({ projectDir: dir, command: DENIED });
    const file = path.join(dir, HANDOFFS_DIR, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), command: "git add -A && git push" }));
    expect(() => readHandoff({ projectDir: dir, id })).toThrow(/no coincide con su sha256: alguien lo tocó/);
    expect(() => readHandoff({ projectDir: dir, id: "deadbeef" })).toThrow(/no hay ningún encargo deadbeef/);
    expect(() => readHandoff({ projectDir: dir, id: "x" })).toThrow(/no es un identificador/);
    fs.writeFileSync(path.join(dir, DENIALS_FILE), "{broken\n");
    expect(readDenials({ projectDir: dir })).toEqual([]);
  });
});
