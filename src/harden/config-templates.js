/**
 * Config-file templates for `kj harden` (KJC-TSK-0556).
 *
 * Each entry is seeded only when absent (project rule: never overwrite an
 * existing file); on re-run a kj:managed block is refreshed in place. JSON
 * formats carry no comment syntax, so they are seed-only (no marker).
 *
 * The eslint ES2025 deprecated-API blacklist lands in a follow-up slice.
 */

export const EDITORCONFIG_BODY = [
  "root = true",
  "",
  "[*]",
  "charset = utf-8",
  "end_of_line = lf",
  "insert_final_newline = true",
  "trim_trailing_whitespace = true",
  "indent_style = space",
  "indent_size = 2",
].join("\n");

export const PRETTIER_BODY = JSON.stringify(
  { printWidth: 110, singleQuote: false, trailingComma: "es5", semi: true },
  null,
  2
);

export const COMMITLINT_BODY = [
  "// Conventional Commits — header <=100 chars, lowercase subject.",
  "export default {",
  '  extends: ["@commitlint/config-conventional"],',
  "  rules: {",
  '    "header-max-length": [2, "always", 100],',
  '    "subject-case": [2, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]],',
  "  },",
  "};",
].join("\n");

/** JS/TS config files harden manages. `json:true` ⇒ seed-only (no marker). */
export const JS_CONFIGS = [
  { file: ".editorconfig", blockId: "editorconfig", style: "hash", body: EDITORCONFIG_BODY },
  { file: "commitlint.config.js", blockId: "commitlint", style: "slash", body: COMMITLINT_BODY },
  { file: ".prettierrc.json", json: true, body: PRETTIER_BODY },
];
