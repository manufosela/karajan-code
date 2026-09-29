// KJC-TSK-0910: el Sentinel dice el tamano de la rama mientras se edita, una
// vez por umbral, como contexto y nunca como bloqueo. El kj es un doble en el
// PATH: la suite no depende del kj instalado en la maquina.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, bin, post;
const fakeSize = (added) => {
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "kj");
  fs.writeFileSync(file, `#!/bin/sh\necho '{"added":${added},"exempt":0,"testAdded":10,"base":"main"}'\n`);
  fs.chmodSync(file, 0o755);
};
const edit = () => spawnSync("node", [post], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, "src", "a.js") } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
});
const note = (res) => (res.stdout ? JSON.parse(res.stdout).hookSpecificOutput.additionalContext : null);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sen-size-"));
  bin = path.join(dir, "fakebin");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "x\n");
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git add -A && git commit -q -m init", { cwd: dir });
  installSentinelHooks({ projectDir: dir, logger: { info() {} } });
  post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("sentinel × branch size", () => {
  it("under 150, nothing is said", () => {
    fakeSize(90);
    const res = edit();
    expect(res.status).toBe(0);
    expect(note(res)).toBeNull();
  });

  it("past 150 it says so once, as context, and exits 0", () => {
    fakeSize(160);
    const first = edit();
    expect(first.status).toBe(0);
    expect(note(first)).toMatch(/160 lineas.*150/);
    expect(note(edit())).toBeNull(); // once per threshold
  });

  it("past 200 it says so again, naming the CI limit", () => {
    fakeSize(160);
    edit();
    fakeSize(210);
    expect(note(edit())).toMatch(/210 lineas.*200 del CI/);
  });
});
