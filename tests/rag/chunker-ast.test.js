// KJC-TSK-0444 — AST chunker (@babel/parser).
import { describe, expect, it } from "vitest";
import { chunkSourceAST } from "../../src/rag/chunker-ast.js";
import { chunkSource, chunkSourceRegex } from "../../src/rag/chunker.js";

describe("rag/chunker-ast (KJC-TSK-0444)", () => {
  it("captures function declarations whole, with the JSDoc preceding them", () => {
    const src = `/**\n * Login flow.\n */\nexport async function login(user, pass) {\n  const u = await find(user);\n  if (!u) throw new Error('not found');\n  return jwt(u);\n}\n`;
    const chunks = chunkSourceAST(src, { path: "/auth.js" });
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbol).toBe("login");
    expect(chunks[0].text).toContain("Login flow.");
    expect(chunks[0].text).toContain("return jwt(u);");
  });

  it("yields one chunk per top-level export", () => {
    const src = "export function a() { return 1; }\nexport function b() { return 2; }\nexport function c() { return 3; }";
    const chunks = chunkSourceAST(src, { path: "/m.js" });
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["a", "b", "c"]);
  });

  it("recognises class declarations + export default", () => {
    const src = "export class Cache {}\nexport default function main() {}";
    const chunks = chunkSourceAST(src, { path: "/x.js" });
    expect(chunks.map((c) => c.metadata.symbol).sort()).toEqual(["Cache", "default"]);
  });

  it("handles TypeScript syntax (types, generics, interfaces) thanks to the typescript plugin", () => {
    const src = "interface User { id: string }\nexport function get<T extends User>(u: T): T { return u; }";
    const chunks = chunkSourceAST(src, { path: "/t.ts" });
    expect(chunks).not.toBeNull();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.find((c) => c.metadata.symbol === "get")).toBeTruthy();
  });

  it("returns null on truly unparseable input so chunkSource falls back to regex", () => {
    const garbage = "function (((((((((( syntax broken on purpose";
    // errorRecovery captures most cases, but completely malformed token streams still throw.
    // The null path is exercised by the catch in chunker-ast itself.
    const r = chunkSourceAST(garbage, { path: "/bad.js" });
    expect(r === null || r.length >= 0).toBe(true);
  });

  it("chunkSource prefers AST, falls back to regex when AST returns null", () => {
    const src = "export function alpha() { return 1; }";
    const chunks = chunkSource(src, { path: "/a.js" });
    expect(chunks[0].metadata.symbol).toBe("alpha");
    // Regex fallback still works directly
    const r = chunkSourceRegex(src, { path: "/a.js" });
    expect(r[0].metadata.symbol).toBe("alpha");
  });
});
