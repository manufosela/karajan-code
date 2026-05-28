// KJC-TSK-0473 — Pure display helpers for audit history (diff + sparkline).
// No DB / native-module deps; safe to bundle into the SEA binary.

const SPARK_BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function scoreOf(c) {
  if (!c || typeof c !== "object") return null;
  return typeof c.score === "number" ? c.score : typeof c.percent === "number" ? c.percent : null;
}

export function computeHistoryDiff(currentHarness, previousRow) {
  if (!currentHarness || typeof currentHarness.score !== "number") return null;
  if (!previousRow || typeof previousRow.score !== "number") return { previousScore: null, firstRun: true };
  let prevCats = {};
  try { prevCats = previousRow.categories_json ? JSON.parse(previousRow.categories_json) || {} : {}; } catch { /* keep empty */ }
  const currCats = currentHarness.categories || {};
  const categoryDeltas = [];
  for (const name of Object.keys(currCats)) {
    const cur = scoreOf(currCats[name]);
    const prev = scoreOf(prevCats[name]);
    if (typeof cur === "number" && typeof prev === "number") {
      categoryDeltas.push({ name, current: cur, previous: prev, delta: cur - prev });
    }
  }
  const sorted = [...categoryDeltas].sort((a, b) => b.delta - a.delta);
  const t = previousRow.timestamp ? Date.parse(previousRow.timestamp) : NaN;
  const ageDays = Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
  return {
    previousScore: previousRow.score,
    previousGrade: previousRow.grade || null,
    previousTimestamp: previousRow.timestamp,
    delta: currentHarness.score - previousRow.score,
    categoryDeltas,
    biggestImprovement: sorted.find((c) => c.delta > 0) || null,
    biggestRegression: [...sorted].reverse().find((c) => c.delta < 0) || null,
    baselineAgeDays: ageDays,
    baselineStale: ageDays != null && ageDays > 30,
  };
}

export function formatHistoryDiff(diff) {
  if (!diff) return "";
  if (diff.firstRun) return "_First run for this project — no baseline yet._";
  const arrow = diff.delta > 0 ? "↑" : diff.delta < 0 ? "↓" : "=";
  const sign = diff.delta > 0 ? "+" : "";
  const prevDate = (diff.previousTimestamp || "").slice(0, 10);
  const lines = [`**Δ ${sign}${diff.delta} ${arrow} vs run anterior** (${prevDate}, ${diff.previousScore}/100 ${diff.previousGrade || ""})`];
  if (diff.baselineStale) lines.push(`> ⚠ baseline antigua (${diff.baselineAgeDays} días) — considera ejecutar \`kj audit\` con más frecuencia.`);
  if (diff.biggestImprovement) lines.push(`- Mayor mejora: **${diff.biggestImprovement.name}** (+${diff.biggestImprovement.delta})`);
  if (diff.biggestRegression) lines.push(`- Mayor regresión: **${diff.biggestRegression.name}** (${diff.biggestRegression.delta})`);
  return lines.join("\n");
}

export function formatTrendSparkline(scores) {
  const xs = (scores || []).map((r) => (typeof r === "number" ? r : r?.score)).filter((n) => typeof n === "number");
  if (xs.length === 0) return "";
  if (xs.length === 1) return `Score trend: ${xs[0]} (single run)`;
  const min = Math.min(...xs), max = Math.max(...xs), range = max - min || 1;
  const bars = xs.map((n) => SPARK_BARS[Math.min(SPARK_BARS.length - 1, Math.floor(((n - min) / range) * (SPARK_BARS.length - 1)))]).join("");
  return `Score trend (last ${xs.length} runs): ${xs[0]} ${bars} ${xs[xs.length - 1]}`;
}
