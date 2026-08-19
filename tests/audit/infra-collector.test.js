// INF-C parte 2 (KJC-TSK-0760) — el colector governed de checkov: gate por
// markers sin ejecutar nada, ENOENT declarado con comando de instalación,
// rescate del exit!=0 con JSON (checkov sale non-zero con failed checks),
// y degradación declarada en salida no parseable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/utils/tool-governor.js", () => ({
  runGoverned: vi.fn(),
  jobsCap: () => 2,
}));

const { runGoverned } = await import("../../src/utils/tool-governor.js");
const { collectInfraFindings } = await import("../../src/audit/infra-findings.js");

const CHECKOV_JSON = JSON.stringify({
  check_type: "terraform",
  results: { failed_checks: [{ check_id: "CKV_AWS_20", check_name: "S3 public READ", file_path: "/main.tf", file_line_range: [1, 8] }] },
});

let dir;
beforeEach(() => {
  vi.clearAllMocks();
  // runGoverned está mockeado — el kill-switch VITEST (KJC-BUG-0122) puede
  // abrirse sin riesgo de scan real.
  process.env.KJ_ALLOW_REAL_SCANS = "1";
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-infra-collect-"));
});
afterEach(() => {
  delete process.env.KJ_ALLOW_REAL_SCANS;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("collectInfraFindings", () => {
  it("sin markers de infra → not applicable, sin ejecutar checkov", async () => {
    const res = await collectInfraFindings(dir, null);
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/no infra/i);
    expect(runGoverned).not.toHaveBeenCalled();
  });

  it("con infra y checkov instalado → findings disponibles", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    runGoverned.mockResolvedValue({ stdout: CHECKOV_JSON });
    const res = await collectInfraFindings(dir, null);
    expect(res.available).toBe(true);
    expect(res.total).toBe(1);
  });

  it("checkov NO instalado → red caída DECLARADA con comando de instalación", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    runGoverned.mockRejectedValue(Object.assign(new Error("spawn checkov ENOENT"), { code: "ENOENT" }));
    const res = await collectInfraFindings(dir, null);
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/checkov not installed/);
    expect(res.reason).toMatch(/pipx install checkov/);
  });

  it("exit!=0 con JSON en stdout se rescata", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    runGoverned.mockRejectedValue(Object.assign(new Error("exit 1"), { stdout: CHECKOV_JSON }));
    const res = await collectInfraFindings(dir, null);
    expect(res.available).toBe(true);
    expect(res.total).toBe(1);
  });

  it("salida no parseable degrada declarándolo", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    runGoverned.mockResolvedValue({ stdout: "not json" });
    const res = await collectInfraFindings(dir, null);
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/parseable/);
  });
});
