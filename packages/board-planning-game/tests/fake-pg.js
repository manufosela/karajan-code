// A fake of the Planning Game's MCP tools, enough for the manager's tests: cards by id, the fields
// they keep, and the refusals the real server gives (a card it does not have).
export function fakePg({ project = "KJC" } = {}) {
  const cards = new Map();
  let next = 1;
  const tools = {
    create_card: (a) => {
      const cardId = `${project}-TSK-${String(next++).padStart(4, "0")}`;
      const { projectId, type, ...fields } = a;
      cards.set(cardId, { firebaseId: `fb-${cardId}`, cardId, status: "To Do", developer: null, ...fields });
      return { cardId, firebaseId: `fb-${cardId}` };
    },
    get_card: ({ cardId }) => {
      if (!cards.has(cardId)) throw Object.assign(new Error(`Card ${cardId} not found`), { refused: true });
      return { card: structuredClone(cards.get(cardId)) };
    },
    update_card: ({ firebaseId, updates }) => {
      const card = [...cards.values()].find((c) => c.firebaseId === firebaseId);
      if (!card) throw Object.assign(new Error(`no card ${firebaseId}`), { refused: true });
      Object.assign(card, updates);
      return { message: "Card updated successfully" };
    },
  };
  const calls = [];
  const client = {
    async call(tool, args) {
      calls.push({ tool, args });
      try { return tools[tool](args); } catch (err) {
        if (err.refused) throw Object.assign(new Error(`Planning Game ${tool}: ${err.message}`), { name: "BoardRejectedError" });
        throw err;
      }
    },
  };
  return { client, cards, calls, tools };
}
