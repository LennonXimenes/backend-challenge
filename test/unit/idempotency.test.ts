import { describe, expect, test } from "bun:test";
import { movementPayloadHash } from "../../src/application/wagering/decide-movement";
import { Money } from "../../src/domain/money/money";
import { WagerTransaction, WagerTransactionKind } from "../../src/domain/wager/wager-transaction";
import { NumericStringType } from "../../src/infra/database/numeric-string.type";

const at = new Date("2026-10-29T23:00:00.000Z");
const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";

describe("idempotency payload", () => {
  test("the same key with a different payload does not match", () => {
    const base = {
      externalTransactionId: "transaction-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      playerId,
      providerId: "provider-a",
      roundId: "round-1",
      walletId,
    };
    const original = movementPayloadHash({ ...base, money: Money.from({ amount: "25.00", currency: "BRL" }) });
    const changed = movementPayloadHash({ ...base, money: Money.from({ amount: "30.00", currency: "BRL" }) });
    const transaction = WagerTransaction.create({
      id: "33333333-3333-4333-8333-333333333333",
      providerId: "provider-a",
      externalTransactionId: "transaction-1",
      idempotencyKey: "provider-a:transaction-1",
      payloadHash: original,
      walletId,
      playerId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      createdAt: at,
    });

    expect(original).not.toBe(changed);
    expect(transaction.matchesPayload(original)).toBe(true);
    expect(transaction.matchesPayload(changed)).toBe(false);
  });

  test("a numeric column stays a string", () => {
    const type = new NumericStringType();
    expect(type.convertToJSValue("10")).toBe("10.00");
    expect(type.convertToDatabaseValue("10.5")).toBe("10.50");
    expect(() => type.convertToJSValue(10 as unknown as string)).toThrow(/string/);
  });
});