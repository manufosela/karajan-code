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

const run = (check = false) => enrich({ projectDir: dir, env: {}, check });
const cli = (...args) => spawnSync(process.execPath, [BIN, "enrich", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_ROOT: "" } });

describe("extractKeywords", () => {
  it("lowercases the description and headings, drops stopwords and fenced code, sorts and caps", () => {
    expect(extractKeywords("Write the failing test first", BODY)).toEqual(["code", "failing", "first", "green", "red", "refactor", "test", "write"]);
    const many = Array.from({ length: 40 }, (_, i) => `word${String(i).padStart(2, "0")}`).join(" ");
    expect(extractKeywords(many, "")).toHaveLength(20);
  });
});

describe("enrich", () => {
  it("writes keywords and the hash under atril:, keeping the author's text and body byte for byte", () => {
    expect(run()).toEqual([{ path: file, state: "not enriched" }]);
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(AUTHOR_FRONT)).toBe(true);
    expect(text.endsWith(`\n---\n${BODY}`)).toBe(true);
    const artifact = parseArtifact(file);
    expect(artifact.atril).toEqual({ keywords: extractKeywords(artifact.description, BODY), hash: artifact.hash });
    expect(run(true)).toEqual([]);
  });

  it("replaces only its own block on a second run and keeps other atril keys", () => {
    writeFileSync(file, AUTHOR.replace("roles", "atril:\n  bundle: kj\n  hash: sha256:old\nroles") + BODY);
    run();
    const text = readFileSync(file, "utf8");
    expect(text).toContain("roles: [coder]\natril:\n  bundle: kj\n  hash: sha256:");
    expect(text.match(/^atril:/gm)).toHaveLength(1);
    expect(run()).toEqual([]);
  });

  it("removes a whole atril: block holding blank and comment lines, keeping the author's comment", () => {
    writeFileSync(file, AUTHOR.replace("roles", "atril:\n  bundle: kj\n\n# old\n  hash: old\n\n# roles\nroles") + BODY);
    run();
    const text = readFileSync(file, "utf8");
    expect(text).toContain("kind: skill\n\n# roles\nroles: [coder]\natril:\n  bundle: kj\n  hash: sha256:");
    expect(run(true)).toEqual([]);
  });

  it("keeps CRLF line endings in the new block", () => {
    writeFileSync(file, (AUTHOR + BODY).replaceAll("\n", "\r\n"));
    run();
    expect(readFileSync(file, "utf8")).not.toMatch(/[^\r]\n/);
  });

  it("--check reports an edited body as out of date and writes nothing", () => {
    run();
    writeFileSync(file, readFileSync(file, "utf8").replace("The body stays.", "A new line."));
    const before = readFileSync(file, "utf8");
    expect(run(true)).toEqual([{ path: file, state: "out of date" }]);
    expect(readFileSync(file, "utf8")).toBe(before);
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
  it("writes discovered relations under atril: and leaves the author's untouched", () => {
    const command = join(dir, ".atril", "commands", "ship.md");
    mkdirSync(dirname(command), { recursive: true });
    writeFileSync(command, "---\nname: ship\ndescription: Ship it\nkind: command\n---\nUse the tdd skill.\n");
    run();
    expect(parseArtifact(command).atril.uses).toEqual(["skill:tdd"]);
    expect(parseArtifact(command).uses).toEqual([]);
    expect(run(true)).toEqual([]);
  });
});
