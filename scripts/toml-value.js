/**
 * A filesystem path as a TOML value (KJC-BUG-0151, issue #1426 from dfosela).
 *
 * In a double-quoted TOML string `\` opens an escape sequence, so a Windows
 * path like `C:\Users\...` is not valid TOML: `\U` is read as a unicode escape.
 * kj wrote the karajan-mcp block that way and codex then failed to load its
 * ENTIRE config — `codex login` included. kj thought it had configured the MCP;
 * what it had done was break a tool the user had not touched.
 *
 * A literal string (single quotes) interprets nothing, which is exactly what a
 * path needs. Only a path containing a single quote falls back to the basic
 * form, escaped properly — never left broken.
 */
export function tomlPath(value) {
  const s = String(value);
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
