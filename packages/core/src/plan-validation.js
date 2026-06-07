// KJC-TSK-0401: validación estructural de cambios en blocked_by desde
// el board. Se usa antes de persistir un PATCH /api/stories/:id para
// que el usuario no pueda crear ciclos ni referencias huérfanas. La UI
// preview la usa para deshabilitar las opciones que romperían el plan.

/**
 * Verifica que `newBlockedBy` para `huId` no rompa la estructura del plan.
 *
 * Reglas:
 *   1. Cada ref en newBlockedBy debe existir como hu.id en el plan.
 *   2. No se permite auto-dependencia (huId ∈ newBlockedBy).
 *   3. Aplicar el cambio NO debe crear un ciclo en el grafo blocked_by.
 *
 * @param {object} plan
 * @param {string} huId
 * @param {string[]} newBlockedBy
 * @returns {{ ok: true } | { ok: false, error: string, cycle?: string[] }}
 */
export function validateBlockedByChange(plan, huId, newBlockedBy) {
  if (!plan || !Array.isArray(plan.hus)) {
    return { ok: false, error: "plan inválido" };
  }
  const hu = plan.hus.find((h) => h.id === huId);
  if (!hu) return { ok: false, error: `HU no encontrada: ${huId}` };
  if (!Array.isArray(newBlockedBy)) {
    return { ok: false, error: "blocked_by debe ser un array" };
  }
  const ids = new Set(plan.hus.map((h) => h.id));
  for (const ref of newBlockedBy) {
    if (typeof ref !== "string") {
      return { ok: false, error: "blocked_by contiene un valor no-string" };
    }
    if (ref === huId) {
      return { ok: false, error: `auto-dependencia no permitida: ${huId}` };
    }
    if (!ids.has(ref)) {
      return { ok: false, error: `HU referenciada inexistente: ${ref}` };
    }
  }
  // Simular el cambio sobre una copia del grafo y buscar ciclos.
  const graph = new Map();
  for (const h of plan.hus) {
    graph.set(h.id, h.id === huId ? [...newBlockedBy] : (Array.isArray(h.blocked_by) ? [...h.blocked_by] : []));
  }
  const cycle = findCycleContaining(graph, huId);
  if (cycle) {
    return { ok: false, error: `Ciclo detectado: ${cycle.join(" → ")} → ${cycle[0]}`, cycle };
  }
  return { ok: true };
}

/**
 * DFS desde `start` siguiendo aristas blocked_by. Devuelve el primer
 * ciclo encontrado que pase por `start`, o null. La búsqueda no es
 * exhaustiva — basta con detectar UN ciclo para rechazar el cambio.
 *
 * @param {Map<string,string[]>} graph
 * @param {string} start
 * @returns {string[]|null}
 */
function findCycleContaining(graph, start) {
  const onStack = new Set();
  const visited = new Set();
  const stack = [];
  function dfs(node) {
    if (onStack.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) return stack.slice(idx);
      return [node];
    }
    if (visited.has(node)) return null;
    onStack.add(node); stack.push(node); visited.add(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      const found = dfs(dep);
      if (found) return found;
    }
    stack.pop(); onStack.delete(node);
    return null;
  }
  return dfs(start);
}
