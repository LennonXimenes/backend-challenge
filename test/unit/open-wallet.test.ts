import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money/money";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import { UnbalancedLedgerEntryError } from "../../src/domain/wallet/wallet-error";
import { WalletLedgerEntry } from "../../src/domain/wallet/wallet-ledger-entry";
import { Wallet } from "../../src/domain/wallet/wallet";
import { InvalidTransactionStateError, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction";

const openedAt = new Date("2026-10-29T22:00:00.000Z");
const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const ledgerId = "44444444-4444-4444-8444-444444444444";

describe("Wallet.open", () => {
  test("credits the opening balance once and keeps version at 1", () => {
    const opened = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      openedAt,
      openingTransactionId: transactionId,
      openingLedgerId: ledgerId,
    });

    expect(opened.wallet.toJSON()).toEqual({
      id: walletId,
      playerId,
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });
    expect(opened.opening?.transaction.kind).toBe("OPENING");
    expect(opened.opening?.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(opened.opening?.entry.direction).toBe(LedgerDirection.Credit);
    expect(opened.opening?.entry.isBalanced()).toBe(true);
    expect(opened.opening?.entry.balanceBefore.toJSON().amount).toBe("0.00");
    expect(opened.opening?.entry.balanceAfter.toJSON().amount).toBe("1000.00");
    expect(() => opened.opening?.transaction.markProcessed(openedAt)).toThrow(InvalidTransactionStateError);
  });

  test("does not write an opening when the initial balance is zero", () => {
    const opened = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.zero("BRL"),
      openedAt,
      openingTransactionId: transactionId,
      openingLedgerId: ledgerId,
    });

    expect(opened.opening).toBeUndefined();
    expect(opened.wallet.version).toBe(1);
    expect(opened.wallet.balance.toJSON().amount).toBe("0.00");
  });

  test("rehydrate keeps the stored balance without applying the opening again", () => {
    const opened = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.from({ amount: "10.00", currency: "BRL" }),
      openedAt,
      openingTransactionId: transactionId,
      openingLedgerId: ledgerId,
    });
    const stored = Wallet.rehydrate({
      id: opened.wallet.id,
      playerId: opened.wallet.playerId,
      currency: opened.wallet.currency,
      balance: opened.wallet.balance,
      version: opened.wallet.version,
      createdAt: opened.wallet.createdAt,
      updatedAt: opened.wallet.updatedAt,
    });

    expect(stored.toJSON()).toEqual(opened.wallet.toJSON());
  });

  test("rejects a ledger entry whose arithmetic does not close", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: ledgerId,
        walletId,
        transactionId,
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "10.00", currency: "BRL" }),
        balanceBefore: Money.zero("BRL"),
        balanceAfter: Money.from({ amount: "9.00", currency: "BRL" }),
        createdAt: openedAt,
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });
});
