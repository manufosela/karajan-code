#!/usr/bin/env node
import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`kj-trash: ${err?.message ?? err}\n`);
    process.exit(1);
  }
);
