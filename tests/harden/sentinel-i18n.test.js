// HU-5055: the Sentinel's messages follow the configured language, or the system's.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { karajanHome, sentinelLang, t } from "../../src/harden/sentinel/sentinel-i18n.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

let projectDir, home;
const writeConfig = (base, language) => {
  fs.mkdirSync(path.join(base, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(base, ".karajan", "kj.config.yml"), `coder: claude\nlanguage: ${language}\n`);
};
const writeHomeConfig = (language) => fs.writeFileSync(path.join(home, "kj.config.yml"), `language: ${language}\n`);
const lang = (env) => sentinelLang({ projectDir, home, env });

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-i18n-project-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-i18n-home-"));
});
afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("sentinelLang", () => {
  it("takes the project's language over the home's, and the home's over the locale", () => {
    writeConfig(projectDir, "es");
    writeHomeConfig("en");
    expect(lang({ LANG: "en_US.UTF-8" })).toBe("es");
    fs.rmSync(path.join(projectDir, ".karajan"), { recursive: true });
    expect(lang({ LANG: "es_ES.UTF-8" })).toBe("en");
  });

  it("reads the locale: LC_ALL before LC_MESSAGES, LANG and LANGUAGE", () => {
    expect(lang({ LC_ALL: "es_ES.UTF-8", LANG: "en_US.UTF-8" })).toBe("es");
    expect(lang({ LC_MESSAGES: "es_ES", LANG: "en_US" })).toBe("es");
    expect(lang({ LANG: "es_ES.UTF-8" })).toBe("es");
  });

  it("resolves an unsupported or missing locale to English", () => {
    expect(lang({ LANG: "fr_FR.UTF-8" })).toBe("en");
    expect(lang({})).toBe("en");
  });

  it("an unsupported configured language resolves to English, without falling through", () => {
    writeConfig(projectDir, "fr");
    expect(lang({ LANG: "es_ES.UTF-8" })).toBe("en");
  });

  it("reads the home named by KARAJAN_HOME, then the legacy KJ_HOME, before the locale", () => {
    writeHomeConfig("es");
    expect(sentinelLang({ projectDir, env: { KARAJAN_HOME: home, LANG: "en_US.UTF-8" } })).toBe("es");
    expect(sentinelLang({ projectDir, env: { KJ_HOME: home, LANG: "en_US.UTF-8" } })).toBe("es");
  });

  it("the project's language wins over a home named by KARAJAN_HOME", () => {
    writeConfig(projectDir, "en");
    writeHomeConfig("es");
    expect(sentinelLang({ projectDir, env: { KARAJAN_HOME: home, LANG: "es_ES.UTF-8" } })).toBe("en");
  });
});

describe("karajanHome", () => {
  it("resolves KARAJAN_HOME, then KJ_HOME, and ignores empty values", () => {
    expect(karajanHome({ KARAJAN_HOME: home, KJ_HOME: "/elsewhere" })).toBe(path.resolve(home));
    expect(karajanHome({ KARAJAN_HOME: "", KJ_HOME: home })).toBe(path.resolve(home));
  });
});

describe("t", () => {
  it("returns the message in the language, interpolating {param}, with its accents", () => {
    expect(t("governs", "en")).toMatch(/^karajan: Karajan governs/);
    expect(t("governance_file", "es", { file: "x.yml" })).toContain("x.yml es configuración de gobierno");
    expect(t("governs", "es")).toContain("política");
  });

  it("falls back to English for a key missing in the language, and throws on an unknown key or parameter", () => {
    expect(t("governs", "fr")).toMatch(/^karajan: Karajan governs/);
    expect(() => t("no_such_key", "es")).toThrow(/no_such_key/);
    expect(() => t("governance_file", "en", {})).toThrow(/file/);
  });
});

describe("the Sentinel speaks the configured language", () => {
  let dir, pre;
  const edit = (env) => spawnSync("node", [pre], {
    input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, ".karajan", "policy.yml") } }),
    encoding: "utf8", cwd: dir, env,
  });
  const envWith = (extra) => {
    const env = { ...process.env, HOME: home, KJ_SENTINEL_OFF: "1" };
    for (const key of ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]) delete env[key];
    return { ...env, ...extra };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-i18n-hook-"));
    execSync("git init -q -b main", { cwd: dir });
    installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
    pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("blocks in English when the project language is en, whatever the locale", () => {
    writeConfig(dir, "en");
    const r = edit(envWith({ LANG: "es_ES.UTF-8" }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("is governance configuration");
    expect(r.stderr).toContain("Karajan governs and is obeyed");
  });

  it("blocks in Spanish with no language and LANG=es_ES.UTF-8", () => {
    const r = edit(envWith({ LANG: "es_ES.UTF-8" }));
    expect(r.stderr).toContain("es configuración de gobierno");
    expect(r.stderr).toContain("Karajan gobierna y se le obedece");
  });

  it.each(["KARAJAN_HOME", "KJ_HOME"])("blocks in Spanish when %s names a home with language es, whatever the locale", (name) => {
    writeHomeConfig("es");
    expect(edit(envWith({ LANG: "en_US.UTF-8", [name]: home })).stderr).toContain("es configuración de gobierno");
  });

  it("falls back to English for LANG=fr_FR.UTF-8", () => {
    expect(edit(envWith({ LANG: "fr_FR.UTF-8" })).stderr).toContain("is governance configuration");
  });
});
