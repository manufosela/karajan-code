import { execa } from "execa";

export async function runCommand(command, args = [], options = {}) {
  const { timeout, onOutput, ...rest } = options;
  const subprocess = execa(command, args, {
    reject: false,
    ...rest
  });

  if (onOutput) {
    const handler = (stream) => {
      let partial = "";
      return (chunk) => {
        partial += chunk.toString();
        const lines = partial.split("\n");
        partial = lines.pop();
        for (const line of lines) {
          if (line) onOutput({ stream, line });
        }
      };
    };
    if (subprocess.stdout) subprocess.stdout.on("data", handler("stdout"));
    if (subprocess.stderr) subprocess.stderr.on("data", handler("stderr"));
  }

  try {
    if (!timeout) {
      return await subprocess;
    }

    let timer = null;
    const timeoutResult = new Promise((resolve) => {
      timer = setTimeout(() => {
        try {
          subprocess.kill("SIGKILL", { forceKillAfterDelay: 1000 });
        } catch {
          // no-op
        }
        resolve({
          exitCode: 143,
          stdout: "",
          stderr: `Command timed out after ${timeout}ms`
        });
      }, timeout);
    });

    const result = await Promise.race([subprocess, timeoutResult]);
    if (timer) clearTimeout(timer);
    return result;
  } catch (error) {
    const details = [
      error?.shortMessage,
      error?.originalMessage,
      error?.stderr,
      error?.stdout,
      error?.message
    ]
      .filter(Boolean)
      .join("\n");

    return {
      exitCode: 1,
      stdout: error?.stdout || "",
      stderr: details || String(error)
    };
  }
}
