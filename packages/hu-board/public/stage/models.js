// KJC-TSK-1536 (decided by the maintainer on 2026-11-11): what kj stage says of the model an
// agent runs on: its family (which dresses its robot) and a short name for the status list.

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

/** The model family of an id such as "claude-opus-5-5", or null for one it does not dress. */
export const familyOf = (model) => FAMILIES.find((f) => String(model ?? '').toLowerCase().includes(f)) ?? null;

/** A short name: "claude-opus-5-5" → "Opus 5.5"; any other id as it is. */
export function modelLabel(model) {
  const family = familyOf(model);
  if (!family) return model ?? null;
  const version = String(model).toLowerCase().split(family)[1]?.match(/\d+(?:[-.]\d+)*/)?.[0]?.replaceAll('-', '.');
  const name = family[0].toUpperCase() + family.slice(1);
  return version ? `${name} ${version}` : name;
}

/** "(Opus 5.5, high)", "(gpt-5)" or "" for the status list. */
export function launchedLabel({ model, effort }) {
  const parts = [modelLabel(model), effort].filter(Boolean);
  return parts.length ? `(${parts.join(', ')})` : '';
}
