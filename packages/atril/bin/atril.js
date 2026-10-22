#!/usr/bin/env node
import { VERSION } from "../src/index.js";

const USAGE = "Usage: atril --version";
const [command] = process.argv.slice(2);

if (command === "--version" || command === "-v") {
  console.log(VERSION);
} else {
  console.error(command ? `atril: unknown command "${command}"\n${USAGE}` : USAGE);
  process.exitCode = 1;
}
