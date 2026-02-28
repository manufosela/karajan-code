import readline from "node:readline";

export function createWizard(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });

  function ask(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  }

  async function confirm(question, defaultValue = true) {
    const hint = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = await ask(`${question} ${hint} `);
    if (answer === "") return defaultValue;
    return /^y(es)?$/i.test(answer);
  }

  async function select(question, options) {
    output.write(`${question}\n`);
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const label = opt.available === false ? `${opt.label} (not installed)` : opt.label;
      output.write(`  ${i + 1}) ${label}\n`);
    }
    const answer = await ask(`Choose [1-${options.length}]: `);
    const idx = Number(answer) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    return options[0].value;
  }

  function close() {
    rl.close();
  }

  return { ask, confirm, select, close };
}

export function isTTY() {
  return Boolean(process.stdin.isTTY);
}
