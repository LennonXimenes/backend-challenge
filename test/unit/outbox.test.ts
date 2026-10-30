import { describe, expect, test } from "bun:test";
import { outboxForTransaction } from "../../src/application/integration/outbox-for-transaction";
import { InvalidOutboxStateError, OutboxMessage } from "../../src/domain/integration/outbox-message";
import { Money } from "../../src/domain/money/money";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import { Wallet } from "../../src/domain/wallet/wallet";
import { FailureCode } from "../../src/domain/wager/failure-code";
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction";

const at = new Date("2026-10-29T23:00:00.000Z");
const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const ledgerId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const balanceEventId = "66666666-6666-4666-8666-666666666666";

function fundedWallet(): Wallet {
  return Wallet.open({
    id: walletId,
    playerId,
    initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    openedAt: at,
    openingTransactionId: "77777777-7777-4777-8777-777777777777",
    openingLedgerId: "88888888-8888-4888-8888-888888888888",
  }).wallet;
}

function bet(kind: WagerTransactionKind.Bet | WagerTransactionKind.Win = WagerTransactionKind.Bet): WagerTransaction {
  return WagerTransaction.create({
    id: transactionId,
    providerId: "provider-a",
    externalTransactionId: "transaction-1",
    idempotencyKey: "provider-a:transaction-1",
    payloadHash: "hash",
    walletId,
    playerId,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind,
    money: Money.from({ amount: "25.00", currency: "BRL" }),
    referenceExternalTransactionId: kind === WagerTransactionKind.Win ? "bet-1" : undefined,
    createdAt: at,
  });
}

describe("outbox", () => {
  test("a processed movement enqueues the transaction and the balance change as decimal strings", () => {
    const wallet = fundedWallet();
    const transaction = bet();
    const entry = wallet.debit({ money: transaction.money, at, ledgerId, transactionId });
    transaction.markProcessed(at);

    const messages = outboxForTransaction({
      transaction,
      wallet,
      entry,
      eventId,
      balanceEventId,
      occurredAt: at,
    });

    expect(messages.map((message) => message.eventType)).toEqual([
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);
    const balance = messages[1]?.payload.data as {
      money: { amount: unknown };
      balanceBefore: { amount: unknown };
      balanceAfter: { amount: unknown };
      direction: string;
      walletVersion: number;
    };
    expect(balance.direction).toBe(LedgerDirection.Debit);
    expect(balance.walletVersion).toBe(2);
    expect(balance.money.amount).toBe("25.00");
    expect(balance.balanceBefore.amount).toBe("100.00");
    expect(balance.balanceAfter.amount).toBe("75.00");
    expect(JSON.stringify(messages[1]?.payload)).not.toContain("Decimal");
  });

  test("a rejected transaction and a pending reference do not enqueue a balance change", () => {
    const rejected = bet();
    rejected.reject(FailureCode.InsufficientBalance);
    const rejectedMessages = outboxForTransaction({
      transaction: rejected,
      wallet: fundedWallet(),
      eventId,
      occurredAt: at,
    });
    expect(rejectedMessages.map((message) => message.eventType)).toEqual(["WagerTransactionRejected"]);
    expect((rejectedMessages[0]?.payload.data as { failureCode: string }).failureCode).toBe(FailureCode.InsufficientBalance);

    const pending = bet(WagerTransactionKind.Win);
    pending.markPendingReference();
    const pendingMessages = outboxForTransaction({
      transaction: pending,
      wallet: fundedWallet(),
      eventId,
      occurredAt: at,
    });
    expect(pendingMessages.map((message) => message.eventType)).toEqual(["WagerTransactionPendingReference"]);
    expect(pending.status).toBe(WagerTransactionStatus.PendingReference);
  });

  test("a processed transaction without a ledger entry does not enqueue a balance change", () => {
    const transaction = bet(WagerTransactionKind.Win);
    transaction.markProcessed(at);
    const messages = outboxForTransaction({
      transaction,
      wallet: fundedWallet(),
      eventId,
      occurredAt: at,
    });
    expect(messages.map((message) => message.eventType)).toEqual(["WagerTransactionProcessed"]);
  });

  test("retry waits 1s then 2s and a published message does not move again", () => {
    const wallet = fundedWallet();
    const transaction = bet();
    transaction.reject(FailureCode.InsufficientBalance);
    const message = outboxForTransaction({ transaction, wallet, eventId, occurredAt: at })[0];
    if (!message) {
      throw new Error("missing outbox message");
    }

    expect(message.isPending()).toBe(true);
    expect(message.isDue(at)).toBe(true);

    message.scheduleRetry(at);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt?.toISOString()).toBe("2026-10-29T23:00:01.000Z");
    expect(message.isDue(at)).toBe(false);
    expect(message.isDue(new Date("2026-10-29T23:00:01.000Z"))).toBe(true);

    message.scheduleRetry(at);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt?.toISOString()).toBe("2026-10-29T23:00:02.000Z");

    message.markPublished(at);
    expect(message.isPending()).toBe(false);
    expect(() => message.scheduleRetry(at)).toThrow(InvalidOutboxStateError);
    expect(() => message.markPublished(at)).toThrow(InvalidOutboxStateError);

    const restored = OutboxMessage.rehydrate({
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt,
      publishedAt: message.publishedAt,
    });
    expect(restored.isPending()).toBe(false);
    expect(restored.attempts).toBe(2);
  });
});
