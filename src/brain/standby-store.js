// Shim de compatibilidad: standby-store vive ahora en karajan-core.
// Mantiene la ruta para callers internos del CLI.
export {
  standbyDir,
  standbyDoneDir,
  persistStandby,
  buildStandbyState,
  loadStandby,
  listPendingStandby,
  markStandbyDone,
  acquireStandbyLock,
} from "karajan-core/standby-store";
