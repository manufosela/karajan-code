// C0 (KJC-TSK-0776, ADR 0007) — console.config.json v1 is the instance's
// contract: validated fail-loud, roles in git, every principal inside an
// allowed domain. The fixture mirrors the first real instance (tribbu-atlas).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConsoleConfig, loadConsoleConfig, resolveRole, ConsoleConfigError } from "@karajan-family/console";

const base = () => ({
  instance: { name: "atlas", project: "karajan-rag-atlas", allowedDomains: ["example.com"] },
  auth: { provider: "google" },
  roles: { admins: ["admin@example.com"], readers: ["@example.com"] },
  corpora: [{ id: "code", adapter: "gcp-cloud-run", project: "karajan-rag-atlas", region: "europe-west1", service: "atlas-code" }],
  operations: [{ id: "sync-docs", adapter: "github-workflow", repo: "org/atlas", workflow: "sync-docs.yml" }],
  secrets: [{ id: "notion", adapter: "github-secret", repo: "org/atlas", name: "NOTION_TOKEN" }, { id: "sa", adapter: "gcp-secret-manager", project: "p", name: "sa-json" }],
  configRepo: { adapter: "config-repo", repo: "org/atlas", path: "karajan-watch.config.json", watchVersion: "0.2.0" },
  audit: { sink: "gcs-jsonl", bucket: "atlas-console-audit" },
});
const problemsOf = (raw) => { try { parseConsoleConfig(raw); return []; } catch (e) { expect(e).toBeInstanceOf(ConsoleConfigError); return e.problems; } };

describe("console.config.json v1", () => {
  it("parses the reference instance and fills the defaults (version, healthPath, ref, roles, base, operators)", () => {
    const c = parseConsoleConfig(base());
    expect(c.version).toBe(1);
    expect(c.corpora[0].healthPath).toBe("/health");
    expect(c.operations[0]).toMatchObject({ ref: "main", roles: ["operator"] });
    expect(c.configRepo.base).toBe("main");
    expect(c.roles.operators).toEqual([]);
  });

  it("fails loud, listing EVERY problem: unknown adapter or sink, missing domains, no admin, bad repo", () => {
    const raw = base();
    raw.instance.allowedDomains = [];
    raw.roles.admins = [];
    raw.corpora[0].adapter = "aws-lambda";
    raw.audit = { sink: "stdout" };
    raw.operations[0].repo = "nope";
    const p = problemsOf(raw);
    expect(p.join("\n")).toMatch(/allowedDomains/);
    expect(p.join("\n")).toMatch(/admin/);
    expect(p.join("\n")).toMatch(/corpora\.0\.adapter/);
    expect(p.join("\n")).toMatch(/audit/);
    expect(p.join("\n")).toMatch(/owner\/name/);
  });

  it("a principal outside allowedDomains and duplicate ids are config errors, not runtime surprises", () => {
    const raw = base();
    raw.roles.operators = ["ops@other.org"];
    raw.corpora.push({ ...raw.corpora[0] });
    const p = problemsOf(raw);
    expect(p).toEqual(expect.arrayContaining([expect.stringMatching(/roles\.operators.*outside allowedDomains/), expect.stringMatching(/duplicate corpus id "code"/)]));
  });

  it("loads from disk; an unreadable or non-JSON file is a ConsoleConfigError naming the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-console-"));
    const file = path.join(dir, "console.config.json");
    fs.writeFileSync(file, JSON.stringify(base()));
    expect(loadConsoleConfig(file).instance.name).toBe("atlas");
    fs.writeFileSync(file, "{nope");
    expect(() => loadConsoleConfig(file)).toThrow(/console\.config\.json/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolveRole: admin > operator > reader, @domain grants the whole domain, other domains get nothing", () => {
    const c = parseConsoleConfig({ ...base(), roles: { admins: ["admin@example.com"], operators: ["ops@example.com", "admin@example.com"], readers: ["@example.com"] } });
    expect(resolveRole(c, "Admin@Example.com")).toBe("admin");
    expect(resolveRole(c, "ops@example.com")).toBe("operator");
    expect(resolveRole(c, "anyone@example.com")).toBe("reader");
    expect(resolveRole(c, "admin@other.org")).toBeNull();
    expect(resolveRole(c, "")).toBeNull();
    const strict = parseConsoleConfig({ ...base(), roles: { admins: ["admin@example.com"] } });
    expect(resolveRole(strict, "anyone@example.com")).toBeNull();
  });
});
