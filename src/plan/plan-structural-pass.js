// KJC-TSK-0399: deterministic post-review pass — cycles, orphan refs,
// missing short_id. No LLM. Fix shape: { kind, huId?, ...details };
// stored in plan.review.structural_fixes.

export function runStructuralPass(plan) {
  const fixes = [];
  if (!plan || !Array.isArray(plan.hus) || plan.hus.length === 0) {
    return { fixes, modified: false };
  }
  fixes.push(...removeOrphanRefs(plan));
  fixes.push(...breakCycles(plan));
  fixes.push(...assignMissingShortIds(plan));
  const modified = fixes.length > 0;
  if (modified) plan.updatedAt = new Date().toISOString();
  return { fixes, modified };
}

export function removeOrphanRefs(plan) {
  const fixes = [];
  const known = new Set(plan.hus.map((h) => h.id));
  for (const hu of plan.hus) {
    const removed = [];
    if (Array.isArray(hu.blocked_by) && hu.blocked_by.length > 0) {
      hu.blocked_by = hu.blocked_by.filter((d) => {
        if (known.has(d)) return true;
        removed.push(d); return false;
      });
    }
    if (removed.length > 0) fixes.push({ kind: "orphan_ref_removed", huId: hu.id, removed });
  }
  return fixes;
}

function breakCycles(plan) {
  const fixes = [];
  let cycles = findCycles(plan.hus);
  let budget = plan.hus.length;
  while (cycles.length > 0 && budget-- > 0) {
    const cycle = cycles[0];
    const dropped = breakCycle(plan, cycle);
    if (!dropped) break;
    fixes.push({ kind: "cycle_break", cycle: [...cycle], droppedEdge: dropped });
    cycles = findCycles(plan.hus);
  }
  return fixes;
}

export function findCycles(hus) {
  const graph = new Map();
  for (const hu of hus) graph.set(hu.id, Array.isArray(hu.blocked_by) ? hu.blocked_by : []);
  const cycles = [];
  const seen = new Set();
  const onStack = new Set();
  const stack = [];
  function dfs(node) {
    onStack.add(node); stack.push(node); seen.add(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (onStack.has(dep)) {
        const idx = stack.indexOf(dep);
        if (idx >= 0) {
          const cycle = stack.slice(idx);
          if (!cycles.some((c) => sameCycle(c, cycle))) cycles.push(cycle);
        }
      } else if (!seen.has(dep)) dfs(dep);
    }
    stack.pop(); onStack.delete(node);
  }
  for (const id of graph.keys()) if (!seen.has(id)) dfs(id);
  return cycles;
}

function sameCycle(a, b) {
  if (a.length !== b.length) return false;
  return [...a].sort().join("|") === [...b].sort().join("|");
}

// Heurística: dropea arista cuyo origen tiene menos incoming. Tiebreak edge.to.
export function breakCycle(plan, cycle) {
  const incoming = new Map();
  for (const hu of plan.hus) {
    for (const dep of hu.blocked_by || []) incoming.set(dep, (incoming.get(dep) || 0) + 1);
  }
  const edges = [];
  for (let i = 0; i < cycle.length; i++) {
    const from = cycle[i];
    const to = cycle[(i + 1) % cycle.length];
    const hu = plan.hus.find((h) => h.id === from);
    if (hu && Array.isArray(hu.blocked_by) && hu.blocked_by.includes(to)) edges.push({ from, to });
  }
  if (edges.length === 0) return null;
  edges.sort((a, b) => {
    const d = (incoming.get(a.from) || 0) - (incoming.get(b.from) || 0);
    return d !== 0 ? d : a.to.localeCompare(b.to);
  });
  const drop = edges[0];
  const hu = plan.hus.find((h) => h.id === drop.from);
  hu.blocked_by = hu.blocked_by.filter((d) => d !== drop.to);
  return drop;
}

export function assignMissingShortIds(plan) {
  const fixes = [];
  const used = new Set();
  let maxAuto = 0;
  for (const hu of plan.hus) {
    if (!hu.short_id) continue;
    used.add(hu.short_id);
    const m = String(hu.short_id).match(/^AUTOFIX-(\d+)$/);
    if (m) maxAuto = Math.max(maxAuto, Number(m[1]));
  }
  for (const hu of plan.hus) {
    if (hu.short_id) continue;
    maxAuto += 1;
    const candidate = `AUTOFIX-${String(maxAuto).padStart(3, "0")}`;
    if (used.has(candidate)) continue;
    hu.short_id = candidate;
    used.add(candidate);
    fixes.push({ kind: "short_id_assigned", huId: hu.id, assigned: candidate });
  }
  return fixes;
}
