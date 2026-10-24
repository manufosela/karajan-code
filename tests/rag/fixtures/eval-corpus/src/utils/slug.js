// URL slugs from titles: lowercase, ascii, hyphens.

/** "Año Nuevo, 2026!" becomes "ano-nuevo-2026". */
export function slugify(title) {
  return String(title)
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/** Truncate a slug at a word boundary so it never exceeds maxLength. */
export function truncateSlug(slug, maxLength = 60) {
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  return cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut;
}
