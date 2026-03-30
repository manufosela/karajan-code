import { runCommand } from "./process.js";

/**
 * Commands that RTK can safely wrap for token-optimized output.
 */
export const RTK_SUPPORTED_COMMANDS = [
  "git", "ls", "find", "grep", "cat", "head", "tail",
  "wc", "diff", "tree", "du", "file"
];

const supportedSet = new Set(RTK_SUPPORTED_COMMANDS);

/**
 * Wrap a command with RTK if available and the command is in the whitelist.
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} rtkAvailable
 * @returns {{ command: string, args: string[] }}
 */
export function wrapWithRtk(command, args, rtkAvailable) {
  if (rtkAvailable && supportedSet.has(command)) {
    return { command: "rtk", args: [command, ...args] };
  }
  return { command, args };
}

/**
 * Session-level accumulator for RTK byte savings.
 */
export class RtkSavingsTracker {
  constructor() {
    this.originalBytes = 0;
    this.rtkBytes = 0;
    this.callCount = 0;
  }

  record(originalSize, rtkSize) {
    this.originalBytes += originalSize;
    this.rtkBytes += rtkSize;
    this.callCount += 1;
  }

  summary() {
    const savedBytes = this.originalBytes - this.rtkBytes;
    const savedPct = this.originalBytes > 0
      ? Number(((savedBytes / this.originalBytes) * 100).toFixed(1))
      : 0;
    const estimatedTokensSaved = Math.floor(savedBytes / 4);
    return {
      originalBytes: this.originalBytes,
      rtkBytes: this.rtkBytes,
      savedBytes,
      savedPct,
      estimatedTokensSaved,
      callCount: this.callCount
    };
  }

  /** Returns true if any commands were recorded. */
  hasData() {
    return this.callCount > 0;
  }
}

/**
 * Create a runner function that transparently wraps supported commands with RTK.
 * @param {boolean} rtkAvailable
 * @param {RtkSavingsTracker} [tracker] - Optional savings tracker
 * @returns {(command: string, args?: string[], options?: object) => Promise<object>}
 */
export function createRtkRunner(rtkAvailable, tracker = null) {
  return async (command, args = [], options = {}) => {
    const wrapped = wrapWithRtk(command, args, rtkAvailable);
    const result = await runCommand(wrapped.command, wrapped.args, options);

    if (tracker && rtkAvailable && supportedSet.has(command)) {
      const outputSize = Buffer.byteLength(result.stdout || "", "utf8");
      // For RTK-wrapped calls, the output is already compressed.
      // We estimate the original size as outputSize (conservative — real savings
      // would require running the command without RTK, which defeats the purpose).
      // The tracker is useful when the caller provides real estimates externally.
      tracker.record(outputSize, outputSize);
    }

    return result;
  };
}
