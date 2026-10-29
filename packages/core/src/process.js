import { execa } from "execa";

const isWin = process.platform === "win32";
const KILL_SIGNAL = isWin ? "SIGTERM" : "SIGKILL";

function buildSilenceKilledResult(silenceTimeoutMs, stdout, signal) {
  return {
    exitCode: 143,
    stdout,
    stderr: `Command killed after ${Number(silenceTimeoutMs)}ms without output`,
    timedOut: true,
    signal: signal || KILL_SIGNAL
  };
}

function setupOutputStreaming(subprocess, onOutput, partialOutputFlushMs) {
  const flushMs = Number(partialOutputFlushMs) > 0 ? Number(partialOutputFlushMs) : 2000;
  const streams = {};
  const makeHandler = (stream) => {
    const state = { partial: "", dirty: false };
    streams[stream] = state;
    return (chunk) => {
      state.partial += chunk.toString();
      const lines = state.partial.split(/\r\n|\n|\r/);
      state.partial = lines.pop() ?? "";
      state.dirty = state.partial.length > 0;
      for (const line of lines) {
        if (line) onOutput({ stream, line });
      }
    };
  };

  const flushPartials = () => {
    for (const [stream, state] of Object.entries(streams)) {
      if (!state.dirty || !state.partial) continue;
      onOutput({ stream, line: state.partial });
      state.partial = "";
      state.dirty = false;
    }
  };

  if (subprocess.stdout) subprocess.stdout.on("data", makeHandler("stdout"));
  if (subprocess.stderr) subprocess.stderr.on("data", makeHandler("stderr"));
  const flushInterval = setInterval(flushPartials, flushMs);
  flushInterval.unref?.();

  subprocess.finally(() => {
    flushPartials();
    clearInterval(flushInterval);
  });
}

async function awaitWithTimeout(subprocess, timeout, getStdout) {
  let timer = null;
  const timeoutResult = new Promise((resolve) => {
    timer = setTimeout(() => {
      try {
        subprocess.kill(KILL_SIGNAL, { forceKillAfterDelay: 1000 });
      } catch {
        // no-op
      }
      resolve({
        exitCode: 143,
        stdout: getStdout(),
        stderr: `Command timed out after ${timeout}ms`,
        timedOut: true,
        signal: KILL_SIGNAL
      });
    }, timeout);
  });

  const result = await Promise.race([subprocess, timeoutResult]);
  if (timer) clearTimeout(timer);
  return result;
}

/**
 * KJC-TSK-1274: kills the subprocess after `silenceTimeoutMs` with no output; every chunk re-arms it.
 * A non-positive or non-numeric value turns it off.
 */
function silenceWatchdog(subprocess, silenceTimeoutMs) {
  let timer = null;
  let timedOut = false;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const arm = () => {
    const ms = Number(silenceTimeoutMs);
    if (!Number.isFinite(ms) || ms <= 0 || timedOut) return;
    clear();
    timer = setTimeout(() => {
      timedOut = true;
      try {
        subprocess.kill(KILL_SIGNAL, { forceKillAfterDelay: 1000 });
      } catch {
        // no-op
      }
    }, ms);
  };
  return { arm, clear, timedOut: () => timedOut };
}

/** What a thrown run reports: exit 1 with every detail execa gave, never an empty message. */
function thrownResult(error, stdoutAccum) {
  const details = [error?.shortMessage, error?.originalMessage, error?.stderr, error?.stdout, error?.message]
    .filter(Boolean)
    .join("\n");
  return {
    exitCode: 1,
    stdout: error?.stdout || stdoutAccum,
    stderr: details || String(error),
    signal: error?.signal || null
  };
}

export async function runCommand(command, args = [], options = {}) {
  const { timeout, onOutput, silenceTimeoutMs, partialOutputFlushMs, ...rest } = options;
  // Detach stdin unless the caller provides input (e.g. Codex uses input: prompt).
  // Without this, a subprocess prompting for input hangs forever since there is no TTY.
  if (!rest.stdin && !rest.input) rest.stdin = "ignore";
  const subprocess = execa(command, args, { reject: false, ...rest });

  let stdoutAccum = "";
  let stderrAccum = "";
  const watchdog = silenceWatchdog(subprocess, silenceTimeoutMs);
  subprocess.stdout?.on("data", (chunk) => {
    stdoutAccum += chunk.toString();
    watchdog.arm();
  });
  subprocess.stderr?.on("data", (chunk) => {
    stderrAccum += chunk.toString();
    watchdog.arm();
  });
  if (onOutput) setupOutputStreaming(subprocess, onOutput, partialOutputFlushMs);
  watchdog.arm();

  try {
    const result = timeout
      ? await awaitWithTimeout(subprocess, timeout, () => stdoutAccum)
      : await subprocess;
    watchdog.clear();
    if (watchdog.timedOut()) return buildSilenceKilledResult(silenceTimeoutMs, stdoutAccum);
    return enrichResult(result, stdoutAccum, stderrAccum);
  } catch (error) {
    watchdog.clear();
    if (watchdog.timedOut()) return buildSilenceKilledResult(silenceTimeoutMs, error?.stdout || stdoutAccum, error?.signal);
    return thrownResult(error, stdoutAccum);
  }
}

/**
 * execa with reject:false RESOLVES (does not throw) on a spawn
 * failure — ENOENT (binary not in PATH), EACCES, etc. The result
 * then carries exitCode null/undefined, an empty stderr, and the
 * real cause only in `code` / `shortMessage`. Surface it: a missing
 * agent CLI used to fail with a completely empty error message,
 * leaving the user with "coder failed" and no idea what to install.
 */
function spawnFailedResult(result, stdoutAccum) {
  const code = result.code ? ` (${result.code})` : "";
  const reason = result.shortMessage || result.message || `spawn failed${code}`;
  return {
    ...result,
    exitCode: 1,
    stdout: result.stdout || stdoutAccum,
    stderr: result.stderr || reason,
    spawnError: result.code || true,
  };
}

function enrichResult(result, stdoutAccum, _stderrAccum) {
  if (result.timedOut) return result;
  if (result.failed && result.exitCode == null && !result.signal) return spawnFailedResult(result, stdoutAccum);

  const killed = result.killed || !!result.signal;
  const signal = result.signal || null;

  if (killed && !result.stderr) {
    return {
      ...result,
      stdout: result.stdout || stdoutAccum,
      stderr: signal
        ? `Process killed by signal ${signal}`
        : "Process was killed externally",
      signal
    };
  }

  return result;
}
