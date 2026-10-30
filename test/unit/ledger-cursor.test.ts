import { describe, expect, test } from "bun:test";
import { decodeLedgerCursor, encodeLedgerCursor } from "../../src/application/wallets/ledger-cursor";
import { InvalidWalletInputError } from "../../src/domain/wallet/wallet-error";

const entryId = "11111111-1111-4111-8111-111111111111";

describe("ledger cursor", () => {
  test("hides the entry id and rejects a cursor the client invents", () => {
    const cursor = encodeLedgerCursor(entryId);
    expect(cursor).not.toBe(entryId);
    expect(cursor).not.toContain("createdAt");
    expect(decodeLedgerCursor(cursor)).toBe(entryId);
    expect(() => decodeLedgerCursor(entryId)).toThrow(InvalidWalletInputError);
    expect(() => decodeLedgerCursor("1")).toThrow(InvalidWalletInputError);
  });
});
