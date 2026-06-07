import readline from "node:readline";

/**
 * Shared askQuestion factory used by `kj run` and `kj resume`.
 *
 * Pre-fix (KJC-BUG-0081 round 1), `src/commands/run.js` got the guard
 * but `src/commands/resume.js` kept its own copy without the guard, so
 * `kj resume --yes` in non-TTY mode still hung on the HU Board bridge.
 * Centralising the three paths here means both commands honour the
 * same contract and a future fix only needs to land in one place.
 *
 * Three paths:
 *   1. Interactive TTY: prompt via readline (developer terminal).
 *   2. No TTY + `flags.yes`: caller asked NOT to be prompted → write
 *      question + context to stderr, return null so the run aborts
 *      fast and loud (CI / scripted / `kj audit --yes` desatendido).
 *   3. No TTY without `flags.yes` (HU Board ▶ Run plan with
 *      `stdio=ignore`): publish through the file-based bridge so the
 *      board can surface a modal; block until the user answers.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.sessionId]
 * @param {object} [opts.flags]
 * @returns {(question: string, context?: object) => Promise<string|null>}
 */
export function createCliAskQuestion(opts = {}) {
  const { sessionId = null, flags = {} } = opts;
  return async (question, context) => {
    const stdinReadable = process.stdin && process.stdin.readable !== false;
    const isInteractive = Boolean(process.stdin?.isTTY) && stdinReadable;
    if (!isInteractive) {
      if (flags?.yes) {
        process.stderr.write(
          `\n[non-interactive --yes] Pipeline asked a question that cannot be auto-answered:\n`
          + `  ❓ ${question}\n`
          + (context?.detail ? `  Context: ${JSON.stringify(context.detail)}\n` : "")
          + `  Stopping the session. Re-run without --yes (TTY or HU Board) to answer it,\n`
          + `  or pass --skip-spec-review / a more complete spec so the question never appears.\n`
        );
        return null;
      }
      const { askThroughBoard } = await import("./board-prompt-bridge.js");
      console.log(`\n❓ ${question}`);
      if (context?.detail) {
        console.log(`   Context: ${JSON.stringify(context.detail, null, 2)}`);
      }
      console.log(
        "\n[non-interactive] Routing the prompt to the HU Board.\n"
        + "  Open http://localhost:4000 — a modal will appear asking for your answer.\n"
        + "  This process is now waiting; closing the board does NOT cancel the run."
      );
      try {
        return await askThroughBoard({ sessionId, question, context });
      } catch (err) {
        console.log(`\n[prompt-bridge] ${err.message} — stopping the session.`);
        return null;
      }
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      console.log(`\n❓ ${question}`);
      if (context?.detail) {
        console.log(`   Context: ${JSON.stringify(context.detail, null, 2)}`);
      }
      rl.question("\n> Your response (or 'stop' to exit): ", (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() === "stop") {
          resolve(null);
        } else {
          resolve(answer.trim());
        }
      });
    });
  };
}
