// CLM-B (KJC-TSK-0802) — `kj claims check`: exit 2 ONLY when a datum is denied by
// its own source. Anything else is reported, and a transcript it cannot read gets
// out of the way instead of holding the session hostage (fail open).
import { describe, it, expect, vi } from "vitest";
import { claimsCommand } from "../../src/commands/claims.js";

const logger = () => ({ log: vi.fn(), error: vi.fn(), out: function () { return this.log.mock.calls.flat().join("\n"); }, err: function () { return this.error.mock.calls.flat().join("\n"); } });
const turnWith = (text, outputs = [], userSaid = "") => () => ({ text, outputs, userSaid });

describe("kj claims check", () => {
  it("exit 2 when a datum is denied by the output that should back it", async () => {
    const log = logger();
    const code = await claimsCommand({
      flags: { transcript: "t.jsonl" }, logger: log,
      readTurnFn: turnWith("Quedan 4 cards esperando validación.", ["list_cards status=To Validate → []"]),
    });
    expect(code).toBe(2);
    expect(log.err()).toMatch(/DENIED/);
  });

  it("exit 0 with everything backed, and it says how many it checked", async () => {
    const log = logger();
    const code = await claimsCommand({
      flags: { transcript: "t.jsonl" }, logger: log,
      readTurnFn: turnWith("Escaneé 1004 ficheros y publiqué la 0.3.0.", ["1004 files scanned", "+ pkg@0.3.0"]),
    });
    expect(code).toBe(0);
    expect(log.out()).toMatch(/2 dato\(s\) comprobado\(s\)/);
  });

  it("unbacked data is reported but does NOT block: inform always, block almost never", async () => {
    const log = logger();
    const code = await claimsCommand({
      flags: { transcript: "t.jsonl" }, logger: log,
      readTurnFn: turnWith("La suite tiene 812 tests.", ["Tests 53 passed"]),
    });
    expect(code).toBe(0);
    expect(log.err()).toMatch(/no backing/);
  });

  it("fails OPEN when the transcript cannot be read, and says nothing was checked", async () => {
    const log = logger();
    const code = await claimsCommand({
      flags: { transcript: "missing.jsonl", json: true }, logger: log,
      readTurnFn: () => { throw new Error("ENOENT"); },
    });
    expect(code).toBe(0);
    expect(JSON.parse(log.out())).toMatchObject({ ok: true, checked: false });
    expect(log.out()).toMatch(/ENOENT/);
  });

  it("--json carries the verdicts, and --transcript is required", async () => {
    const log = logger();
    await claimsCommand({
      flags: { transcript: "t.jsonl", json: true }, logger: log,
      readTurnFn: turnWith("Quedan 4 cards.", ["list_cards → []"]),
    });
    expect(JSON.parse(log.out())).toMatchObject({ checked: true, denied: [{ value: "4" }] });
    expect(await claimsCommand({ flags: {}, logger: logger() })).toBe(1);
  });
});
