// KJC-TSK-0884 (ADR 0011): el board arranca solo, como Sonar. Sin nada
// declarado, arranca; se apaga solo con un `false` explicito.
import { describe, expect, it } from "vitest";

import { DEFAULTS } from "../../src/config/defaults.js";
import { boardAutoStartWanted } from "../../src/orchestrator/drivers/post-loop.js";

describe("board auto-start", () => {
  it("con nada declarado, arranca", () => {
    expect(boardAutoStartWanted({})).toBe(true);
    expect(boardAutoStartWanted({ hu_board: { port: 4000 } })).toBe(true);
  });

  it("un false explicito lo apaga, en cualquiera de los dos interruptores", () => {
    expect(boardAutoStartWanted({ hu_board: { auto_start: false } })).toBe(false);
    expect(boardAutoStartWanted({ hu_board: { enabled: false } })).toBe(false);
  });

  it("los defaults lo dejan encendido", () => {
    expect(DEFAULTS.hu_board).toMatchObject({ enabled: true, auto_start: true });
  });
});
