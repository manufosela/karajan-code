import { execa } from "execa";

export async function runCommand(command, args = [], options = {}) {
  try {
    return await execa(command, args, {
      reject: false,
      ...options
    });
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
