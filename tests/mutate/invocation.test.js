// KJC-BUG-0678 — `kj mutate` y el pre-gate comparten cómo se lanza cada herramienta.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mutationInvocation } from "../../src/mutate/invocation.js";

describe("mutationInvocation", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-invocation-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const writeReport = () => {
    const file = path.join(dir, "reports", "mutation", "mutation.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ files: {} }));
    return file;
  };

  it("stryker: `run` delante del scope y readReport lee su informe bajo projectDir", async () => {
    const { args, readReport } = mutationInvocation({ id: "stryker" }, dir, ["--mutate", "src/a.js"]);
    writeReport();
    expect(args).toEqual(["run", "--mutate", "src/a.js"]);
    await expect(readReport()).resolves.toEqual({ files: {} });
  });

  it("un informe de una ejecución anterior no se lee como el de esta", async () => {
    const file = writeReport();
    const before = new Date(Date.now() - 60_000);
    fs.utimesSync(file, before, before);
    const { readReport } = mutationInvocation({ id: "stryker" }, dir, []);
    await expect(readReport()).resolves.toBeNull();
  });

  it("go-mutesting: sin informe JSON no hay readReport", () => {
    const invocation = mutationInvocation({ id: "go-mutesting" }, dir, ["a.go"]);
    expect(invocation.args).toEqual(["a.go"]);
    expect(invocation.readReport).toBeUndefined();
  });

  it("herramienta sin entrada: solo el scope, sin readReport", () => {
    expect(mutationInvocation({ id: "otra" }, dir, ["x"])).toEqual({ args: ["x"], readReport: undefined });
  });
});
