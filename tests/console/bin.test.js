// C1 (KJC-TSK-0777) — the bin boots from a config file, serves /api/status and
// refuses an invalid config listing its problems (smoke test, dry-run adapters).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const BIN = path.resolve("packages/console/bin/karajan-console.js");
const config = { instance: { name: "smoke", allowedDomains: ["example.com"] }, auth: { provider: "google" }, roles: { admins: ["admin@example.com"] }, audit: { sink: "memory" } };

describe("karajan-console serve", () => {
  it("boots, prints its URL and answers /api/status; stops on SIGTERM", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-console-bin-"));
    const file = path.join(dir, "console.config.json");
    fs.writeFileSync(file, JSON.stringify(config));
    const child = spawn(process.execPath, [BIN, "serve", "--config", file, "--port", "0"], { env: { ...process.env, KARAJAN_CONSOLE_ADAPTERS: "memory" } });
    let out = "";
    const url = await new Promise((resolve, reject) => {
      child.stdout.on("data", (d) => { out += d; const m = /http:\/\/localhost:\d+/.exec(out); if (m) resolve(m[0]); });
      child.stderr.on("data", (d) => reject(new Error(String(d))));
      child.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    const status = await (await fetch(`${url}/api/status`)).json();
    expect(status).toMatchObject({ ok: true, instance: "smoke", adapters: { registered: ["memory"] } });
    expect((await fetch(`${url}/api/me`)).status).toBe(401);
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);

  it("an invalid config is a loud exit listing the problems; --help exits 0", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-console-bin-"));
    const file = path.join(dir, "console.config.json");
    fs.writeFileSync(file, JSON.stringify({ ...config, instance: { name: "x", allowedDomains: [] } }));
    const bad = spawnSync(process.execPath, [BIN, "serve", "--config", file], { encoding: "utf8", env: { ...process.env, KARAJAN_CONSOLE_ADAPTERS: "memory" } });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/allowedDomains/);
    expect(spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" }).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
