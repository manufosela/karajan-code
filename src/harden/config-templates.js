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

// Self-contained flat config (no plugin deps) banning APIs deprecated under
// an ES2025 target — mirrors the Karajan standard. Seeded only when the
// project has no eslint config of its own.
export const ESLINT_BODY = [
  "export default [",
  "  {",
  '    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],',
  '    languageOptions: { ecmaVersion: 2025, sourceType: "module" },',
  "    rules: {",
  '      "no-var": "error",',
  '      "no-eval": "error",',
  '      "no-new-func": "error",',
  '      "no-restricted-globals": [',
  '        "error",',
  '        { name: "alert", message: "Use the app modal, not alert()." },',
  '        { name: "confirm", message: "Use the app modal, not confirm()." },',
  '        { name: "prompt", message: "Use the app modal, not prompt()." },',
  '        { name: "escape", message: "Use encodeURIComponent()." },',
  '        { name: "unescape", message: "Use decodeURIComponent()." },',
  '        { name: "event", message: "Use the handler parameter, not window.event." },',
  "      ],",
  '      "no-restricted-properties": [',
  '        "error",',
  '        { object: "document", property: "write", message: "Use DOM nodes / Blob URLs, not document.write." },',
  '        { object: "document", property: "writeln", message: "Use DOM nodes, not document.writeln." },',
  '        { property: "substr", message: "Use slice() or substring(), not substr()." },',
  "      ],",
  "    },",
  "  },",
  "];",
].join("\n");

/** JS/TS config files harden manages. `json:true` ⇒ seed-only (no marker). */
export const JS_CONFIGS = [
  { file: ".editorconfig", blockId: "editorconfig", style: "hash", body: EDITORCONFIG_BODY },
  { file: "commitlint.config.js", blockId: "commitlint", style: "slash", body: COMMITLINT_BODY },
  { file: "eslint.config.js", blockId: "eslint", style: "slash", body: ESLINT_BODY },
  { file: ".prettierrc.json", json: true, body: PRETTIER_BODY },
];
