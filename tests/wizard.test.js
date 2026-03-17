import { describe, expect, it, vi } from "vitest";
import { Readable, Writable } from "node:stream";
import readline from "node:readline";
import { createWizard, isTTY } from "../src/utils/wizard.js";

function makeInput(answers) {
  const data = answers.join("\n") + "\n";
  return Readable.from([data]);
}

function makeOutput() {
  const chunks = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    }
  });
  writable.getOutput = () => chunks.join("");
  return writable;
}

describe("wizard", () => {
  it("ask returns user input trimmed", async () => {
    const input = makeInput(["  hello world  "]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const answer = await wizard.ask("What? ");
    expect(answer).toBe("hello world");
    wizard.close();
  });

  it("confirm returns true for 'y'", async () => {
    const input = makeInput(["y"]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const result = await wizard.confirm("Proceed?");
    expect(result).toBe(true);
    wizard.close();
  });

  it("confirm returns false for 'n'", async () => {
    const input = makeInput(["n"]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const result = await wizard.confirm("Proceed?");
    expect(result).toBe(false);
    wizard.close();
  });

  it("confirm uses default value on empty input", async () => {
    const input = makeInput([""]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const result = await wizard.confirm("Proceed?", false);
    expect(result).toBe(false);
    wizard.close();
  });

  it("select returns chosen option value", async () => {
    const input = makeInput(["2"]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const options = [
      { label: "Option A", value: "a", available: true },
      { label: "Option B", value: "b", available: true }
    ];
    const result = await wizard.select("Pick:", options);
    expect(result).toBe("b");

    const text = output.getOutput();
    expect(text).toContain("Option A");
    expect(text).toContain("Option B");
    wizard.close();
  });

  it("select shows (not installed) for unavailable options", async () => {
    const input = makeInput(["1"]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const options = [
      { label: "claude", value: "claude", available: true },
      { label: "gemini", value: "gemini", available: false }
    ];
    await wizard.select("Pick:", options);

    const text = output.getOutput();
    expect(text).toContain("gemini (not installed)");
    expect(text).not.toContain("claude (not installed)");
    wizard.close();
  });

  it("createInterface is called with terminal: false to prevent double-echo on TTY", () => {
    const spy = vi.spyOn(readline, "createInterface");
    const input = makeInput([""]);
    const output = makeOutput();
    createWizard(input, output);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: false })
    );
    spy.mockRestore();
  });

  it("select defaults to first option on invalid input", async () => {
    const input = makeInput(["99"]);
    const output = makeOutput();
    const wizard = createWizard(input, output);

    const options = [
      { label: "A", value: "first", available: true },
      { label: "B", value: "second", available: true }
    ];
    const result = await wizard.select("Pick:", options);
    expect(result).toBe("first");
    wizard.close();
  });
});

describe("isTTY", () => {
  it("returns a boolean", () => {
    const result = isTTY();
    expect(typeof result).toBe("boolean");
  });
});
