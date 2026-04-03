import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunCommand = vi.fn();
vi.mock("../src/utils/process.js", () => ({ runCommand: mockRunCommand }));

const { dispatchComment, dispatchReview, VALID_AGENTS } = await import(
  "../src/ci/dispatch.js"
);

describe("ci/dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  describe("VALID_AGENTS", () => {
    it("includes the 7 expected agent names", () => {
      expect(VALID_AGENTS).toEqual([
        "Coder",
        "Reviewer",
        "Solomon",
        "Sonar",
        "Tester",
        "Security",
        "Planner"
      ]);
    });
  });

  describe("dispatchComment", () => {
    it("sends kj-comment via gh api", async () => {
      await dispatchComment({
        repo: "owner/repo",
        prNumber: 42,
        agent: "Coder",
        body: "Fixed the bug"
      });

      expect(mockRunCommand).toHaveBeenCalledOnce();
      const [cmd, args] = mockRunCommand.mock.calls[0];
      expect(cmd).toBe("gh");
      expect(args).toContain("api");
      expect(args).toContain("repos/owner/repo/dispatches");
      expect(args).toContain("--method");
      expect(args).toContain("POST");

      // Parse the JSON body sent via -f
      const inputIdx = args.indexOf("--input");
      expect(inputIdx).toBeGreaterThan(-1);
      expect(args[inputIdx + 1]).toBe("-");

      // Check stdin contains correct payload
      const opts = mockRunCommand.mock.calls[0][2];
      const payload = JSON.parse(opts.input);
      expect(payload.event_type).toBe("kj-comment");
      expect(payload.client_payload.pr_number).toBe(42);
      expect(payload.client_payload.agent).toBe("Coder");
      expect(payload.client_payload.body).toBe("[Coder] Fixed the bug");
    });

    it("uses custom event type from ciConfig", async () => {
      await dispatchComment({
        repo: "o/r", prNumber: 1, agent: "Coder", body: "test",
        ciConfig: { comment_event: "custom-comment" }
      });
      const opts = mockRunCommand.mock.calls[0][2];
      const payload = JSON.parse(opts.input);
      expect(payload.event_type).toBe("custom-comment");
    });

    it("omits prefix when comment_prefix is false", async () => {
      await dispatchComment({
        repo: "o/r", prNumber: 1, agent: "Coder", body: "no prefix",
        ciConfig: { comment_prefix: false }
      });
      const opts = mockRunCommand.mock.calls[0][2];
      const payload = JSON.parse(opts.input);
      expect(payload.client_payload.body).toBe("no prefix");
    });

    it("rejects invalid agent name", async () => {
      await expect(
        dispatchComment({ repo: "o/r", prNumber: 1, agent: "InvalidAgent", body: "x" })
      ).rejects.toThrow(/Invalid agent.*InvalidAgent/);
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it("rejects missing repo", async () => {
      await expect(
        dispatchComment({ repo: "", prNumber: 1, agent: "Coder", body: "x" })
      ).rejects.toThrow(/repo.*required/i);
    });

    it("rejects missing prNumber", async () => {
      await expect(
        dispatchComment({ repo: "o/r", prNumber: 0, agent: "Coder", body: "x" })
      ).rejects.toThrow(/prNumber.*required/i);
    });

    it("rejects missing body", async () => {
      await expect(
        dispatchComment({ repo: "o/r", prNumber: 1, agent: "Coder", body: "" })
      ).rejects.toThrow(/body.*required/i);
    });

    it("throws on gh failure", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "Not Found"
      });

      await expect(
        dispatchComment({ repo: "o/r", prNumber: 1, agent: "Coder", body: "test" })
      ).rejects.toThrow(/dispatch.*failed.*Not Found/i);
    });

    it("throws descriptive error when gh is not installed", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 127,
        stdout: "",
        stderr: "command not found: gh"
      });

      await expect(
        dispatchComment({ repo: "o/r", prNumber: 1, agent: "Coder", body: "test" })
      ).rejects.toThrow(/gh CLI.*not.*found/i);
    });
  });

  describe("dispatchReview", () => {
    it("sends kj-review with APPROVE event", async () => {
      await dispatchReview({
        repo: "owner/repo",
        prNumber: 7,
        event: "APPROVE",
        body: "LGTM",
        agent: "Reviewer"
      });

      expect(mockRunCommand).toHaveBeenCalledOnce();
      const opts = mockRunCommand.mock.calls[0][2];
      const payload = JSON.parse(opts.input);
      expect(payload.event_type).toBe("kj-review");
      expect(payload.client_payload.pr_number).toBe(7);
      expect(payload.client_payload.event).toBe("APPROVE");
      expect(payload.client_payload.body).toBe("LGTM");
      expect(payload.client_payload.agent).toBe("Reviewer");
    });

    it("sends kj-review with REQUEST_CHANGES event", async () => {
      await dispatchReview({
        repo: "owner/repo",
        prNumber: 3,
        event: "REQUEST_CHANGES",
        body: "Fix SQL injection",
        agent: "Reviewer"
      });

      const opts = mockRunCommand.mock.calls[0][2];
      const payload = JSON.parse(opts.input);
      expect(payload.client_payload.event).toBe("REQUEST_CHANGES");
    });

    it("uses custom event type from ciConfig", async () => {
      await dispatchReview({
        repo: "o/r", prNumber: 1, event: "APPROVE", body: "ok", agent: "Reviewer",
        ciConfig: { review_event: "custom-review" }
      });
      const opts = mockRunCommand.mock.calls[0][2];
      const payload = JSON.parse(opts.input);
      expect(payload.event_type).toBe("custom-review");
    });

    it("rejects invalid event type", async () => {
      await expect(
        dispatchReview({
          repo: "o/r",
          prNumber: 1,
          event: "COMMENT",
          body: "x",
          agent: "Reviewer"
        })
      ).rejects.toThrow(/event.*must be.*APPROVE.*REQUEST_CHANGES/i);
    });

    it("rejects invalid agent name", async () => {
      await expect(
        dispatchReview({
          repo: "o/r",
          prNumber: 1,
          event: "APPROVE",
          body: "x",
          agent: "Unknown"
        })
      ).rejects.toThrow(/Invalid agent/);
    });

    it("throws on gh failure", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "Resource not accessible"
      });

      await expect(
        dispatchReview({
          repo: "o/r",
          prNumber: 1,
          event: "APPROVE",
          body: "ok",
          agent: "Reviewer"
        })
      ).rejects.toThrow(/dispatch.*failed/i);
    });
  });
});
