/**
 * KJC-TSK-0394 step 4: migration helper para plan files existentes.
 * Siembra `result` en las HUs vía inferResultFromLegacyStatus.
 * Idempotente. NO toca `status` (eso será step 5).
 */
import { inferResultFromLegacyStatus } from "./plan-schema.js";

/** Pura. Devuelve {plan: nuevo, changes: [...]}, sin mutar el input. */
export function migratePlanResult(plan) {
  if (!plan || !Array.isArray(plan.hus)) return { plan, changes: [] };
  const changes = [];
  const hus = plan.hus.map((hu) => {
    // Sembrar explícito (incluso null) marca el HU como migrado para
    // pasadas posteriores. hasOwnProperty distingue "no migrado" de
    // "migrado a null".
    const already = Object.prototype.hasOwnProperty.call(hu, "result") && hu.result !== undefined;
    if (already) return hu;
    const inferred = inferResultFromLegacyStatus(hu);
    changes.push({ huId: hu.id, result: inferred });
    return { ...hu, result: inferred };
  });
  if (changes.length === 0) return { plan, changes };
  return { plan: { ...plan, hus, updatedAt: new Date().toISOString() }, changes };
}
