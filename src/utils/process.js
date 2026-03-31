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

export async function runCommand(command, args = [], options = {}) {
  const { timeout, onOutput, silenceTimeoutMs, partialOutputFlushMs, ...rest } = options;
  // Always detach stdin: KJ subprocesses never need interactive input.
  // Without this, a subprocess prompting for input (sonar credentials,
  // agent approval, npm prompts) hangs forever since there is no TTY.
  if (!rest.stdin) rest.stdin = "ignore";
  const subprocess = execa(command, args, { reject: false, ...rest });

  let stdoutAccum = "";
  let stderrAccum = "";
  let outputSilenceTimer = null;
  let silenceTimedOut = false;

  function clearSilenceTimer() {
    if (outputSilenceTimer) {
      clearTimeout(outputSilenceTimer);
      outputSilenceTimer = null;
    }
  }

  function armSilenceTimer() {
    const ms = Number(silenceTimeoutMs);
    if (!Number.isFinite(ms) || ms <= 0 || silenceTimedOut) return;
    clearSilenceTimer();
    outputSilenceTimer = setTimeout(() => {
      silenceTimedOut = true;
      try {
        subprocess.kill(KILL_SIGNAL, { forceKillAfterDelay: 1000 });
      } catch {
        // no-op
      }
    }, ms);
  }

  if (subprocess.stdout) {
    subprocess.stdout.on("data", (chunk) => {
      stdoutAccum += chunk.toString();
      armSilenceTimer();
    });
  }
  if (subprocess.stderr) {
    subprocess.stderr.on("data", (chunk) => {
      stderrAccum += chunk.toString();
      armSilenceTimer();
    });
  }

  if (onOutput) {
    setupOutputStreaming(subprocess, onOutput, partialOutputFlushMs);
  }
  armSilenceTimer();

  try {
    const result = timeout
      ? await awaitWithTimeout(subprocess, timeout, () => stdoutAccum)
      : await subprocess;
    clearSilenceTimer();
    if (silenceTimedOut) return buildSilenceKilledResult(silenceTimeoutMs, stdoutAccum);
    return enrichResult(result, stdoutAccum, stderrAccum);
  } catch (error) {
    clearSilenceTimer();
    if (silenceTimedOut) return buildSilenceKilledResult(silenceTimeoutMs, error?.stdout || stdoutAccum, error?.signal);

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
}

function enrichResult(result, stdoutAccum, stderrAccum) {
  if (result.timedOut) return result;

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
