import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money/money";
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction";

const at = new Date("2026-10-29T23:00:00.000Z");

describe("pending reference retry", () => {
  test("schedules five waits of 1s, 2s, 4s, 8s and 16s", () => {
    const transaction = WagerTransaction.create({
      id: "33333333-3333-4333-8333-333333333333",
      providerId: "provider-a",
      externalTransactionId: "refund-1",
      idempotencyKey: "provider-a:refund-1",
      payloadHash: "hash",
      walletId: "11111111-1111-4111-8111-111111111111",
      playerId: "22222222-2222-4222-8222-222222222222",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-1",
      createdAt: at,
    });
    transaction.markPendingReference();

    const delays = [1_000, 2_000, 4_000, 8_000, 16_000];
    for (const delay of delays) {
      const attempts = transaction.referenceAttempts;
      transaction.scheduleReferenceRetry(at);
      expect(transaction.referenceAttempts).toBe(attempts + 1);
      expect(transaction.referenceNextAttemptAt?.toISOString()).toBe(new Date(at.getTime() + delay).toISOString());
    }

    expect(transaction.referenceAttemptsExhausted()).toBe(true);
    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
  });
});
