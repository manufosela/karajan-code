// HU-2782 (ADR 0039, decision 2): `kj skills search` asks atril in English. A query that
// is not English (or finds nothing) is translated by the `translator` role first.
import { describe, it, expect, vi } from "vitest";
import { skillsSearch } from "../../src/skills/skills-search.js";

const hit = { name: "forms", kind: "skill", description: "accessible forms", source: "project", installed: true, score: 0.9 };
const answer = (lang, english) => async () => JSON.stringify({ lang, english });
// The agent answers in turn: first the query translation, then (for a non-English query) the descriptions.
const seq = (...texts) => vi.fn(async () => texts.shift());
const query = (lang, english) => JSON.stringify({ lang, english });

async function run(args, { hits = {}, ask } = {}) {
  const out = []; const err = [];
  const search = vi.fn(async (q) => ({ mode: "lexical", hits: hits[q] ?? [] }));
  const code = await skillsSearch({ args, deps: { search, ask, out: (l) => out.push(l), err: (l) => err.push(l) } });
  return { code, out, err, search };
}

describe("kj skills search", () => {
  it("an English query with hits never calls the agent and prints atril's line format", async () => {
    const ask = vi.fn();
    const r = await run(["red green refactor"], { hits: { "red green refactor": [hit] }, ask });
    expect(ask).not.toHaveBeenCalled();
    expect(r.out).toEqual(["0.9\tskill\tforms\tproject\taccessible forms"]);
    expect(r.err).toEqual(["kj: search mode lexical"]);
    expect(r.code).toBe(0);
  });

  it("an accented query is translated, atril is asked the English text, and the descriptions come back in Spanish", async () => {
    const ask = seq(query("es", "forms"), '["formularios accesibles"]');
    const r = await run(["formulários"], { hits: { forms: [hit] }, ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(r.search.mock.calls.map(([q]) => q)).toEqual(["formulários", "forms"]);
    expect(r.out).toEqual(["0.9\tskill\tforms\tproject\tformularios accesibles"]);
    expect(r.err).toContain('kj: searched in English: "forms"');
  });

  it("--json keeps atril's description in description_en; name, kind, source and score never change", async () => {
    const r = await run(["--json", "formulários"], { hits: { forms: [hit] }, ask: seq(query("es", "forms"), '["formularios accesibles"]') });
    const [h] = JSON.parse(r.out[0]).hits;
    expect(h).toMatchObject({ ...hit, description: "formularios accesibles", description_en: "accessible forms" });
  });

  it("only the top 10 descriptions go to the agent, in one call", async () => {
    const hits = Array.from({ length: 12 }, (_, i) => ({ ...hit, name: `s${i}`, description: `d${i}` }));
    const ask = seq(query("es", "forms"), JSON.stringify(hits.slice(0, 10).map((_, i) => `t${i}`)));
    const r = await run(["--json", "formulários"], { hits: { forms: hits }, ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0]).toContain(JSON.stringify(hits.slice(0, 10).map((h) => h.description)));
    const out = JSON.parse(r.out[0]).hits;
    expect(out[9]).toMatchObject({ description: "t9", description_en: "d9" });
    expect(out[10]).toMatchObject({ description: "d10" });
    expect(out[10]).not.toHaveProperty("description_en");
  });

  it.each([
    ["a wrong-length answer", '["one","two"]'],
    ["a non-JSON answer", "sorry"],
  ])("%s for the descriptions leaves them untranslated, with a visible warning and exit 0", async (_, bad) => {
    const r = await run(["--json", "formulários"], { hits: { forms: [hit] }, ask: seq(query("es", "forms"), bad) });
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out[0]);
    expect(json.hits[0]).toMatchObject({ description: "accessible forms" });
    expect(json.hits[0]).not.toHaveProperty("description_en");
    expect(json.translation_error).toContain("translator answer");
    expect(r.err.join("\n")).toContain("showing the original descriptions");
  });

  it("control characters in a translated description never reach the terminal", async () => {
    const r = await run(["formulários"], { hits: { forms: [hit] }, ask: seq(query("es", "forms"), '["a\\u001b[31mred\\u0007"]') });
    expect(r.out[0]).toBe("0.9\tskill\tforms\tproject\ta [31mred");
  });

  it("an unaccented Spanish query with a stopword is translated even when atril has hits", async () => {
    const ask = seq(query("es", "no errors"), '["sin errores"]');
    const r = await run(["sin errores"], { hits: { "sin errores": [hit], "no errors": [hit] }, ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(r.search.mock.calls.map(([q]) => q)).toEqual(["sin errores", "no errors"]);
  });

  it("an unaccented query with zero hits is translated too, and lang en is a retry only", async () => {
    const ask = vi.fn(answer("en", "form validation"));
    const r = await run(["formz validation"], { hits: { "form validation": [hit] }, ask });
    expect(r.search.mock.calls.map(([q]) => q)).toEqual(["formz validation", "form validation"]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r.out).toHaveLength(1);
  });

  it("--no-translate never calls the agent, even for zero hits", async () => {
    const ask = vi.fn();
    const r = await run(["--no-translate", "formulario"], { ask });
    expect(ask).not.toHaveBeenCalled();
    expect(r.out).toEqual(['no results for "formulario"']);
  });

  it.each([
    ["the agent throws", async () => { throw new Error("claude: no binary"); }, "claude: no binary"],
    ["the answer is not JSON", async () => "sorry", "not valid JSON"],
    ["the answer has no english text", async () => '{"lang":"es"}', "no english text"],
  ])("when %s, the untranslated results show with a warning and exit 0", async (_, ask, reason) => {
    const r = await run(["formulário"], { hits: { "formulário": [hit] }, ask });
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.err.join("\n")).toContain("kj: translation unavailable (");
    expect(r.err.join("\n")).toContain(reason);
    expect(r.err.join("\n")).toContain("showing results for the untranslated query");
  });

  it("--json carries the query, whether it was translated, and the translation error", async () => {
    const ok = await run(["--json", "formulário"], { hits: { forms: [hit] }, ask: seq(query("es", "forms"), '["formularios"]') });
    expect(JSON.parse(ok.out[0])).toMatchObject({ mode: "lexical", translated: true, query: { original: "formulário", english: "forms", lang: "es" } });
    const bad = await run(["--json", "formulário"], { ask: async () => { throw new Error("x: down"); } });
    expect(JSON.parse(bad.out[0])).toMatchObject({ translated: false, translation_error: "x: down", query: { original: "formulário", english: "formulário", lang: null } });
  });

  it("control characters from atril never reach the terminal", async () => {
    const r = await run(["forms"], { hits: { forms: [{ ...hit, description: "a\u001b[31mred\u0007" }] } });
    expect(r.out[0]).toBe("0.9\tskill\tforms\tproject\ta [31mred");
  });

  it("passes --kind and --root to atril and fails loudly when atril does", async () => {
    const search = vi.fn(async () => { throw new Error("atril search failed: empty query"); });
    const err = [];
    const code = await skillsSearch({ args: ["--kind", "agent", "--root", "r", "x"], deps: { search, out() {}, err: (l) => err.push(l) } });
    expect(search).toHaveBeenCalledWith("x", { kind: "agent", root: "r" });
    expect(code).toBe(1);
    expect(err).toEqual(["kj: atril search failed: empty query"]);
  });
});
