import { EventEmitter } from "node:events";

const LEVELS = ["debug", "info", "warn", "error"];

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m"
};

const LEVEL_COLORS = {
  debug: ANSI.gray,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red
};

function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

function formatContext(ctx) {
  const parts = [];
  if (ctx.iteration !== undefined) parts.push(`iter=${ctx.iteration}`);
  if (ctx.stage) parts.push(`stage=${ctx.stage}`);
  return parts.length ? `[${parts.join(" ")}] ` : "";
}

export function createLogger(level = "info", mode = "cli") {
  const min = LEVELS.indexOf(level);
  const minIdx = min === -1 ? 1 : min;
  const emitter = new EventEmitter();
  let context = {};

  function canLog(target) {
    return LEVELS.indexOf(target) >= minIdx;
  }

  function emit(lvl, args) {
    const entry = {
      level: lvl,
      timestamp: new Date().toISOString(),
      context: { ...context },
      message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    };
    emitter.emit("log", entry);
  }

  function log(lvl, ...args) {
    if (!canLog(lvl)) return;
    emit(lvl, args);
    if (mode === "silent") return;
    if (mode === "mcp") return;
    const color = LEVEL_COLORS[lvl] || "";
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    const prefix = `${color}[${lvl}]${ANSI.reset}`;
    const ctx = formatContext(context);
    const stream = lvl === "error" ? console.error : lvl === "warn" ? console.warn : console.log;
    stream(`${ts} ${prefix} ${ctx}${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  }

  return {
    debug: (...args) => log("debug", ...args),
    info: (...args) => log("info", ...args),
    warn: (...args) => log("warn", ...args),
    error: (...args) => log("error", ...args),
    setContext(ctx) {
      context = { ...context, ...ctx };
    },
    resetContext() {
      context = {};
    },
    onLog(callback) {
      emitter.on("log", callback);
    },
    offLog(callback) {
      emitter.off("log", callback);
    },
    get mode() {
      return mode;
    }
  };
}
