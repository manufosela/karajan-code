import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks for pipeline-adapter dependencies ---
const mockFetchCard = vi.fn();
const mockUpdateCard = vi.fn();

vi.mock("../src/planning-game/client.js", () => ({
  fetchCard: (...args) => mockFetchCard(...args),
  updateCard: (...args) => mockUpdateCard(...args)
}));

const { initPgAdapter, markPgCardToValidate, accumulateCommit } = await import("../src/planning-game/pipeline-adapter.js");

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), setContext: vi.fn() };
}

function makeConfig(overrides = {}) {
  return {
    planning_game: { enabled: true, codeveloper: "dev_042", ...overrides.planning_game },
    ...overrides
  };
}

describe("PG card lifecycle auto-tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- markCardInProgress via initPgAdapter ---

  describe("initPgAdapter (markCardInProgress)", () => {
    it("marks card as In Progress when pgTaskId is set and card is not In Progress", async () => {
      const pgCard = { cardId: "KJC-TSK-0210", firebaseId: "fb-123", status: "To Do" };
      mockFetchCard.mockResolvedValue(pgCard);
      mockUpdateCard.mockResolvedValue({});

      const result = await initPgAdapter({
        session: { id: "sess-1" },
        config: makeConfig(),
        logger: makeLogger(),
        pgTaskId: "KJC-TSK-0210",
        pgProject: "karajan-code"
      });

      expect(result.pgCard).toBeTruthy();
      expect(mockFetchCard).toHaveBeenCalledWith({ projectId: "karajan-code", cardId: "KJC-TSK-0210" });
      expect(mockUpdateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "karajan-code",
          cardId: "KJC-TSK-0210",
          firebaseId: "fb-123",
          updates: expect.objectContaining({
            status: "In Progress",
            developer: "dev_016",
            codeveloper: "dev_042"
          })
        })
      );
      // startDate should be an ISO string
      const updateCall = mockUpdateCard.mock.calls[0][0];
      expect(updateCall.updates.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("does NOT call updateCard when pgTaskId is not set", async () => {
      const result = await initPgAdapter({
        session: { id: "sess-1" },
        config: makeConfig(),
        logger: makeLogger(),
        pgTaskId: null,
        pgProject: "karajan-code"
      });

      expect(result.pgCard).toBeNull();
      expect(mockFetchCard).not.toHaveBeenCalled();
      expect(mockUpdateCard).not.toHaveBeenCalled();
    });

    it("is idempotent: skips update when card is already In Progress", async () => {
      const pgCard = { cardId: "KJC-TSK-0210", firebaseId: "fb-123", status: "In Progress" };
      mockFetchCard.mockResolvedValue(pgCard);

      const result = await initPgAdapter({
        session: { id: "sess-1" },
        config: makeConfig(),
        logger: makeLogger(),
        pgTaskId: "KJC-TSK-0210",
        pgProject: "karajan-code"
      });

      expect(result.pgCard).toBeTruthy();
      expect(mockFetchCard).toHaveBeenCalled();
      expect(mockUpdateCard).not.toHaveBeenCalled();
    });

    it("does not block pipeline on PG error (best-effort)", async () => {
      mockFetchCard.mockRejectedValue(new Error("PG API down"));

      const logger = makeLogger();
      const result = await initPgAdapter({
        session: { id: "sess-1" },
        config: makeConfig(),
        logger,
        pgTaskId: "KJC-TSK-0210",
        pgProject: "karajan-code"
      });

      expect(result.pgCard).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("PG API down"));
    });
  });

  // --- accumulateCommit ---

  describe("accumulateCommit", () => {
    it("accumulates commits in session.pg_commits", () => {
      const session = { id: "sess-1" };

      accumulateCommit(session, { hash: "abc123", message: "feat: first" });
      accumulateCommit(session, { hash: "def456", message: "fix: second", date: "2026-03-30T12:00:00Z", author: "dev" });

      expect(session.pg_commits).toHaveLength(2);
      expect(session.pg_commits[0]).toEqual(expect.objectContaining({ hash: "abc123", message: "feat: first" }));
      expect(session.pg_commits[1]).toEqual({ hash: "def456", message: "fix: second", date: "2026-03-30T12:00:00Z", author: "dev" });
    });

    it("initializes pg_commits array if not present", () => {
      const session = { id: "sess-1" };
      accumulateCommit(session, { hash: "aaa", message: "init" });
      expect(session.pg_commits).toHaveLength(1);
    });

    it("no-ops when commitInfo is null or missing hash", () => {
      const session = { id: "sess-1" };
      accumulateCommit(session, null);
      accumulateCommit(session, {});
      accumulateCommit(session, { message: "no hash" });
      expect(session.pg_commits).toBeUndefined();
    });

    it("no-ops when session is null", () => {
      expect(() => accumulateCommit(null, { hash: "x", message: "y" })).not.toThrow();
    });
  });

  // --- markPgCardToValidate ---

  describe("markPgCardToValidate", () => {
    it("marks card as To Validate with accumulated commits on approved pipeline", async () => {
      const pgCard = { cardId: "KJC-TSK-0210", firebaseId: "fb-123", status: "In Progress" };
      mockUpdateCard.mockResolvedValue({});

      const session = {
        id: "sess-1",
        pg_task_id: "KJC-TSK-0210",
        pg_card: { startDate: "2026-03-30T10:00:00Z" },
        pg_commits: [
          { hash: "aaa", message: "feat: step 1", date: "2026-03-30T10:30:00Z", author: "Karajan" }
        ],
        created_at: "2026-03-30T10:00:00Z"
      };

      await markPgCardToValidate({
        pgCard,
        pgProject: "karajan-code",
        config: makeConfig(),
        session,
        gitResult: { commits: [{ hash: "bbb", message: "feat: final" }] },
        logger: makeLogger()
      });

      expect(mockUpdateCard).toHaveBeenCalledOnce();
      const updateCall = mockUpdateCard.mock.calls[0][0];
      expect(updateCall.updates.status).toBe("To Validate");
      expect(updateCall.updates.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Should have merged commits: aaa from pg_commits + bbb from gitResult
      expect(updateCall.updates.commits).toHaveLength(2);
      expect(updateCall.updates.commits[0].hash).toBe("aaa");
      expect(updateCall.updates.commits[1].hash).toBe("bbb");
    });

    it("deduplicates commits by hash", async () => {
      const pgCard = { cardId: "KJC-TSK-0210", firebaseId: "fb-123" };
      mockUpdateCard.mockResolvedValue({});

      const session = {
        id: "sess-1",
        pg_task_id: "KJC-TSK-0210",
        pg_card: {},
        pg_commits: [
          { hash: "aaa", message: "feat: same", date: "2026-03-30T10:30:00Z", author: "Karajan" }
        ],
        created_at: "2026-03-30T10:00:00Z"
      };

      await markPgCardToValidate({
        pgCard,
        pgProject: "karajan-code",
        config: makeConfig(),
        session,
        gitResult: { commits: [{ hash: "aaa", message: "feat: same" }] },
        logger: makeLogger()
      });

      const updateCall = mockUpdateCard.mock.calls[0][0];
      expect(updateCall.updates.commits).toHaveLength(1);
    });

    it("does NOT call updateCard when pgCard is null", async () => {
      await markPgCardToValidate({
        pgCard: null,
        pgProject: "karajan-code",
        config: makeConfig(),
        session: { id: "sess-1", pg_task_id: "KJC-TSK-0210" },
        gitResult: { commits: [] },
        logger: makeLogger()
      });

      expect(mockUpdateCard).not.toHaveBeenCalled();
    });

    it("does not block pipeline on PG error (best-effort)", async () => {
      const pgCard = { cardId: "KJC-TSK-0210", firebaseId: "fb-123" };
      mockUpdateCard.mockRejectedValue(new Error("PG timeout"));

      const logger = makeLogger();
      await markPgCardToValidate({
        pgCard,
        pgProject: "karajan-code",
        config: makeConfig(),
        session: { id: "sess-1", pg_task_id: "KJC-TSK-0210", pg_card: {}, created_at: "2026-03-30T10:00:00Z" },
        gitResult: { commits: [] },
        logger
      });

      // Should not throw, just warn
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("PG timeout"));
    });

    it("works when no pg_commits accumulated (uses gitResult only)", async () => {
      const pgCard = { cardId: "KJC-TSK-0210", firebaseId: "fb-123" };
      mockUpdateCard.mockResolvedValue({});

      const session = {
        id: "sess-1",
        pg_task_id: "KJC-TSK-0210",
        pg_card: {},
        created_at: "2026-03-30T10:00:00Z"
        // no pg_commits
      };

      await markPgCardToValidate({
        pgCard,
        pgProject: "karajan-code",
        config: makeConfig(),
        session,
        gitResult: { commits: [{ hash: "ccc", message: "feat: only" }] },
        logger: makeLogger()
      });

      const updateCall = mockUpdateCard.mock.calls[0][0];
      expect(updateCall.updates.commits).toHaveLength(1);
      expect(updateCall.updates.commits[0].hash).toBe("ccc");
    });
  });
});
