// KJC-TSK-1400 (ADR 0046): kj stage opens the live 3D stage of the project it
// runs in. The stage is a page of the HU Board, so this is `kj board open` on
// that page: the board starts itself when it is not running, and without a
// browser the URL is printed. It keeps the board's own safeguards: no parallel
// board beside an external one, and no board the config disables unless forced.
import { boardCommand, boardRefusal, boardSlug } from "./board.js";

/** The stage page of a project, keyed by the same slug as its board view. */
export const stagePath = (projectDir) => `/stage.html?project=${encodeURIComponent(boardSlug(projectDir))}`;

export async function stageCommand({ projectDir, port, logger, config, force = false, open = boardCommand }) {
  const refusal = boardRefusal(config, { action: "open", starts: true, force, retry: "kj stage --force" });
  if (refusal) return { ok: false, refusal };
  return open({ action: "open", port, logger, path: stagePath(projectDir) });
}
