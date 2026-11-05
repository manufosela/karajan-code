// KJC-TSK-1428 (decided by the maintainer on 2026-11-05): the atril skills just
// loaded for a role wait here until that role's agent starts, so its start line
// (src/agents/activity.js) carries them and kj stage turns atril's pages. Only
// names, never contents; taken once, so a later start does not repeat them.
const loaded = new Map();
const key = (projectDir, role) => `${projectDir}\u0000${role}`;

export function noteLoaded(projectDir, role, names) {
  if (projectDir && names.length) loaded.set(key(projectDir, role), [...names]);
}

/** The names noted for this project and role, removed as they are taken. */
export function takeLoaded(projectDir, role) {
  const names = loaded.get(key(projectDir, role)) ?? [];
  loaded.delete(key(projectDir, role));
  return names;
}
