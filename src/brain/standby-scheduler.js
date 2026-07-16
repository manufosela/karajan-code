// Shim de compatibilidad: standby-scheduler vive ahora en karajan-core.
// Mantiene la ruta para callers internos del CLI.
export {
  _resetScheduledForTests,
  scheduleResume,
  cancelScheduled,
  reconcileAll,
} from "karajan-core/standby-scheduler";
