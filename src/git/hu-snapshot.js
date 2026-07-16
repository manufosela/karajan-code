// Shim de compatibilidad: hu-snapshot vive ahora en karajan-core.
// Mantenemos esta ruta para que callers internos del CLI (orchestrator,
// runners) sigan funcionando sin tocar imports.
export {
  snapshotRefForHu,
  createHuSnapshot,
  hasHuSnapshot,
  restoreHuSnapshot,
  removeHuSnapshot,
} from "karajan-core/hu-snapshot";
