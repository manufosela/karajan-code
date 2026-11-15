// KJC-BUG-0602 (HU-4387): rag-first asked for `kj rag index --file X` and blocked every edit,
// while the agent could not run it: its Bash lives in the host sandbox, where localhost is the
// sandbox's own and Ollama is out of reach (maxwell, 15-nov, three repos stopped). The hook runs
// OUTSIDE the sandbox, so it indexes the file itself; the query is still asked for (the gate
// does not relax), and when kj cannot index, the gate says why and what to run.
// The kj here is a double on the PATH: the suite cannot depend on the machine's kj.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

let dir, gate, bin, calls;
const edit = (rel) => spawnSync("node", [gate], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, rel) } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
});
/**
 * `rag covers` answers indexed once the marker file exists, absent before; `rag index` does what
 * `indexBody` says (`touch "$INDEXED"` is a real index). Every call is logged.
 */
const fakeKj = (indexBody) => {
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "kj");
  const marker = path.join(dir, "indexed.marker");
  fs.writeFileSync(file, `#!/bin/sh
INDEXED='${marker}'
echo "$*" >> '${calls}'
case "$*" in
  *covers*) if [ -f "$INDEXED" ]; then echo '{"state":"indexed","canAnswer":true}'; exit 0; fi
    echo '{"state":"stale","canAnswer":false,"reason":"app/Trip.php is indexable but absent from the index: kj rag index --file app/Trip.php"}'; exit 1 ;;
  "rag index"*) ${indexBody} ;;
  *) exit 0 ;;
esac
`);
  fs.chmodSync(file, 0o755);
};
const indexCalls = () => fs.readFileSync(calls, "utf8").split("\n").filter((l) => l.startsWith("rag index"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-on-demand-"));
  bin = path.join(dir, "fakebin");
  calls = path.join(dir, "kj-calls.log");
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "app", "Trip.php"), "<?php\n");
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git add -A && git commit -q -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rag-first × a file the index lacks (KJC-BUG-0602)", () => {
  it("the gate indexes that file itself, then still asks for the query", () => {
    fakeKj('touch "$INDEXED"; exit 0');
    const res = edit("app/Trip.php");
    expect(indexCalls()).toEqual(["rag index --file app/Trip.php"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/kj ha indexado app\/Trip\.php/);
    expect(res.stderr).toMatch(/kj_rag_query/);
  });

  it("when kj cannot index it, the gate blocks naming kj's own reason and the command to run outside the sandbox", () => {
    fakeKj("echo 'Ollama embed request failed (http://localhost:11434): fetch failed' >&2; exit 1");
    const res = edit("app/Trip.php");
    expect(indexCalls()).toEqual(["rag index --file app/Trip.php"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/Ollama embed request failed/);
    expect(res.stderr).toMatch(/fuera del sandbox: kj rag index --file app\/Trip\.php/);
  });

  // The index command can end 0 with every embedding failed: only the index itself says it holds the file.
  it("an index run that ends 0 but leaves the file absent is a failure, with what kj printed", () => {
    fakeKj("echo '[rag-indexer] app/Trip.php → 0 chunk(s) (1 failed)'; exit 0");
    const res = edit("app/Trip.php");
    expect(res.status).toBe(2);
    expect(res.stderr).not.toMatch(/kj ha indexado/);
    expect(res.stderr).toMatch(/kj no ha podido indexarlo \(\[rag-indexer\] app\/Trip\.php → 0 chunk\(s\) \(1 failed\)\)/);
  });
});
