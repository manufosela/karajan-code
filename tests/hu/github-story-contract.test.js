// HU-3333/HU-3335: the GitHub Issues manager against the shared story contract;
// gh is a fake that keeps issues in memory.
import { expect, it } from "vitest";
import { createGithubManager } from "../../src/hu/managers/github/index.js";
import { runStoryContract } from "./story-contract-suite.js";

const REPO = "acme/app";
const out = (stdout = "") => ({ exitCode: 0, stdout });

function fakeGh() {
  const issues = new Map();
  const flag = (args, name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const state = { rejectMoves: false };
  const view = (n, fields) => {
    const i = issues.get(n);
    const all = { number: n, title: i.title, body: i.body, state: i.state, labels: [...i.labels].map((name) => ({ name })), assignees: i.assignees.map((login) => ({ login })) };
    return Object.fromEntries(fields.split(",").map((f) => [f, all[f]]));
  };
  const handlers = {
    "label list": () => out("[]"),
    "label create": () => out(),
    "issue create": (args) => {
      const n = issues.size + 1;
      issues.set(n, { title: flag(args, "--title")[0], body: flag(args, "--body")[0], state: "OPEN", labels: new Set(flag(args, "--label")), assignees: [] });
      return out(`https://github.com/${REPO}/issues/${n}\n`);
    },
    "issue view": (args) => out(JSON.stringify(view(Number(args[2]), flag(args, "--json")[0]))),
    "issue list": (args) => out(JSON.stringify([...issues.keys()].map((n) => view(n, flag(args, "--json")[0])))),
    "issue edit": (args) => {
      const i = issues.get(Number(args[2]));
      if (!state.rejectMoves) {
        flag(args, "--remove-label").forEach((l) => i.labels.delete(l));
        flag(args, "--add-label").forEach((l) => i.labels.add(l));
      }
      i.assignees = [...i.assignees.filter((a) => !flag(args, "--remove-assignee").includes(a)), ...flag(args, "--add-assignee")];
      return out();
    },
    "issue close": (args) => { issues.get(Number(args[2])).state = "CLOSED"; return out(); },
    "issue reopen": (args) => { issues.get(Number(args[2])).state = "OPEN"; return out(); },
  };
  // Yielding before each call lets two concurrent claims interleave, as two machines would.
  const run = async (_cmd, args) => { await Promise.resolve(); return handlers[args.slice(0, 2).join(" ")](args); };
  const backend = {
    rejectMoves: () => { state.rejectMoves = true; },
    corrupt: (shortId, n) => {
      const i = issues.get(Number(shortId.slice(3)));
      [...i.labels].filter((l) => l.startsWith("kj:") && l !== "kj:hu").forEach((l) => i.labels.delete(l));
      ["kj:pending", "kj:running"].slice(0, n).forEach((l) => i.labels.add(l));
    },
  };
  return { run, backend };
}

it("GitHub Issues declares ADR 0029's values: criteria in the body, partial dependencies, PR verdicts, no credentials", () => {
  const { capabilities, credentials } = createGithubManager({ repo: REPO });
  expect(capabilities).toEqual({ acceptanceCriteria: "body", dependencies: "partial", assignee: true, verdicts: "pr", offline: true });
  expect(credentials).toEqual([]);
});

runStoryContract("GitHub Issues", () => {
  const { run, backend } = fakeGh();
  return { manager: createGithubManager({ repo: REPO, run }), backend };
});
