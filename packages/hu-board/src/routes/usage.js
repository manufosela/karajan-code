// HU-4632 (ADR 0064): GET /api/usage, kj's local usage record (~/.karajan/usage/YYYY-MM.jsonl,
// written by kj's src/usage/record.js) summed per period, project and account for the usage page.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "karajan-core/paths";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIODS = { day: (ts) => ts.slice(0, 10), month: (ts) => ts.slice(0, 7), year: (ts) => ts.slice(0, 4), total: () => "total" };
const SUMS = ["tokensIn", "tokensOut", "cachedTokens", "costUsd", "durationMs", "linesAdded", "linesRemoved"];
const MAX_MONTHS = 120;

const monthIndex = (month) => {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m - 1;
};
const monthOf = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/** The months from `from` to `to`, both YYYY-MM, in order. */
function monthsBetween(from, to) {
  const months = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) months.push(monthOf(i));
  return months;
}

/** The calls of one month; none when the month has no file. A line that is not JSON throws, naming it. */
function readMonth(home, month) {
  const file = path.join(home, "usage", `${month}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      throw new Error(`usage: ${file} line ${i + 1} is not JSON`);
    }
  });
}

// A total stays null while no call of the group reported the figure.
const add = (total, value) => (typeof value === "number" ? (total ?? 0) + value : total);

/** Rows {period, project, account, calls, ...sums}, sorted by period, project and account. */
export function aggregateUsage(calls, { period, project = null }) {
  const groups = new Map();
  for (const c of calls.filter((x) => !project || x.project === project)) {
    const bucket = PERIODS[period](c.ts);
    const key = [bucket, c.project, c.account].join("\0");
    const row = groups.get(key) ?? { period: bucket, project: c.project, account: c.account, calls: 0, ...Object.fromEntries(SUMS.map((s) => [s, null])) };
    row.calls += 1;
    for (const s of SUMS) row[s] = add(row[s], c[s]);
    groups.set(key, row);
  }
  return [...groups.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

function badRequest({ period, from, to }) {
  if (!Object.hasOwn(PERIODS, period ?? "")) return `period must be one of ${Object.keys(PERIODS).join(", ")}`;
  if (!MONTH.test(from ?? "") || !MONTH.test(to ?? "")) return "from and to must be YYYY-MM months";
  if (from > to) return "from must not be after to";
  if (monthIndex(to) - monthIndex(from) >= MAX_MONTHS) return `at most ${MAX_MONTHS} months at once`;
  return null;
}

// HU-4634: the export's columns, in the order of kj's usage record.
const CSV_COLUMNS = ["ts", "project", "account", "provider", "role", "model", "exitCode", "durationMs", ...SUMS.slice(0, 4), "rescue", ...SUMS.slice(5)];

/** One CSV cell: empty for null, a text a spreadsheet would run as a formula kept as text, quoted when needed. */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function usageCsv(calls) {
  const rows = [CSV_COLUMNS, ...calls.map((c) => CSV_COLUMNS.map((col) => c[col]))];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const router = Router();

router.get("/export", (req, res) => {
  const { project, month } = req.query;
  if (typeof project !== "string" || !project) return res.status(400).json({ ok: false, error: "project is required" });
  if (!MONTH.test(month ?? "")) return res.status(400).json({ ok: false, error: "month must be a YYYY-MM month" });
  try {
    const calls = readMonth(getKarajanHome(), month).filter((c) => c.project === project);
    const name = path.basename(project).replaceAll(/[^\w.-]/g, "_");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="usage-${name}-${month}.csv"`);
    res.send(usageCsv(calls));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/", (req, res) => {
  const { period, from, to, project } = req.query;
  const error = badRequest({ period, from, to });
  if (error) return res.status(400).json({ ok: false, error });
  try {
    const home = getKarajanHome();
    const calls = monthsBetween(from, to).flatMap((month) => readMonth(home, month));
    const projects = [...new Set(calls.map((c) => c.project))].toSorted();
    res.json({ ok: true, period, from, to, projects, rows: aggregateUsage(calls, { period, project: project || null }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
