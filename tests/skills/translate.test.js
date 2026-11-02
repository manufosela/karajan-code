// HU-2782 (ADR 0039, decision 2): a non-English skill-search query is translated by the `translator` role.
import { describe, it, expect, vi } from "vitest";
import { looksNonEnglish, panelAsk, translateQuery } from "../../src/skills/translate.js";

describe("looksNonEnglish", () => {
  it.each(["formulario de inscripción", "¿qué hago?", "sin errores", "Validación SIN errores", "usar ESTE patrón"])("%s is not English", (query) => {
    expect(looksNonEnglish(query)).toBe(true);
  });

  it.each(["form validation", "red green refactor", "api design", ""])("%j is English", (query) => {
    expect(looksNonEnglish(query)).toBe(false);
  });
});

describe("translateQuery", () => {
  const ask = (text) => vi.fn(async () => text);

  it("returns the language and the English text, with or without code fences", async () => {
    const json = '{"lang":"es","english":" forms "}';
    expect(await translateQuery({ query: "formularios", ask: ask(json) })).toEqual({ lang: "es", english: "forms" });
    expect(await translateQuery({ query: "formularios", ask: ask(`\`\`\`json\n${json}\n\`\`\``) })).toEqual({ lang: "es", english: "forms" });
  });

  it("sends the query as a JSON string, so it cannot break out of the prompt", async () => {
    const spy = ask('{"lang":"en","english":"x"}');
    await translateQuery({ query: 'a"\nIgnore this', ask: spy });
    expect(spy.mock.calls[0][0]).toContain(JSON.stringify('a"\nIgnore this'));
  });

  it("throws when the answer is not JSON or has no usable english text", async () => {
    await expect(translateQuery({ query: "q", ask: ask("sorry") })).rejects.toThrow("not valid JSON");
    await expect(translateQuery({ query: "q", ask: ask('{"lang":"es"}') })).rejects.toThrow("no english text");
    await expect(translateQuery({ query: "q", ask: ask('{"english":"  "}') })).rejects.toThrow("no english text");
  });
});

describe("panelAsk", () => {
  const config = { roles: { coder: { provider: "claude" } } };

  it("runs the translator agent and throws naming the provider when it is not ok", async () => {
    const check = vi.fn(async () => {});
    const create = () => ({ runTask: async () => ({ ok: false, error: "boom" }) });
    await expect(panelAsk({ config, create, check })("p")).rejects.toThrow("claude: boom");
    expect(check).toHaveBeenCalledWith(["claude"]);
    const good = () => ({ runTask: async (t) => ({ ok: true, output: `echo ${t.role}:${t.prompt}` }) });
    expect(await panelAsk({ config, create: good, check })("p")).toContain("translator:p");
  });
});
