// KJC-BUG-0161 / ADR 0009 (opción A) — el cauce sancionado del supervisor,
// pieza 2: `kj harden --commit` es un ACTO HUMANO que versiona la
// regeneración con procedencia: un fichero de provenance trackeado (versión
// de kj, parámetros de generación, sha256 por fichero) + sello en el acta
// local + commit que SOLO contiene supervisor y provenance.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { createHash } from "node:crypto";

import { commitSupervisorRegeneration, harnessGuards, PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";
import { setNormalLevel } from "../_fixtures/set-normal-level.js";

let repo;
const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

// Cadena de procesos HUMANA inyectada: bash ← sshd ← init. Sin inyectar, la
// ascendencia REAL de la suite (que corre bajo un agente) rechazaría — que es
// exactamente lo que la capa debe hacer.
const humanChain = { 100: { ppid: 50, cmd: "bash" }, 50: { ppid: 1, cmd: "sshd: manu@pts/0" } };
// phone.enrolled=false por defecto: la capa 5 (KJC-TSK-0822) solo actúa con
// móvil enrolado — y el default real miraría el $HOME de quien corre la suite.
const HUMAN = { env: {}, tty: true, deps: { confirm: (n) => n, phone: { enrolled: () => false }, ancestry: { pid: 100, readProc: (p) => humanChain[p] ?? { ppid: 1, cmd: "init" } } } };
const generation = { profile: "standard", cmds: { lint: "x" }, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-supcommit-"));
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
  writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nold\n");
  writeFileSync(join(repo, "other.txt"), "untouched\n");
  setNormalLevel(repo); // KJC-TSK-0997: max is the default; these tests prove the four layers
  git(["add", "-A"]);
  git(["commit", "-qm", "seed", "--no-verify"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("kj harden --commit (KJC-BUG-0161)", () => {
  it("refuses inside an agent session — the channel is human-only", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    for (const ctx of [
      { env: { CLAUDECODE: "1" }, tty: true },
      { env: { KJ_NON_INTERACTIVE: "1" }, tty: true },
      { env: {}, tty: false },
    ]) {
      await expect(
        commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...ctx }),
      ).rejects.toThrow(/humano/);
    }
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("a faked pty with a clean env still refuses: the process DESCENDS from an agent", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    // script(1) + env -u: tty=true y env limpio — pero la cadena de procesos
    // delata al agente: script ← sh ← node(claude).
    const chain = { 200: { ppid: 150, cmd: "script -qec kj harden --commit" }, 150: { ppid: 120, cmd: "sh" }, 120: { ppid: 1, cmd: "node /usr/lib/claude-code/cli.js" } };
    await expect(
      commitSupervisorRegeneration({
        projectDir: repo, kjVersion: "9.9.9", generation, env: {}, tty: true,
        deps: { ancestry: { pid: 200, readProc: (p) => chain[p] ?? { ppid: 1, cmd: "init" } } },
      }),
    ).rejects.toThrow(/desciende de un agente/);
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("a blind prompt-feeder fails the nonce: layer 4 refuses (adversarial catch, 6-sep)", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    for (const confirm of [() => "\n", () => "yes", () => null]) {
      await expect(
        commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, confirm } }),
      ).rejects.toThrow(/confirmación humana fallida/);
    }
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("with drift: writes provenance, seals the acta, and commits ONLY supervisor+provenance", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    writeFileSync(join(repo, "other.txt"), "dirty working tree survives\n");
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.kj_version).toBe("9.9.9");
    expect(prov.generation.globalHooksDir).toBe("$HOME/.git-hooks");
    expect(prov.files.some((f) => f.file === ".karajan/hooks/pre-commit" && /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    // el acta local ganó el sello
    const acta = readFileSync(join(repo, ".karajan", "policy-decisions.jsonl"), "utf8");
    expect(acta).toContain("supervisor-regeneration");
    // el commit contiene EXACTAMENTE supervisor + provenance (other.txt fuera)
    const shown = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
    expect(shown).toContain(".karajan/hooks/pre-commit");
    expect(shown).toContain(PROVENANCE_FILE);
    expect(shown).not.toContain("other.txt");
  });

  it("KJC-BUG-0264: an older .karajan block in .gitignore is completed, so the provenance is committed", async () => {
    const old = ".karajan/*\n!.karajan/review-gate\n!.karajan/hooks/\n.karajan/hooks/*\n!.karajan/hooks/pre-commit\n!.karajan/adrs/\n";
    writeFileSync(join(repo, ".gitignore"), old);
    git(["add", ".gitignore"]);
    git(["commit", "-qm", "old block", "--no-verify"]);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(PROVENANCE_FILE);
    // The .gitignore change stays in the tree for a normal PR, outside the sealed commit.
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toContain("!.karajan/supervisor-provenance.json");
    expect(git(["show", "--name-only", "--format=", "HEAD"])).not.toContain(".gitignore");
  });

  it("KJC-BUG-0244: refuses while something else is staged, naming it, before asking the human", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    writeFileSync(join(repo, "other.txt"), "another card's work\n");
    git(["add", "other.txt"]);
    let asked = false;
    const deps = { ...HUMAN.deps, confirm: (n) => { asked = true; return n; } };
    await expect(commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps })).rejects.toThrow(/other\.txt/);
    expect(asked).toBe(false);
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
    expect(git(["diff", "--cached", "--name-only"])).toContain("other.txt");
  });

  it("KJC-BUG-0507: seals once per branch; a second seal is refused before asking the human", async () => {
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    expect((await commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation })).committed).toBe(true);
    const sealCommit = git(["rev-parse", "--short", "HEAD"]).trim();
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnewer\n");
    let asked = false;
    const deps = { ...HUMAN.deps, confirm: (n) => { asked = true; return n; } };
    const second = commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps });
    await expect(second).rejects.toThrow(`esta rama ya lleva un sello sin mergear (${sealCommit})`);
    expect(asked).toBe(false);
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(2);
  });

  it("a DELETED hook is drift too — recorded as deleted, committed (codex catch)", async () => {
    rmSync(join(repo, ".karajan", "hooks", "pre-commit"));
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".karajan/hooks/pre-commit", deleted: true });
    expect(git(["show", "--name-status", "--format=", "HEAD"])).toContain("D\t.karajan/hooks/pre-commit");
  });

  it("a RENAMED hook yields both paths — old as deleted, new hashed (codex catch)", async () => {
    git(["mv", ".karajan/hooks/pre-commit", ".karajan/hooks/pre-commit-new"]);
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".karajan/hooks/pre-commit", deleted: true });
    expect(prov.files.some((f) => f.file === ".karajan/hooks/pre-commit-new" && f.sha256)).toBe(true);
  });

  it("without drift AND full coverage: commits nothing; partial coverage RESEALS (estreno catch)", async () => {
    // Primer sello: sin drift pero sin provenance ⇒ resella (cobertura).
    const first = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(first.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files.length).toBe(1);
    // Segundo: sin drift y cubierto ⇒ nada.
    const second = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(second.committed).toBe(false);
  });

  // Capa 5 (KJC-TSK-0822 / PRP-0023): con móvil enrolado, la firma asimétrica
  // es OBLIGATORIA y firma los MISMOS files/hashes de la provenance.
  it("enrolled phone + valid signature: commits, and the phone signed the provenance files", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    let asked;
    const phone = { enrolled: () => true, request: async (req) => { asked = req; return { ok: true, block: { signer: "s", signature: "g" } }; } };
    const res = await commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, phone } });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(asked.files).toEqual(prov.files.map(({ file, sha256 }) => ({ file, sha256: sha256 ?? "" })));
    expect(asked.kjVersion).toBe("9.9.9");
  });

  // KJC-TSK-0823: cuando el móvil devuelve el desafío+firma, la provenance los
  // GRABA (bloque signature) para que CI re-verifique server-side.
  it("enrolled phone returning a challenge+signature: provenance records the signature block", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    const challenge = { cid: "cafe", nonce: "babe", project: "p", filesHash: "abc123" };
    const phone = { enrolled: () => true, request: async () => ({ ok: true, signer: "PUBKEY", signature: "SIG", challenge, block: { ...challenge, signer: "PUBKEY", signature: "SIG" } }) };
    const res = await commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, phone } });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.signature).toEqual({ ...challenge, signer: "PUBKEY", signature: "SIG" });
  });

  it("enrolled phone + rejected/expired signature: throws and commits NOTHING — never nonce-only", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    for (const reason of ["firma ed25519 inválida para el payload canónico", "caducado"]) {
      const phone = { enrolled: () => true, request: async () => ({ ok: false, reason }) };
      await expect(
        commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, phone } }),
      ).rejects.toThrow(reason);
    }
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("no phone enrolled: current flow intact — the phone is never asked", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    const phone = { enrolled: () => false, request: async () => { throw new Error("must not be called"); } };
    const res = await commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, phone } });
    expect(res.committed).toBe(true);
  });

  // KJC-TSK-0996 (HUM-D, ADR 0018): at max the seal needs the phone; no typed code instead.
  it("security level max and no phone enrolled: the seal is refused, told how to enroll, and commits NOTHING", async () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    writeFileSync(join(repo, ".karajan", "security-level.json"), JSON.stringify({ level: "max", since: "2026-10-09" }));
    const phone = { enrolled: () => false, request: async () => { throw new Error("must not be called"); } };
    await expect(commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, phone } }))
      .rejects.toThrow(/harden --commit: con seguridad máxima este acto se firma con el móvil y no hay ninguno enrolado/);
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });
});

// KJC-BUG-0197: la "procedencia del supervisor" no cubria los guardias del
// supervisor. Sellaba .karajan/hooks/* y ningun .mjs de .karajan/harness/, que
// son los que vigilan la sesion, asi que nada externo podia decir si un guardia
// instalado era autentico. Siguen gitignorados a proposito: lo que viaja y se
// firma es su HUELLA, dentro de una procedencia que si esta trackeada.
// KJC-TSK-1032 (owner's decision, 13-oct): the governance config is sealed with
// the supervisor, so a policy change only enters with the human's signed act.
describe("the seal covers the governance config (KJC-TSK-1032)", () => {
  const policy = () => join(repo, ".karajan", "policy.yml");
  beforeEach(() => {
    writeFileSync(policy(), "version: 1\ninvariants: []\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "policy", "--no-verify"]);
  });

  it("a changed policy.yml is sealed: hashed in the provenance and in the sealed commit", async () => {
    writeFileSync(policy(), "version: 1\ninvariants:\n  - id: loc\n    kind: diff-threshold\n    metric: net_lines_added\n    max: 500\n");
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    const sha = createHash("sha256").update(readFileSync(policy())).digest("hex");
    expect(prov.files).toContainEqual({ file: ".karajan/policy.yml", sha256: sha });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(".karajan/policy.yml");
  });

  it("a staged policy.yml is part of the seal, not foreign work", async () => {
    writeFileSync(policy(), "version: 1\ninvariants: []\n# loosened\n");
    git(["add", ".karajan/policy.yml"]);
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
  });

  it("a governance file the project does not have is not listed", async () => {
    writeFileSync(policy(), "version: 1\ninvariants: []\n# v2\n");
    await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files.map((f) => f.file)).not.toContain(".karajan/rules.yml");
  });

  // KJC-BUG-0400: the CI workflows are sealed with the governance config.
  it("a changed CI workflow is sealed, and a staged one is part of the seal, not foreign work", async () => {
    const wf = join(repo, ".github", "workflows", "kj-policy.yml");
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(wf, "name: Policy\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "wf", "--no-verify"]);
    writeFileSync(wf, "name: Policy\n# pinned to a new kj\n");
    git(["add", ".github/workflows/kj-policy.yml"]);
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".github/workflows/kj-policy.yml", sha256: createHash("sha256").update(readFileSync(wf)).digest("hex") });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(".github/workflows/kj-policy.yml");
  });

  // HU-4012: the verdicts check harden writes is sealed like kj-policy.yml, new or changed.
  it("a new kj-verdicts.yml is sealed and committed with the seal", async () => {
    const wf = join(repo, ".github", "workflows", "kj-verdicts.yml");
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(wf, "name: Cross-AI verdicts\n");
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".github/workflows/kj-verdicts.yml", sha256: createHash("sha256").update(readFileSync(wf)).digest("hex") });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(".github/workflows/kj-verdicts.yml");
  });

  // KJC-TSK-1207 (ADR 0030): the host settings decide which guard runs.
  const settings = () => join(repo, ".claude", "settings.json");
  const hashOf = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

  it("versioned host settings are sealed and committed with the seal", async () => {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(settings(), "{}\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "settings", "--no-verify"]);
    writeFileSync(settings(), '{"hooks":{}}\n');
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".claude/settings.json", sha256: hashOf(settings()) });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(".claude/settings.json");
  });

  it("host settings that are untracked but not ignored are committed with the seal, never taken for local", async () => {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(settings(), '{"hooks":{}}\n');
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".claude/settings.json", sha256: hashOf(settings()) });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(".claude/settings.json");
  });

  it("ignored host settings are sealed by their hash alone, and git is never asked to add them", async () => {
    writeFileSync(join(repo, ".gitignore"), ".claude/\n");
    git(["add", ".gitignore"]);
    git(["commit", "-qm", "ignore", "--no-verify"]);
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(settings(), '{"hooks":{}}\n');
    writeFileSync(policy(), "version: 1\ninvariants: []\n# v3\n");
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".claude/settings.json", sha256: hashOf(settings()), local: true });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).not.toContain(".claude/settings.json");
  });

  // KJC-TSK-1444: the Sentinel's wiring lives in settings.local.json, which the clone's exclude ignores.
  it("the local host settings, where the Sentinel is wired, are sealed by their hash and never committed", async () => {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    writeFileSync(join(repo, ".git", "info", "exclude"), "/.claude/settings.local.json\n");
    const local = join(repo, ".claude", "settings.local.json");
    writeFileSync(local, '{"hooks":{"Stop":[]}}\n');
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".claude/settings.local.json", sha256: hashOf(local), local: true });
    expect(git(["show", "--name-only", "--format=", "HEAD"])).not.toContain("settings.local.json");
  });

  it("a deleted policy.yml is recorded as deleted and committed", async () => {
    rmSync(policy());
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".karajan/policy.yml", deleted: true });
    expect(git(["ls-files", ".karajan/policy.yml"]).trim()).toBe("");
  });

  // HU-3899: a file the project declares in policy.yml sealed_files is sealed like the governance config.
  const declareAgents = () => {
    writeFileSync(join(repo, "AGENTS.md"), "# rules\n");
    writeFileSync(policy(), "version: 1\nsealed_files: [AGENTS.md, NEW.md, MISSING.md]\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "declare", "--no-verify"]);
  };

  it("declared files, changed and staged or new to git, are sealed and committed, and the verifier accepts them (HU-3899)", async () => {
    declareAgents();
    writeFileSync(join(repo, "AGENTS.md"), "# rules, v2\n");
    git(["add", "AGENTS.md"]);
    writeFileSync(join(repo, "NEW.md"), "# new\n");
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    for (const f of ["AGENTS.md", "NEW.md"]) expect(prov.files).toContainEqual({ file: f, sha256: hashOf(join(repo, f)) });
    expect(prov.files.map((f) => f.file)).not.toContain("MISSING.md");
    expect(git(["show", "--name-only", "--format=", "HEAD"]).split("\n")).toEqual(expect.arrayContaining(["AGENTS.md", "NEW.md"]));
    // HUMAN seals without a phone; the roster setNormalLevel left would demand a signature, so the hashes judge alone.
    rmSync(join(repo, ".karajan", "supervisor-signers.json"));
    expect([...verifiedSupervisorFiles({ projectDir: repo }).files]).toEqual(expect.arrayContaining(["AGENTS.md", "NEW.md"]));
  });

  it("a sealed declared file, deleted later, is recorded as deleted and committed (HU-3899)", async () => {
    declareAgents();
    await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    rmSync(join(repo, "AGENTS.md"));
    expect((await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN })).committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: "AGENTS.md", deleted: true });
    expect(git(["ls-files", "AGENTS.md"]).trim()).toBe("");
  });
});

describe("el sello cubre los guardias del Sentinel (KJC-BUG-0197)", () => {
  const writeGuard = (name, body) => {
    mkdirSync(join(repo, ".karajan", "harness"), { recursive: true });
    writeFileSync(join(repo, ".karajan", "harness", name), body);
  };

  it("harnessGuards lee los .mjs del harness y nada mas", () => {
    writeGuard("stop.mjs", "// guardia\n");
    writeGuard("sentinel-state.json", "{}");
    expect(harnessGuards(repo)).toEqual([".karajan/harness/stop.mjs"]);
  });

  it("sin harness (perfil minimal) devuelve vacio, no revienta", () => {
    expect(harnessGuards(repo)).toEqual([]);
  });

  it("la procedencia incluye el hash de cada guardia", async () => {
    writeGuard("stop.mjs", "// el guardia que vigila el turno\n");
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");

    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });

    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    const guard = prov.files.find((f) => f.file === ".karajan/harness/stop.mjs");
    expect(guard).toBeDefined();
    expect(guard.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Y sigue fuera de git: lo que se commitea son los hooks y la procedencia.
    const shown = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
    expect(shown).not.toContain(".karajan/harness/stop.mjs");
    expect(shown).toContain(PROVENANCE_FILE);
  });

  it("un guardia que cambia deja la procedencia incompleta: hay que re-sellar", async () => {
    writeGuard("stop.mjs", "// version 1\n");
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });

    // Sin drift en los hooks, pero el guardia cambio: NO es "nada que versionar".
    writeGuard("stop.mjs", "// version 2, regenerada por un harden posterior\n");
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });

    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    const guard = prov.files.find((f) => f.file === ".karajan/harness/stop.mjs");
    expect(guard.sha256).toBe(createHash("sha256").update("// version 2, regenerada por un harden posterior\n").digest("hex"));
  });

  it("un guardia BORRADO se anota como borrado, no se omite", async () => {
    writeGuard("stop.mjs", "// guardia\n");
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });

    rmSync(join(repo, ".karajan", "harness", "stop.mjs"));
    const res = await commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });

    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toEqual(expect.arrayContaining([{ file: ".karajan/harness/stop.mjs", deleted: true }]));
  });

  it("el movil firma tambien los guardias, no solo los hooks", async () => {
    writeGuard("stop.mjs", "// guardia\n");
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    let signedFiles = null;
    await commitSupervisorRegeneration({
      projectDir: repo, kjVersion: "9.9.9", generation,
      ...HUMAN,
      deps: {
        ...HUMAN.deps,
        phone: {
          enrolled: () => true,
          request: async ({ files }) => { signedFiles = files; return { ok: true, signer: "s", block: { signer: "s", signature: "g" } }; },
        },
      },
    });
    expect(signedFiles.map((f) => f.file)).toContain(".karajan/harness/stop.mjs");
  });
});
