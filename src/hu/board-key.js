/**
 * HU-3386 (epic #3332): what names a shared board on disk (the offline cache, the mirror plan) and
 * in messages. GitHub keeps the file names kj has always used, so caches and queues already on
 * disk keep working; any other manager derives them from its backend name and its team or project.
 */
const slug = (s) => String(s).toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");

export function boardKey(board) {
  const { backend: name } = board;
  if (name === "github") {
    return {
      name, place: board.repo, service: "GitHub", label: `GitHub Issues of ${board.repo}`,
      cacheFile: ".karajan/board-cache.json", planId: "plan-github-board",
      refOf: (r) => `${board.repo}#${r.number}`, describe: (hu) => `issue #${hu.number} of ${board.repo}`,
    };
  }
  const block = board[name] ?? {};
  const place = block.team ?? block.project ?? name;
  const tail = [name, slug(place)].filter(Boolean).join("-");
  const service = name[0].toUpperCase() + name.slice(1);
  return {
    name, place, service, label: `${service} ${place}`,
    cacheFile: `.karajan/board-cache-${tail}.json`, planId: `plan-${tail}-board`,
    refOf: (r) => r.url ?? r.short_id, describe: (hu) => `${hu.short_id} of ${place}`,
  };
}
