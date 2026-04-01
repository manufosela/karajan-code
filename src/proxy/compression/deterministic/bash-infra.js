/**
 * Deterministic compression for infrastructure CLI output.
 * Handles: docker ps/images/logs, kubectl, terraform plan/apply.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

const INFRA_PATTERNS = [
  /CONTAINER ID/,
  /REPOSITORY\s+TAG/,
  /^NAME\s+READY\s+STATUS/m,
  /^(kubectl|docker|terraform)\s/m,
  /Terraform will perform/,
  /Plan:\s+\d+ to add/,
  /Apply complete/
];

export function looksLike(text) {
  const clean = stripAnsi(text);
  return INFRA_PATTERNS.some((p) => p.test(clean));
}

export function compact(text) {
  const clean = stripAnsi(text);

  // docker ps / docker images — compact table
  if (/CONTAINER ID/.test(clean) || /REPOSITORY\s+TAG/.test(clean)) {
    return compactTable(clean);
  }

  // terraform plan/apply
  if (/Terraform will perform|Plan:\s+\d+|Apply complete/.test(clean)) {
    return compactTerraform(clean);
  }

  // kubectl — compact table
  if (/^NAME\s+READY\s+STATUS/m.test(clean)) {
    return compactTable(clean);
  }

  // docker logs — truncate
  return truncateLines(collapseWhitespace(clean), 30);
}

function compactTable(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length <= 15) return lines.map((l) => collapseWhitespace(l)).join("\n");
  const header = lines[0];
  const rows = lines.slice(1, 11);
  return `${collapseWhitespace(header)}\n${rows.map((r) => collapseWhitespace(r)).join("\n")}\n... (${lines.length - 1} total rows)`;
}

function compactTerraform(text) {
  const lines = text.split("\n");
  const kept = [];
  for (const line of lines) {
    if (
      /Plan:|Apply complete|Terraform will perform|^\s*[#~+-]/.test(line) &&
      !/Refreshing state/.test(line)
    ) {
      kept.push(line.trim());
    }
  }
  return truncateLines(kept.join("\n"), 40) || truncateLines(collapseWhitespace(text), 30);
}
