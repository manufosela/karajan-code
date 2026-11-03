// KJC-TSK-1400 (ADR 0046): kj stage opens the live 3D stage of the project it
// runs in. The stage is a page of the HU Board, so this is `kj board open` on
// that page: the board starts itself when it is not running, and without a
// browser the URL is printed.
import { boardCommand, boardSlug } from "./board.js";

/** The stage page of a project, keyed by the same slug as its board view. */
export const stagePath = (projectDir) => `/stage.html?project=${encodeURIComponent(boardSlug(projectDir))}`;

export function stageCommand({ projectDir, port, logger, open = boardCommand }) {
  return open({ action: "open", port, logger, path: stagePath(projectDir) });
}
