// KJC-TSK-0582: `kj advanced` prints every advanced/specialized command,
// grouped by area, with the one-line description commander already holds for
// it. Pure formatter (takes a name→description map) so it's trivially
// testable without spinning up the whole CLI.
import { ADVANCED_GROUPS } from "../cli/advanced-commands.js";

const NAME_PAD = 14;

/**
 * Build the `kj advanced` index text.
 * @param {Record<string,string>|Map<string,string>} descriptions name → one-line description
 */
export function formatAdvancedIndex(descriptions) {
  const lookup = descriptions instanceof Map ? descriptions : new Map(Object.entries(descriptions || {}));
  const firstLine = (text) => String(text || "").split("\n")[0].trim();

  const lines = [
    "Comandos avanzados y especializados (agrupados por área).",
    "Todos siguen siendo invocables directamente: kj <comando>.",
    "",
  ];
  for (const group of ADVANCED_GROUPS) {
    lines.push(`${group.title}:`);
    for (const name of group.commands) {
      lines.push(`  kj ${name.padEnd(NAME_PAD)} ${firstLine(lookup.get(name))}`.trimEnd());
    }
    lines.push("");
  }
  lines.push("Usa 'kj <comando> --help' para los detalles de cualquiera de ellos.");
  return lines.join("\n");
}
