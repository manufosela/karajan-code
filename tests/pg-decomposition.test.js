import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDecompositionSubtasks, buildDecompositionQuestion } from "../src/planning-game/decomposition.js";

describe("buildDecompositionQuestion", () => {
  it("formats subtasks as numbered list with parent card reference", () => {
    const question = buildDecompositionQuestion(
      ["Extract auth module", "Update API endpoints", "Add E2E tests"],
      "KJC-TSK-0042"
    );

    expect(question).toContain("3 subtasks");
    expect(question).toContain("1. Extract auth module");
    expect(question).toContain("2. Update API endpoints");
    expect(question).toContain("3. Add E2E tests");
    expect(question).toContain("KJC-TSK-0042");
    expect(question).toContain("sequential chain");
    expect(question).toContain("1 = Accept and create the subtasks");
  });
});

describe("createDecompositionSubtasks", () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      createCard: vi.fn(),
      relateCards: vi.fn().mockResolvedValue({ message: "ok" })
    };
  });

  it("creates cards and chains them with blocks relationships", async () => {
    mockClient.createCard
      .mockResolvedValueOnce({ cardId: "KJC-TSK-0100", firebaseId: "fb1" })
      .mockResolvedValueOnce({ cardId: "KJC-TSK-0101", firebaseId: "fb2" })
      .mockResolvedValueOnce({ cardId: "KJC-TSK-0102", firebaseId: "fb3" });

    const result = await createDecompositionSubtasks({
      client: mockClient,
      projectId: "Karajan Code",
      parentCardId: "KJC-TSK-0042",
      parentFirebaseId: "parent-fb",
      subtasks: ["Task A", "Task B", "Task C"],
      epic: "KJC-PCS-0001",
      sprint: "KJC-SPR-0001",
      codeveloper: "dev_001"
    });

    expect(result).toHaveLength(3);
    expect(result[0].cardId).toBe("KJC-TSK-0100");
    expect(result[1].cardId).toBe("KJC-TSK-0101");
    expect(result[2].cardId).toBe("KJC-TSK-0102");

    // 3 createCard calls
    expect(mockClient.createCard).toHaveBeenCalledTimes(3);
    expect(mockClient.createCard.mock.calls[0][0].card.title).toBe("Task A");
    expect(mockClient.createCard.mock.calls[0][0].card.epic).toBe("KJC-PCS-0001");

    // 2 blocks relationships (chain) + 3 related relationships (to parent) = 5
    expect(mockClient.relateCards).toHaveBeenCalledTimes(5);

    // Chain: 0 blocks 1, 1 blocks 2
    expect(mockClient.relateCards).toHaveBeenCalledWith(expect.objectContaining({
      sourceCardId: "KJC-TSK-0100",
      targetCardId: "KJC-TSK-0101",
      relationType: "blocks"
    }));
    expect(mockClient.relateCards).toHaveBeenCalledWith(expect.objectContaining({
      sourceCardId: "KJC-TSK-0101",
      targetCardId: "KJC-TSK-0102",
      relationType: "blocks"
    }));

    // All related to parent
    expect(mockClient.relateCards).toHaveBeenCalledWith(expect.objectContaining({
      sourceCardId: "KJC-TSK-0042",
      targetCardId: "KJC-TSK-0100",
      relationType: "related"
    }));
  });

  it("returns empty array when less than 2 subtasks", async () => {
    const result = await createDecompositionSubtasks({
      client: mockClient,
      projectId: "P",
      parentCardId: "P-TSK-0001",
      subtasks: ["Only one"],
    });

    expect(result).toEqual([]);
    expect(mockClient.createCard).not.toHaveBeenCalled();
  });

  it("returns empty array when subtasks is null", async () => {
    const result = await createDecompositionSubtasks({
      client: mockClient,
      projectId: "P",
      parentCardId: "P-TSK-0001",
      subtasks: null,
    });

    expect(result).toEqual([]);
  });

  it("passes epic and sprint to created cards", async () => {
    mockClient.createCard
      .mockResolvedValueOnce({ cardId: "X-TSK-0001", firebaseId: "f1" })
      .mockResolvedValueOnce({ cardId: "X-TSK-0002", firebaseId: "f2" });

    await createDecompositionSubtasks({
      client: mockClient,
      projectId: "P",
      parentCardId: "P-TSK-0001",
      subtasks: ["A", "B"],
      epic: "P-PCS-0001",
      sprint: "P-SPR-0001"
    });

    const firstCard = mockClient.createCard.mock.calls[0][0].card;
    expect(firstCard.epic).toBe("P-PCS-0001");
    expect(firstCard.sprint).toBe("P-SPR-0001");
  });

  it("includes structured description with parent reference", async () => {
    mockClient.createCard
      .mockResolvedValueOnce({ cardId: "X-TSK-0001", firebaseId: "f1" })
      .mockResolvedValueOnce({ cardId: "X-TSK-0002", firebaseId: "f2" });

    await createDecompositionSubtasks({
      client: mockClient,
      projectId: "P",
      parentCardId: "P-TSK-0010",
      subtasks: ["First task", "Second task"]
    });

    const firstCard = mockClient.createCard.mock.calls[0][0].card;
    expect(firstCard.descriptionStructured[0].benefit).toContain("P-TSK-0010");
    expect(firstCard.descriptionStructured[0].benefit).toContain("Part 1/2");
  });

  it("creates 2 subtasks with exactly 1 blocks + 2 related relationships", async () => {
    mockClient.createCard
      .mockResolvedValueOnce({ cardId: "X-TSK-0001", firebaseId: "f1" })
      .mockResolvedValueOnce({ cardId: "X-TSK-0002", firebaseId: "f2" });

    await createDecompositionSubtasks({
      client: mockClient,
      projectId: "P",
      parentCardId: "P-TSK-0001",
      subtasks: ["A", "B"]
    });

    // 1 blocks (A blocks B) + 2 related (parent-A, parent-B) = 3
    expect(mockClient.relateCards).toHaveBeenCalledTimes(3);
  });
});
