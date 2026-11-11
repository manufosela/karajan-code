import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_ONLY, copyStage } from "../../apps/landing/scripts/copy-stage.mjs";

// KJL-TSK-0158 (ADR 0052): the landing deploys the kj stage scene copied from the
// board, never kept in git. The folder carries a hash so Firebase's immutable cache
// never serves an old scene, and stage.json names it for the factory page.
const board = new URL("../../packages/hu-board/public/", import.meta.url).pathname;
const landingThree = new URL("../../apps/landing/public/lib/three.min.js", import.meta.url).pathname;
const fresh = () => mkdtempSync(join(tmpdir(), "kj-factory-"));
const copiedTo = (to) => join(to, JSON.parse(readFileSync(join(to, "stage.json"), "utf8")).dir);

describe("copyStage", () => {
  it("copies the scene into a hashed folder and names it in stage.json", () => {
    const to = fresh();
    const { dir } = copyStage({ board, to });
    expect(dir).toMatch(/^stage-[0-9a-f]{10}$/);
    expect(copiedTo(to)).toBe(join(to, dir));
    for (const file of ["factory.js", "live.js", "cast/robot.js"]) expect(existsSync(join(to, dir, file)), file).toBe(true);
  });

  it("leaves out the board's own starter and the three bundle the landing already has", () => {
    const to = fresh();
    const { dir } = copyStage({ board, to });
    for (const file of BOARD_ONLY) expect(existsSync(join(to, dir, file)), file).toBe(false);
  });

  it("takes the labels' styles from the board's stage page", () => {
    const to = fresh();
    const { dir } = copyStage({ board, to });
    const style = readFileSync(join(board, "stage.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(readFileSync(join(to, dir, "stage.css"), "utf8")).toBe(style.trim() + "\n");
  });

  it("names the same scene the same way, a changed scene another way, and keeps one copy", () => {
    const to = fresh();
    const first = copyStage({ board, to }).dir;
    expect(copyStage({ board, to }).dir).toBe(first);
    const other = fresh();
    mkdirSync(join(other, "stage"), { recursive: true });
    writeFileSync(join(other, "stage.html"), "<style>a{}</style>");
    writeFileSync(join(other, "stage", "factory.js"), "export {};\n");
    const changed = copyStage({ board: other, to }).dir;
    expect(changed).not.toBe(first);
    expect(readdirSync(to).filter((f) => f.startsWith("stage-"))).toEqual([changed]);
  });

  it("needs nothing from outside but three, the same bundle the landing serves", () => {
    const to = fresh();
    const { dir } = copyStage({ board, to });
    const bare = readdirSync(join(to, dir), { recursive: true }).filter((f) => f.endsWith(".js"))
      .flatMap((f) => [...readFileSync(join(to, dir, f), "utf8").matchAll(/from '([^.][^']*)'/g)].map(([, name]) => name));
    expect(new Set(bare)).toEqual(new Set(["three"]));
    expect(readFileSync(join(board, "stage", "three.min.js"))).toEqual(readFileSync(landingThree));
  });

  it("refuses to run without the board's scene", () => {
    expect(() => copyStage({ board: fresh(), to: fresh() })).toThrow(/stage/);
  });
});
