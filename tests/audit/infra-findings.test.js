// INF-C (KJC-TSK-0760, épica KJC-PCS-0078) — parser de checkov: los
// misconfigs de infra entrarán por el mismo canal best-effort que semgrep.
// Aquí la mitad PURA: parser tolerante a los dos shapes de checkov (objeto
// single-framework / array multi-framework) y el gate por markers.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCheckovOutput } from "../../src/audit/infra-findings.js";
import { detectInfraMarkers } from "../../src/utils/project-detect.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-infra-audit-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const CHECKOV_SINGLE = {
  check_type: "terraform",
  results: {
    failed_checks: [
      { check_id: "CKV_AWS_20", check_name: "S3 bucket has public READ", file_path: "/main.tf", file_line_range: [1, 8], severity: null, guideline: "https://docs.example/ckv-aws-20" },
    ],
  },
  summary: { failed: 1, passed: 4 },
};

const CHECKOV_MULTI = [
  CHECKOV_SINGLE,
  { check_type: "kubernetes", results: { failed_checks: [
    { check_id: "CKV_K8S_21", check_name: "default namespace used", file_path: "/k8s/deploy.yaml", file_line_range: [3, 3], severity: "HIGH" },
  ] }, summary: { failed: 1, passed: 0 } },
];

describe("parseCheckovOutput", () => {
  it("shape objeto single-framework (sin severity → WARNING honesto)", () => {
    const out = parseCheckovOutput(CHECKOV_SINGLE);
    expect(out.total).toBe(1);
    expect(out.findings[0]).toMatchObject({ rule: "CKV_AWS_20", file: "main.tf", line: 1, severity: "WARNING", framework: "terraform" });
    expect(out.findings[0].guideline).toContain("ckv-aws-20");
  });

  it("shape array multi-framework, con severidad propia cuando existe", () => {
    const out = parseCheckovOutput(CHECKOV_MULTI);
    expect(out.total).toBe(2);
    expect(out.findings[1]).toMatchObject({ rule: "CKV_K8S_21", severity: "HIGH", framework: "kubernetes" });
  });

  it("shape malformado no revienta: cero findings", () => {
    expect(parseCheckovOutput({}).total).toBe(0);
    expect(parseCheckovOutput([{ results: "garbage" }]).total).toBe(0);
  });
});

describe("detectInfraMarkers (gate del scanner)", () => {
  it("true con markers inequívocos, false sin ellos (un yaml suelto no cuenta)", async () => {
    expect(await detectInfraMarkers(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "config.yaml"), "a: 1\n");
    expect(await detectInfraMarkers(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    expect(await detectInfraMarkers(dir)).toBe(true);
  });

  it("detecta infra AUNQUE el repo tenga framework de aplicación (a diferencia de detectTestFramework)", async () => {
    fs.writeFileSync(path.join(dir, "go.mod"), "module x\n");
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    expect(await detectInfraMarkers(dir)).toBe(true);
  });
});
