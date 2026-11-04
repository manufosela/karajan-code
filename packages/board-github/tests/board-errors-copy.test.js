// The package carries its own copy of the board errors: callers must recognise them by name, never by instanceof.
import { describe, expect, it } from "vitest";
import { BoardOfflineError, BoardRejectedError, HuClaimedError } from "../src/board-errors.js";
import * as own from "../src/board-errors.js";
import * as contract from "../../story-contract/src/board-errors.js";

describe("board errors across the package copy", () => {
  it("the copy is a different class from the contract's, so recognition goes by name", () => {
    expect(BoardOfflineError).not.toBe(contract.BoardOfflineError);
    expect(new BoardOfflineError("x")).not.toBeInstanceOf(contract.BoardOfflineError);
  });

  it("the contract's isOffline/isRefusal recognise the package's errors", () => {
    expect(contract.isOffline(new BoardOfflineError("down"))).toBe(true);
    expect(contract.isRefusal(new BoardRejectedError("no"))).toBe(true);
    expect(contract.isRefusal(new HuClaimedError("held"))).toBe(true);
    expect(contract.isRefusal(new BoardOfflineError("down"))).toBe(false);
    expect(contract.isOffline(new BoardRejectedError("no"))).toBe(false);
  });

  it("the copy keeps the same names and predicates as the contract", () => {
    for (const k of ["BoardOfflineError", "BoardRejectedError", "HuClaimedError"]) expect(new own[k]("m").name).toBe(new contract[k]("m").name);
    expect(own.isOffline(new contract.BoardOfflineError("down"))).toBe(true);
    expect(own.isRefusal(new contract.HuClaimedError("held"))).toBe(true);
  });
});
