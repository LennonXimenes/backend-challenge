import { describe, expect, test } from "bun:test";
import { decideMovement } from "../../src/application/wagering/decide-movement";
import { outboxForTransaction } from "../../src/application/integration/outbox-for-transaction";
import { Money } from "../../src/domain/money/money";
import { CurrencyMismatchError } from "../../src/domain/money/money-error";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import { InsufficientBalanceError } from "../../src/domain/wallet/wallet-error";
import { Wallet } from "../../src/domain/wallet/wallet";
import { FailureCode } from "../../src/domain/wager/failure-code";
import { InvalidTransactionStateError, WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction";

const at = new Date("2026-10-29T23:00:00.000Z");
const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const ledgerId = "44444444-4444-4444-8444-444444444444";
const openingTransactionId = "55555555-5555-4555-8555-555555555555";
const openingLedgerId = "66666666-6666-4666-8666-666666666666";

function rollbackInput(
  amount: string,
  reference: {
    id: string;
    kind: WagerTransactionKind;
    status: WagerTransactionStatus;
    playerId: string;
    walletId: string;
    roundId: string;
    currency: string;
    amount: string;
  },
  overrides: { alreadyReversed?: boolean; externalTransactionId?: string; roundId?: string } = {},
) {
  const externalTransactionId = overrides.externalTransactionId ?? "rollback-1";
  return {
    transactionId,
    ledgerId,
    providerId: "provider-a",
    externalTransactionId,
    idempotencyKey: `provider-a:${externalTransactionId}`,
    playerId,
    walletId,
    roundId: overrides.roundId ?? "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Rollback,
    money: Money.from({ amount, currency: "BRL" }),
    referenceExternalTransactionId: "referenced-1",
    reference,
    alreadyReversed: overrides.alreadyReversed,
    at,
  };
}

function openedWallet() {
  return Wallet.open({
    id: walletId,
    playerId,
    initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    openedAt: at,
    openingTransactionId,
    openingLedgerId,
  }).wallet;
}

describe("wallet movements", () => {
  test("debit and credit move the balance and the version", () => {
    const wallet = openedWallet();
    const debit = wallet.debit({
      money: Money.from({ amount: "80.00", currency: "BRL" }),
      at,
      ledgerId,
      transactionId,
    });

    expect(debit.direction).toBe(LedgerDirection.Debit);
    expect(debit.balanceAfter.toJSON().amount).toBe("20.00");
    expect(wallet.version).toBe(2);

    const credit = wallet.credit({
      money: Money.from({ amount: "5.00", currency: "BRL" }),
      at,
      ledgerId: "77777777-7777-4777-8777-777777777777",
      transactionId: "88888888-8888-4888-8888-888888888888",
    });

    expect(credit.direction).toBe(LedgerDirection.Credit);
    expect(wallet.balance.toJSON().amount).toBe("25.00");
    expect(wallet.version).toBe(3);
  });

  test("an insufficient debit does not change the wallet", () => {
    const wallet = openedWallet();

    expect(() =>
      wallet.debit({
        money: Money.from({ amount: "100.01", currency: "BRL" }),
        at,
        ledgerId,
        transactionId,
      }),
    ).toThrow(InsufficientBalanceError);
    expect(wallet.balance.toJSON().amount).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  test("a different currency does not change the wallet", () => {
    const wallet = openedWallet();

    expect(() =>
      wallet.credit({
        money: Money.from({ amount: "1.00", currency: "USD" }),
        at,
        ledgerId,
        transactionId,
      }),
    ).toThrow(CurrencyMismatchError);
    expect(wallet.version).toBe(1);
  });

  test("a submitted transaction starts pending and terminal states do not move again", () => {
    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId: "provider-a",
      externalTransactionId: "transaction-1",
      idempotencyKey: "provider-a:transaction-1",
      payloadHash: "hash",
      walletId,
      playerId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      createdAt: at,
    });

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    transaction.reject(FailureCode.InsufficientBalance);
    expect(transaction.failureCode).toBe(FailureCode.InsufficientBalance);
    expect(() => transaction.markProcessed(at)).toThrow(InvalidTransactionStateError);
    expect(() => transaction.fail("INFRA")).toThrow(InvalidTransactionStateError);
  });

  test("a loss is processed without a ledger entry or a balance change", () => {
    const wallet = openedWallet();
    const decision = decideMovement(wallet, {
      transactionId,
      ledgerId,
      providerId: "provider-a",
      externalTransactionId: "loss-1",
      idempotencyKey: "provider-a:loss-1",
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Loss,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      at,
    });

    expect(decision.entry).toBeUndefined();
    expect(decision.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.toJSON().amount).toBe("100.00");
    expect(wallet.version).toBe(1);
    expect(outboxForTransaction({
      transaction: decision.transaction,
      wallet,
      eventId: "99999999-9999-4999-8999-999999999999",
      occurredAt: at,
    }).map((message) => message.eventType)).toEqual(["WagerTransactionProcessed"]);
  });

  test("a refund credits the referenced bet once and rejects a second reversal", () => {
    const wallet = openedWallet();
    wallet.debit({
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      at,
      ledgerId: openingLedgerId,
      transactionId: openingTransactionId,
    });
    const reference = {
      id: "77777777-7777-4777-8777-777777777777",
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "40.00",
    };
    const refund = decideMovement(wallet, {
      transactionId,
      ledgerId,
      providerId: "provider-a",
      externalTransactionId: "refund-1",
      idempotencyKey: "provider-a:refund-1",
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-1",
      reference,
      at,
    });

    expect(refund.entry?.direction).toBe(LedgerDirection.Credit);
    expect(refund.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.toJSON().amount).toBe("100.00");
    expect(wallet.version).toBe(3);

    const again = decideMovement(wallet, {
      transactionId: "88888888-8888-4888-8888-888888888888",
      ledgerId: "99999999-9999-4999-8999-999999999999",
      providerId: "provider-a",
      externalTransactionId: "refund-2",
      idempotencyKey: "provider-a:refund-2",
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-1",
      reference,
      alreadyReversed: true,
      at,
    });
    expect(again.entry).toBeUndefined();
    expect(again.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(again.transaction.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(wallet.balance.toJSON().amount).toBe("100.00");
    expect(wallet.version).toBe(3);
  });

  test("a refund with a different amount or a missing bet does not credit", () => {
    const wallet = openedWallet();
    const reference = {
      id: "77777777-7777-4777-8777-777777777777",
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "40.00",
    };
    const mismatch = decideMovement(wallet, {
      transactionId,
      ledgerId,
      providerId: "provider-a",
      externalTransactionId: "refund-amount",
      idempotencyKey: "provider-a:refund-amount",
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-1",
      reference,
      at,
    });
    expect(mismatch.transaction.failureCode).toBe(FailureCode.AmountMismatch);
    expect(mismatch.entry).toBeUndefined();

    const pending = decideMovement(wallet, {
      transactionId: "88888888-8888-4888-8888-888888888888",
      ledgerId,
      providerId: "provider-a",
      externalTransactionId: "refund-early",
      idempotencyKey: "provider-a:refund-early",
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-later",
      at,
    });
    expect(pending.transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(pending.entry).toBeUndefined();
    const claimed = decideMovement(wallet, {
      transactionId: "99999999-9999-4999-8999-999999999999",
      ledgerId,
      providerId: "provider-a",
      externalTransactionId: "refund-early-2",
      idempotencyKey: "provider-a:refund-early-2",
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-later",
      alreadyReversed: true,
      at,
    });
    expect(claimed.transaction.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(wallet.balance.toJSON().amount).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  test("a rollback inverts a bet with a credit and a win with a debit", () => {
    const wallet = openedWallet();
    wallet.debit({
      money: Money.from({ amount: "40.00", currency: "BRL" }),
      at,
      ledgerId: openingLedgerId,
      transactionId: openingTransactionId,
    });
    const bet = decideMovement(wallet, rollbackInput("40.00", {
      id: "77777777-7777-4777-8777-777777777777",
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "40.00",
    }));
    expect(bet.entry?.direction).toBe(LedgerDirection.Credit);
    expect(bet.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.toJSON().amount).toBe("100.00");

    const again = decideMovement(wallet, rollbackInput("40.00", {
      id: "77777777-7777-4777-8777-777777777777",
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "40.00",
    }, { alreadyReversed: true, externalTransactionId: "rollback-2" }));
    expect(again.entry).toBeUndefined();
    expect(again.transaction.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(wallet.version).toBe(3);

    const win = decideMovement(wallet, rollbackInput("20.00", {
      id: "88888888-8888-4888-8888-888888888888",
      kind: WagerTransactionKind.Win,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "20.00",
    }, { externalTransactionId: "rollback-win" }));
    expect(win.entry?.direction).toBe(LedgerDirection.Debit);
    expect(wallet.balance.toJSON().amount).toBe("80.00");
  });

  test("a rollback that would go negative is rejected without a ledger entry", () => {
    const wallet = openedWallet();
    wallet.debit({
      money: Money.from({ amount: "90.00", currency: "BRL" }),
      at,
      ledgerId: openingLedgerId,
      transactionId: openingTransactionId,
    });
    const rejected = decideMovement(wallet, rollbackInput("20.00", {
      id: "88888888-8888-4888-8888-888888888888",
      kind: WagerTransactionKind.Win,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "20.00",
    }));
    expect(rejected.entry).toBeUndefined();
    expect(rejected.transaction.failureCode).toBe(FailureCode.ReversalExceedsBalance);
    expect(wallet.balance.toJSON().amount).toBe("10.00");
    expect(wallet.version).toBe(2);

    const loss = decideMovement(wallet, rollbackInput("10.00", {
      id: "99999999-9999-4999-8999-999999999999",
      kind: WagerTransactionKind.Loss,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "10.00",
    }, { externalTransactionId: "rollback-loss" }));
    expect(loss.transaction.failureCode).toBe(FailureCode.InvalidReference);
    const otherRound = decideMovement(wallet, rollbackInput("10.00", {
      id: "77777777-7777-4777-8777-777777777777",
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      playerId,
      walletId,
      roundId: "round-1",
      currency: "BRL",
      amount: "10.00",
    }, { externalTransactionId: "rollback-other-round", roundId: "other-round" }));
    expect(otherRound.transaction.failureCode).toBe(FailureCode.InvalidReference);
    expect(wallet.balance.toJSON().amount).toBe("10.00");
  });

  test("opening cannot be submitted", () => {
    expect(() => WagerTransaction.create({
      id: transactionId,
      providerId: "internal",
      externalTransactionId: walletId,
      idempotencyKey: "internal:opening",
      payloadHash: "hash",
      walletId,
      playerId,
      roundId: "opening",
      gameId: "opening",
      kind: WagerTransactionKind.Opening,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      createdAt: at,
    })).toThrow(InvalidTransactionStateError);
  });
});
