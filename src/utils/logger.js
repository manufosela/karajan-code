export function createLogger(level = "info") {
  const levels = ["debug", "info", "warn", "error"];
  const min = levels.indexOf(level);

  function canLog(target) {
    return levels.indexOf(target) >= (min === -1 ? 1 : min);
  }

  return {
    debug: (...args) => canLog("debug") && console.debug("[debug]", ...args),
    info: (...args) => canLog("info") && console.info("[info]", ...args),
    warn: (...args) => canLog("warn") && console.warn("[warn]", ...args),
    error: (...args) => canLog("error") && console.error("[error]", ...args)
  };
}
