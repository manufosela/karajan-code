/**
 * Task manager check (HU-3337, epic #3332, ADR 0029): says what the project's chosen task manager can
 * and cannot see or manage, where to see the rest (the HU Board), and names a credential it needs
 * that is unset. Names of variables only: no value is read into the report.
 */
import { readBoardConfig } from "../hu/board-config.js";
import { loadManager } from "../hu/managers/index.js";
import { describeCapabilities, missingCredentials } from "../hu/story-contract.js";
import { STRATEGY } from "./types.js";

export function createTaskManagerCheck({
  projectDir = process.cwd(),
  boardConfig = readBoardConfig,
  env = process.env,
  makeManager = (board) => loadManager(board, { env, projectDir }),
} = {}) {
  return {
    name: "task-manager",
    label: "task manager",
    strategy: STRATEGY.NONE,
    async detect() {
      const board = await boardConfig(projectDir);
      if (board.backend === "local") return { ok: true, severity: "info", detail: "the local HU Board: it sees and manages everything" };
      const manager = await makeManager(board);
      const { can, cannot } = describeCapabilities(manager);
      const missing = cannot.map((item) => `${item} (see it in the HU Board: kj board start)`);
      const detail = `${board.backend === "github" ? `GitHub Issues of ${board.repo}` : board.backend} — can: ${can.join("; ")}${missing.length ? `; cannot: ${missing.join("; ")}` : ""}`;
      const unset = missingCredentials(manager, env);
      if (unset.length === 0) return { ok: true, severity: "info", detail };
      return { ok: false, severity: "warn", detail: `${unset.join(", ")} ${unset.length === 1 ? "is" : "are"} not set; ${detail}`, fix: `Set ${unset.join(", ")} in the environment` };
    },
  };
}

export const getTaskManagerChecks = ({ projectDir } = {}) => [createTaskManagerCheck({ projectDir })];
