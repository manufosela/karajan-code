import { execa } from "execa";

export async function runCommand(command, args = [], options = {}) {
  return execa(command, args, {
    reject: false,
    ...options
  });
}
