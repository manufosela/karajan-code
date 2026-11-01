// HU-0012 (ADR 0021, decision 9 and plan step 4): `atril enrich` writes what
// it discovers under `atril:` and nothing else; `--check` only reports.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enrich, extractKeywords } from "../src/enrich.js";
import { parseArtifact } from "../src/model.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const AUTHOR = "---\nname: tdd # the slug\ndescription: Write the failing test first\nkind: skill\nroles: [coder]\n---\n";
const AUTHOR_FRONT = AUTHOR.replace(/---\n$/, "");
const BODY = "# Red, green\n\nThe body stays.\n\n```sh\n# not a heading\n```\n## Refactor the code\n";
let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-enrich-"));
  file = join(dir, ".atril", "skills", "tdd", "SKILL.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, AUTHOR + BODY);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (check = false, enricher) => enrich({ projectDir: dir, env: {}, check, enricher });
const cli = (...args) => spawnSync(process.execPath, [BIN, "enrich", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_ROOT: "" } });

describe("extractKeywords", () => {
  // HU-2729 (ADR 0038, layer 1): keywords are folded, so they match folded queries.
  it("folds accents and ñ in keywords", () => {
    expect(extractKeywords("Mejora la búsqueda del año", "")).toEqual(["ano", "busqueda", "del", "la", "mejora"]);
  });
  it("lowercases the description and headings, drops stopwords and fenced code, sorts and caps", () => {
    expect(extractKeywords("Write the failing test first", BODY)).toEqual(["code", "failing", "first", "green", "red", "refactor", "test", "write"]);
    const many = Array.from({ length: 40 }, (_, i) => `word${String(i).padStart(2, "0")}`).join(" ");
    expect(extractKeywords(many, "")).toHaveLength(20);
  });
});

describe("enrich", () => {
  it("writes keywords and the hash under atril:, keeping the author's text and body byte for byte", async () => {
    expect(await run()).toEqual([{ path: file, state: "not enriched" }]);
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(AUTHOR_FRONT)).toBe(true);
    expect(text.endsWith(`\n---\n${BODY}`)).toBe(true);
    const artifact = parseArtifact(file);
    expect(artifact.atril).toEqual({ keywords: extractKeywords(artifact.description, BODY), hash: artifact.hash });
    expect(await run(true)).toEqual([]);
  });

  it("replaces only its own block on a second run and keeps other atril keys", async () => {
    writeFileSync(file, AUTHOR.replace("roles", "atril:\n  bundle: kj\n  hash: sha256:old\nroles") + BODY);
    await run();
    const text = readFileSync(file, "utf8");
    expect(text).toContain("roles: [coder]\natril:\n  bundle: kj\n  hash: sha256:");
    expect(text.match(/^atril:/gm)).toHaveLength(1);
    expect(await run()).toEqual([]);
  });

  it("removes a whole atril: block holding blank and comment lines, keeping the author's comment", async () => {
    writeFileSync(file, AUTHOR.replace("roles", "atril:\n  bundle: kj\n\n# old\n  hash: old\n\n# roles\nroles") + BODY);
    await run();
    const text = readFileSync(file, "utf8");
    expect(text).toContain("kind: skill\n\n# roles\nroles: [coder]\natril:\n  bundle: kj\n  hash: sha256:");
    expect(await run(true)).toEqual([]);
  });

  it("keeps CRLF line endings in the new block", async () => {
    writeFileSync(file, (AUTHOR + BODY).replaceAll("\n", "\r\n"));
    await run();
    expect(readFileSync(file, "utf8")).not.toMatch(/[^\r]\n/);
  });

  it("--check reports an edited body as out of date and writes nothing", async () => {
    await run();
    writeFileSync(file, readFileSync(file, "utf8").replace("The body stays.", "A new line."));
    const before = readFileSync(file, "utf8");
    expect(await run(true)).toEqual([{ path: file, state: "out of date" }]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  // HU-2781 (ADR 0039, decision 1): a non-English description is warned about, never changed.
  describe("non-English warning", () => {
    const addSpanish = () => {
      const other = join(dir, ".atril", "skills", "probar", "SKILL.md");
      mkdirSync(dirname(other), { recursive: true });
      writeFileSync(other, "---\nname: probar\ndescription: Escribe la prueba para el login\nkind: skill\n---\nbody\n");
    };
    it("warns once for the Spanish skill only, on every run and under --check, without changing the result", () => {
      addSpanish();
      const warnings = [];
      const onWarning = (text) => warnings.push(text);
      const plain = run(true);
      expect(enrich({ projectDir: dir, env: {}, check: true, onWarning })).toEqual(plain);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^skill:probar: description look\(s\) non-English/);
      enrich({ projectDir: dir, env: {}, onWarning });
      expect(warnings).toHaveLength(2);
    });
    it("reaches stderr from the CLI and leaves stdout alone", () => {
      addSpanish();
      const res = cli();
      expect(res.stderr).toContain("skill:probar: description look(s) non-English");
      expect(res.stdout).not.toContain("non-English");
    });
  });
});

// HU-2732 (ADR 0039, layer 1): the enricher hook writes English metadata to atril.en.
describe("enrich with an enricher", () => {
  const english = { description: "Write the failing test first, in English", keywords: ["Búsqueda", "tdd"] };
  it("writes atril.en with the artifact's hash and merges its keywords folded, leaving the author's description", async () => {
    const seen = [];
    await run(false, async (artifact) => (seen.push(artifact.name), english));
    const { atril, hash, description } = parseArtifact(file);
    expect(seen).toEqual(["tdd"]);
    expect(description).toBe("Write the failing test first");
    expect(atril.en).toEqual({ ...english, hash });
    expect(atril.keywords).toEqual(expect.arrayContaining(["busqueda", "tdd", "failing"]));
    expect([...atril.keywords].sort()).toEqual(atril.keywords);
    expect(readFileSync(file, "utf8").endsWith(`\n---\n${BODY}`)).toBe(true);
  });

  it("calls the enricher only when atril.en is missing or its hash is stale; without it keeps atril.en", async () => {
    let calls = 0;
    const enricher = async () => (calls++, english);
    await run(false, enricher);
    await run(false, enricher);
    expect(calls).toBe(1);
    await run();
    expect(parseArtifact(file).atril.en.description).toBe(english.description);
    writeFileSync(file, readFileSync(file, "utf8").replace("The body stays.", "A new line."));
    expect(await run(true, enricher)).toHaveLength(1);
    expect(calls).toBe(1);
    await run(false, enricher);
    expect(calls).toBe(2);
  });

  it("keeps the English keywords when the extracted ones already fill the cap", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `aaa${String(i).padStart(2, "0")}`).join(" ");
    writeFileSync(file, AUTHOR.replace("Write the failing test first", many) + BODY);
    await run(false, async () => ({ keywords: ["zzz", " "] }));
    const { keywords } = parseArtifact(file).atril;
    expect(keywords).toHaveLength(20);
    expect(keywords).toContain("zzz");
    expect(keywords).not.toContain("");
  });

  it("rejects a result of the wrong shape, naming the artifact", async () => {
    for (const bad of [null, "x", { description: 1 }, { keywords: "tdd" }, { keywords: [1] }]) {
      await expect(run(false, async () => bad)).rejects.toThrow(file);
    }
  });
});

describe("atril enrich", () => {
  it("--check exits non-zero listing what is stale, then passes after enrich", () => {
    const failing = cli("--check");
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain(`not enriched\t${join(".atril", "skills", "tdd", "SKILL.md")}`);
    expect(readFileSync(file, "utf8")).toBe(AUTHOR + BODY);
    expect(cli().status).toBe(0);
    expect(cli("--check").status).toBe(0);
  });
});

describe("enrich relations", () => {
  it("writes discovered relations under atril: and leaves the author's untouched", async () => {
    const command = join(dir, ".atril", "commands", "ship.md");
    mkdirSync(dirname(command), { recursive: true });
    writeFileSync(command, "---\nname: ship\ndescription: Ship it\nkind: command\n---\nUse the tdd skill.\n");
    await run();
    expect(parseArtifact(command).atril.uses).toEqual(["skill:tdd"]);
    expect(parseArtifact(command).uses).toEqual([]);
    expect(await run(true)).toEqual([]);
  });
});
