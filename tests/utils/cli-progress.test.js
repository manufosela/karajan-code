import { describe, expect, it, vi } from "vitest";
import { createCliProgressReporter } from "../../src/utils/cli-progress.js";

function fakeStream() {
  const writes = [];
  return {
    write(chunk) { writes.push(chunk); },
    get out() { return writes.join(""); },
    get lines() { return this.out.split("\n").filter(Boolean); },
  };
}

describe("utils/cli-progress — createCliProgressReporter", () => {
  it("writes a header with the role on creation", () => {
    const stream = fakeStream();
    createCliProgressReporter({ role: "planner", stream });
    expect(stream.out).toContain("[planner] starting...");
  });

  it("defaults the role to \"agent\" when omitted", () => {
    const stream = fakeStream();
    createCliProgressReporter({ stream });
    expect(stream.out).toContain("[agent] starting...");
  });

  it("onOutput prints a bullet + line for text events", () => {
    const stream = fakeStream();
    const { onOutput } = createCliProgressReporter({ role: "coder", stream });
    onOutput({ line: "Analysing requirements" });
    expect(stream.lines).toContain("  · Analysing requirements");
  });

  it("uses the tool icon for kind=tool events", () => {
    const stream = fakeStream();
    const { onOutput } = createCliProgressReporter({ role: "coder", stream });
    onOutput({ line: "Read src/foo.js", kind: "tool" });
    expect(stream.lines).toContain("  ▸ Read src/foo.js");
  });

  it("uses the thinking icon for kind=thinking events", () => {
    const stream = fakeStream();
    const { onOutput } = createCliProgressReporter({ role: "coder", stream });
    onOutput({ line: "exploring options", kind: "thinking" });
    expect(stream.lines).toContain("  … exploring options");
  });

  it("ignores empty / whitespace-only lines", () => {
    const stream = fakeStream();
    const { onOutput } = createCliProgressReporter({ role: "coder", stream });
    onOutput({ line: "" });
    onOutput({ line: "   " });
    onOutput({ line: "\n\n" });
    // Only the header was written — no bullet lines.
    expect(stream.lines.filter((l) => l.startsWith("  "))).toEqual([]);
  });

  it("finish() prints a footer with elapsed seconds and the outcome", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    const stream = fakeStream();
    const { finish } = createCliProgressReporter({ role: "auditor", stream });
    vi.setSystemTime(start + 2500);
    finish("done");
    expect(stream.out).toContain("[auditor] done (2.5s)");
    vi.useRealTimers();
  });

  it("finish() defaults the outcome to \"done\"", () => {
    const stream = fakeStream();
    const { finish } = createCliProgressReporter({ role: "x", stream });
    finish();
    expect(stream.out).toMatch(/\[x\] done \(\d+\.\d+s\)/);
  });

  it("accepts custom outcomes (failed, stopped, timeout)", () => {
    const stream = fakeStream();
    const { finish } = createCliProgressReporter({ role: "x", stream });
    finish("timeout");
    expect(stream.out).toContain("[x] timeout");
  });

  it("quiet=true makes the reporter a no-op", () => {
    const stream = fakeStream();
    const rep = createCliProgressReporter({ role: "planner", stream, quiet: true });
    rep.onOutput({ line: "should not appear" });
    rep.finish("done");
    expect(stream.out).toBe("");
  });

  it("tolerates malformed onOutput events", () => {
    const stream = fakeStream();
    const { onOutput } = createCliProgressReporter({ role: "x", stream });
    expect(() => onOutput(null)).not.toThrow();
    expect(() => onOutput(undefined)).not.toThrow();
    expect(() => onOutput({})).not.toThrow();
    expect(() => onOutput({ line: 123 })).not.toThrow(); // non-string ignored
  });

  // KJC outputs limpios: bloques JSON NO inundan el stderr.
  // Supresión SILENCIOSA (sin marker "<json suprimido>" — un marker
  // también confunde al usuario; si suprimimos, suprimimos sin más).
  describe("JSON suppression", () => {
    it("suprime bloque ```json ... ``` sin dejar marker", () => {
      const stream = fakeStream();
      const { onOutput } = createCliProgressReporter({ role: "x", stream, heartbeatMs: 0 });
      onOutput({ line: "Generating plan...", kind: "text" });
      onOutput({ line: "```json", kind: "text" });
      onOutput({ line: '  "approach": "build it"', kind: "text" });
      onOutput({ line: '  "steps": [', kind: "text" });
      onOutput({ line: '    { "id": "INFRA-001" }', kind: "text" });
      onOutput({ line: "  ]", kind: "text" });
      onOutput({ line: "}", kind: "text" });
      onOutput({ line: "```", kind: "text" });
      onOutput({ line: "Done.", kind: "text" });
      expect(stream.out).not.toContain('"approach":');
      expect(stream.out).not.toContain('"id": "INFRA-001"');
      expect(stream.out).not.toMatch(/<json suprimido>/);
      expect(stream.out).not.toContain("```");
      expect(stream.out).toMatch(/Generating plan\.\.\./);
      expect(stream.out).toMatch(/Done\./);
    });

    it("suprime JSON sin fence (que empieza con `{` solo)", () => {
      const stream = fakeStream();
      const { onOutput } = createCliProgressReporter({ role: "x", stream, heartbeatMs: 0 });
      onOutput({ line: "Output:", kind: "text" });
      onOutput({ line: "{", kind: "text" });
      onOutput({ line: '  "ok": true', kind: "text" });
      onOutput({ line: "}", kind: "text" });
      onOutput({ line: "After.", kind: "text" });
      expect(stream.out).not.toContain('"ok": true');
      expect(stream.out).not.toMatch(/<json suprimido>/);
      expect(stream.out).toMatch(/Output:/);
      expect(stream.out).toMatch(/After\./);
    });

    it("no suprime líneas normales que casualmente tengan llaves", () => {
      const stream = fakeStream();
      const { onOutput } = createCliProgressReporter({ role: "x", stream, heartbeatMs: 0 });
      onOutput({ line: "Found {x} items.", kind: "text" });
      onOutput({ line: "Listing patterns matching {pattern}", kind: "text" });
      expect(stream.out).toMatch(/Found \{x\} items\./);
      expect(stream.out).toMatch(/Listing patterns matching \{pattern\}/);
    });

    // Casos del usuario en dogfooding GRETA: trozos de JSON SUELTOS
    // sin bloque previo y fences embedidos en texto.
    it("suprime trozos de propiedad JSON sueltos sin bloque", () => {
      const stream = fakeStream();
      const { onOutput } = createCliProgressReporter({ role: "x", stream, heartbeatMs: 0 });
      onOutput({ line: '  "spec_section": "1"', kind: "text" });
      onOutput({ line: '  "id": "INFRA-001",', kind: "text" });
      onOutput({ line: "  },", kind: "text" });
      onOutput({ line: "  ],", kind: "text" });
      onOutput({ line: "Texto normal después", kind: "text" });
      expect(stream.out).not.toContain('"spec_section":');
      expect(stream.out).not.toContain('"id": "INFRA-001"');
      expect(stream.out).toMatch(/Texto normal después/);
    });

    it("suprime líneas con fence embedded en texto (done: ```json)", () => {
      const stream = fakeStream();
      const { onOutput } = createCliProgressReporter({ role: "x", stream, heartbeatMs: 0 });
      onOutput({ line: "done: ```json", kind: "text" });
      onOutput({ line: '  "x": 1', kind: "text" });
      onOutput({ line: "```", kind: "text" });
      onOutput({ line: "Plan completed.", kind: "text" });
      expect(stream.out).not.toContain("done: ");
      expect(stream.out).not.toContain('"x": 1');
      expect(stream.out).not.toContain("```");
      expect(stream.out).toMatch(/Plan completed\./);
    });

    it("ya NO emite el marker `<json suprimido>` en ningún caso", () => {
      const stream = fakeStream();
      const { onOutput } = createCliProgressReporter({ role: "x", stream, heartbeatMs: 0 });
      onOutput({ line: "```json", kind: "text" });
      onOutput({ line: '"foo": "bar"', kind: "text" });
      onOutput({ line: "```", kind: "text" });
      expect(stream.out).not.toMatch(/<json suprimido>/);
    });
  });
});
