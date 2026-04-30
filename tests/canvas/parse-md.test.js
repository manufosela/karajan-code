import { describe, expect, it } from "vitest";
import { parseCanvasMarkdown } from "../../src/canvas/parse-md.js";

const FULL = `# Demo Project

## REASONS:Requirements
We need an order service that handles partial refunds.

Definition of done:
- POST /orders works
- Refunds are atomic

## REASONS:Entities
- \`Order\` — fields: id, total, status. has-many RefundLine.
- \`RefundLine\` — fields: id, orderId, amount.

## REASONS:Approach
We use the Saga pattern because two-phase commit is overkill.

## REASONS:Structure
- touches: src/orders/*, src/refunds/*
- depends_on: TokenService, PaymentGateway
- contracts: POST /orders, POST /refunds, GET /orders/:id

## REASONS:Operations
1. Add OrderRepository (src/orders/order-repo.js)
   Acceptance:
   - shell: \`node -e "require('./src/orders/order-repo.js')"\`
   - shell: \`npx vitest run tests/orders/order-repo.test.js\`

2. Add Saga coordinator
   Acceptance:
   - gherkin: Given an order is paid When refund is partial Then atomic ledger entries

## REASONS:Norms
- All public functions JSDoc'd.
- No console.log in production paths.

## REASONS:Safeguards
- Order amounts must be > 0 (invariant).
- Bearer tokens never logged.
`;

describe("parseCanvasMarkdown", () => {
  it("extracts the title and all 7 sections from a full canvas", () => {
    const c = parseCanvasMarkdown(FULL);
    expect(c.title).toBe("Demo Project");
    expect(c.requirements.problem).toMatch(/order service/);
    expect(c.requirements.done).toEqual(["POST /orders works", "Refunds are atomic"]);
    expect(c.entities).toHaveLength(2);
    expect(c.entities[0].name).toBe("Order");
    expect(c.approach).toMatch(/Saga pattern/);
    expect(c.structure.touches).toEqual(["src/orders/*", "src/refunds/*"]);
    expect(c.structure.depends_on).toEqual(["TokenService", "PaymentGateway"]);
    expect(c.structure.contracts).toHaveLength(3);
    expect(c.operations).toHaveLength(2);
    expect(c.operations[0].acceptance).toHaveLength(2);
    expect(c.operations[0].acceptance[0]).toEqual({ type: "shell", content: 'node -e "require(\'./src/orders/order-repo.js\')"' });
    expect(c.operations[1].acceptance[0].type).toBe("gherkin");
    expect(c.norms).toEqual(["All public functions JSDoc'd.", "No console.log in production paths."]);
    expect(c.safeguards).toEqual(["Order amounts must be > 0 (invariant).", "Bearer tokens never logged."]);
  });

  it("rejects a canvas missing the title", () => {
    expect(() => parseCanvasMarkdown(FULL.replace("# Demo Project\n", ""))).toThrow(/title/);
  });

  it("rejects a canvas missing required sections", () => {
    expect(() => parseCanvasMarkdown("# X\n## REASONS:Approach\nStuff.")).toThrow(/Requirements|Structure|Operations/);
  });

  it("rejects an operation without acceptance tests", () => {
    const bad = `# X

## REASONS:Requirements
do X

## REASONS:Approach
y

## REASONS:Structure
- touches: src/

## REASONS:Operations
1. Step without tests
`;
    expect(() => parseCanvasMarkdown(bad)).toThrow(/no acceptance tests/);
  });

  it("rejects empty input", () => {
    expect(() => parseCanvasMarkdown("")).toThrow();
    expect(() => parseCanvasMarkdown(null)).toThrow();
  });

  it("treats optional sections as empty arrays when absent", () => {
    const minimal = `# X

## REASONS:Requirements
do X

## REASONS:Approach
y

## REASONS:Structure

## REASONS:Operations
1. Step
   Acceptance:
   - shell: true
`;
    const c = parseCanvasMarkdown(minimal);
    expect(c.entities).toEqual([]);
    expect(c.norms).toEqual([]);
    expect(c.safeguards).toEqual([]);
  });
});
