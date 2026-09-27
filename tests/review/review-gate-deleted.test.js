// KJC-BUG-0229: los gates de Sonar y de RAG exigian lo imposible sobre un
// fichero BORRADO. Un proyecto retiro dos herramientas (45 ficheros borrados) y
// la PR se paro dos veces: "the scan never indexed 45 of them" y "no query
// returned 39 of them". El escaner no indexa lo que no existe y el RAG no
// responde sobre lo que ya no esta en disco. Tres excepciones concedidas por la
// misma causa mecanica; cuando pasa eso, lo que esta mal es la regla.
//
// Un D no es un A ni un M: borrar no introduce deuda, la quita. Los dos
// requisitos se evaluan sobre lo que sigue VIVO tras el cambio.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const pregateMock = vi.fn();
const reviewMock = vi.fn();
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()), runSonarPregate: (...a) => pregateMock(...a),
}));
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));

import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { seedRagLedger } from "./_seed-rag-ledger.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-deleted-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  // Dos herramientas: una que se queda y se toca (a.js), una que se retira (tool/*).
  fs.mkdirSync(path.join(dir, "tool"));
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  fs.writeFileSync(path.join(dir, "tool", "dora.js"), "dora\n");
  fs.writeFileSync(path.join(dir, "tool", "lean.js"), "lean\n");
  git("add", "-A"); git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "a.js"), "y\n");
  git("rm", "-q", "tool/dora.js", "tool/lean.js");
  git("add", "a.js");
  // El RAG y el scan solo pueden hablar de lo que sigue existiendo.
  seedRagLedger(dir, ["a.js"]);
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789", summary: "" });
});

const cfg = () => ({ projectDir: dir });

describe("review gate × ficheros borrados", () => {
  it("un borrado no es una fuente que el scan tenga que indexar ni el RAG responder", async () => {
    // El pre-gate solo pudo cubrir lo vivo, como en la realidad.
    pregateMock.mockResolvedValue({ available: true, projectKey: "k", blocking: [], advisory: [], totalProject: 0, covered: ["a.js"], uncovered: [] });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r.verdict).toBe("approved");
    expect(reviewMock).toHaveBeenCalled();
    // Y al pre-gate no se le pide que cubra lo que ya no existe.
    const asked = pregateMock.mock.calls[0][0].stagedFiles;
    expect(asked).toEqual(["a.js"]);
  });

  it("lo que sigue vivo se sigue exigiendo: el borrado no abre la mano al resto", async () => {
    pregateMock.mockResolvedValue({ available: true, projectKey: "k", blocking: [], advisory: [], totalProject: 0, covered: [], uncovered: ["a.js"] });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r.verdict).toBe("rejected");
    expect(r.reviewer).toBe("sonar");
    expect(r.issues[0].description).toContain("a.js");
    expect(r.issues[0].description).not.toContain("dora.js");
  });
});
